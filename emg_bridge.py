"""
emg_bridge.py — Serial <-> Local API <-> Next.js bridge

Arsitektur "Web-Driven Labeling via Local Python API":

  [XIAO nRF52840] --Serial (satu arah, frame biner 1000 Hz)--> [Bridge ini]
                                                                    ^
                                                                    | HTTP PUT /phase (localhost:8000)
                                                                    |
                                                        [Next.js SessionRunner.tsx, tiap rAF]

  [Bridge ini] --HTTP POST batch (thread terpisah)--> [Next.js /api/sessions/[id]/emg] --> PostgreSQL

Firmware (firmware/emg_1khz) TIDAK tahu apa-apa soal fase atau sesi. Firmware
mengambil sampel 6 channel tepat 1000 Hz dengan timer hardware, lalu mengirim
satu frame biner tiap 10 ms berisi 10 sampel x (6 raw + 6 envelope) plus nomor
urut sampel sejak device menyala. Format frame: firmware/emg_1khz/emg_dsp.h.

Yang dikerjakan bridge ini:
  - parse frame biner + cek CRC, deteksi sampel hilang dari loncatan nomor urut;
  - menempelkan label fase (dari Next.js) dan isTransition ke tiap sampel;
  - sampleIndex/elapsedMs dihitung dari nomor urut device, jadi waktu sampel
    tepat 1 ms per sampel dan sampel yang hilang terlihat sebagai celah;
  - mengunggah batch ke Next.js di thread terpisah, supaya HTTP yang lambat
    tidak menahan pembacaan Serial.

Jalankan: python emg_bridge.py
Lalu di terminal lain biarkan Next.js dev server jalan seperti biasa.
"""

import binascii
import queue
import struct
import threading
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Optional

import requests
import serial
import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# ============================================
# Konfigurasi -- sesuaikan sebelum menjalankan
# ============================================

SERIAL_PORT = "COM3"           # ganti sesuai port XIAO nRF52840 Anda
SERIAL_BAUDRATE = 115200       # diabaikan oleh USB CDC, tetap diisi untuk pyserial
SERIAL_RX_BUFFER_BYTES = 1 << 20   # buffer driver Windows; default 4 KB terlalu kecil untuk 1000 Hz
NEXTJS_BASE_URL = "http://localhost:3000"
LOCAL_API_PORT = 8000

# Harus sama dengan SAMPLE_RATE_HZ di firmware/emg_1khz/emg_1khz.ino
SAMPLE_RATE_HZ = 1000

# Sampel setelah perubahan fase yang ditandai isTransition=True. Mencakup
# jeda dari Next.js ke bridge (~1 frame rAF + HTTP lokal) ditambah satu frame
# firmware (10 ms) yang sudah di jalan saat fase berubah.
TRANSITION_GUARD_MS = 50
TRANSITION_GUARD_SAMPLES = TRANSITION_GUARD_MS * SAMPLE_RATE_HZ // 1000

# Kirim batch ke Next.js tiap BATCH_SIZE sampel ATAU tiap BATCH_FLUSH_INTERVAL_S
# detik, mana yang lebih dulu. Pada 1000 Hz ini kira-kira 4 POST per detik.
BATCH_SIZE = 500
BATCH_FLUSH_INTERVAL_S = 0.25
UPLOAD_QUEUE_MAX_BATCHES = 240     # ~1 menit data kalau Next.js tersendat
UPLOAD_RETRIES = 3

VALID_PHASES = {"PREPARATION", "ACTION", "REST"}
NUM_CH = 6


# ============================================
# Parser frame biner dari firmware
# ============================================
# [A5 5A] [version u8] [scans u8] [seq u32] [raw u16 x scans x 6]
# [env u32 x scans x 6] [crc16 u16]   -- little-endian,
# CRC-16/CCITT-FALSE dihitung dari byte version sampai akhir env.

FRAME_SYNC = b"\xA5\x5A"
FRAME_VERSION = 1
FRAME_HEADER_BYTES = 8
MAX_SCANS_PER_FRAME = 50


def frame_size(scans: int) -> int:
    return FRAME_HEADER_BYTES + scans * NUM_CH * 2 + scans * NUM_CH * 4 + 2


def crc16_ccitt(data) -> int:
    return binascii.crc_hqx(data, 0xFFFF)


class FrameParser:
    """Mengubah aliran byte Serial menjadi sampel. Tahan terhadap byte acak,
    frame terpotong, dan frame rusak (dibuang lewat CRC, lalu sinkron ulang)."""

    def __init__(self):
        self.buf = bytearray()
        self.frames_ok = 0
        self.crc_errors = 0
        self.bytes_skipped = 0

    def feed(self, data: bytes):
        """Return list of (seq, raw[6], env[6]) untuk semua frame utuh."""
        self.buf += data
        out = []
        while True:
            i = self.buf.find(FRAME_SYNC)
            if i < 0:
                # simpan byte terakhir kalau itu awal sync yang terpotong
                keep = 1 if self.buf[-1:] == FRAME_SYNC[:1] else 0
                self.bytes_skipped += len(self.buf) - keep
                del self.buf[:len(self.buf) - keep]
                break
            if i > 0:
                self.bytes_skipped += i
                del self.buf[:i]
            if len(self.buf) < FRAME_HEADER_BYTES:
                break
            version, scans, seq = struct.unpack_from("<BBI", self.buf, 2)
            if version != FRAME_VERSION or not 0 < scans <= MAX_SCANS_PER_FRAME:
                self.bytes_skipped += 1
                del self.buf[:1]
                continue
            n = frame_size(scans)
            if len(self.buf) < n:
                break
            (crc,) = struct.unpack_from("<H", self.buf, n - 2)
            if crc16_ccitt(self.buf[2:n - 2]) != crc:
                self.crc_errors += 1
                del self.buf[:1]
                continue
            count = scans * NUM_CH
            raw = struct.unpack_from(f"<{count}H", self.buf, FRAME_HEADER_BYTES)
            env = struct.unpack_from(f"<{count}I", self.buf, FRAME_HEADER_BYTES + count * 2)
            for s in range(scans):
                a, b = s * NUM_CH, (s + 1) * NUM_CH
                out.append((seq + s, raw[a:b], env[a:b]))
            del self.buf[:n]
            self.frames_ok += 1
        return out


# ============================================
# State bersama antara Serial reader thread dan FastAPI server
# ============================================

@dataclass
class BridgeState:
    session_id: Optional[str] = None
    current_phase: str = "REST"
    transition_guard_remaining: int = 0
    session_seq0: Optional[int] = None     # nomor urut device di sampel pertama sesi
    last_seq: Optional[int] = None         # nomor urut device terakhir (lintas sesi)
    last_index: int = -1                   # sampleIndex terakhir di sesi aktif
    serial_connected: bool = False
    last_sample_time: Optional[float] = None
    total_samples_received: int = 0
    dropped_samples: int = 0               # celah nomor urut sejak bridge jalan
    session_dropped_samples: int = 0
    device_restarts: int = 0
    lock: threading.Lock = field(default_factory=threading.Lock)

    def set_session(self, session_id: str):
        with self.lock:
            self.session_id = session_id
            self.current_phase = "PREPARATION"
            self.transition_guard_remaining = TRANSITION_GUARD_SAMPLES
            self.session_seq0 = None
            self.last_index = -1
            self.session_dropped_samples = 0
            print(f"[bridge] Sesi dimulai: {session_id}")

    def end_session(self):
        with self.lock:
            print(f"[bridge] Sesi berakhir: {self.session_id} "
                  f"({self.last_index + 1} sampel, {self.session_dropped_samples} hilang)")
            self.session_id = None
            self.session_seq0 = None

    def update_phase(self, phase: str):
        with self.lock:
            if phase != self.current_phase:
                self.current_phase = phase
                self.transition_guard_remaining = TRANSITION_GUARD_SAMPLES

    def next_sample_meta(self, seq: int) -> Optional[dict]:
        """Metadata untuk satu sampel dengan nomor urut device `seq`.
        Return None kalau tidak ada sesi aktif (sampel dibuang)."""
        with self.lock:
            self.total_samples_received += 1
            self.last_sample_time = time.time()

            gap = 0
            if self.last_seq is not None:
                if seq <= self.last_seq:
                    # device di-reset (nomor urut mulai dari 0 lagi)
                    self.device_restarts += 1
                    if self.session_seq0 is not None:
                        self.session_seq0 = seq - (self.last_index + 1)
                elif seq > self.last_seq + 1:
                    gap = seq - self.last_seq - 1
                    self.dropped_samples += gap
            self.last_seq = seq

            if self.session_id is None:
                return None
            if self.session_seq0 is None:
                self.session_seq0 = seq
                gap = 0
            self.session_dropped_samples += gap

            index = seq - self.session_seq0
            self.last_index = index
            is_transition = self.transition_guard_remaining > 0
            if is_transition:
                self.transition_guard_remaining -= 1

            return {
                "sessionId": self.session_id,
                "sampleIndex": index,
                "elapsedMs": index * 1000 // SAMPLE_RATE_HZ,
                "phase": self.current_phase,
                "isTransition": is_transition,
            }


state = BridgeState()
parser_stats = {"frames_ok": 0, "crc_errors": 0, "bytes_skipped": 0}
rate_window: deque = deque()            # (waktu, jumlah sampel) untuk ukur laju

batch_buffer: list = []                  # list of (sessionId, sample dict)
batch_lock = threading.Lock()
last_flush = time.perf_counter()
upload_queue: "queue.Queue[tuple[str, list]]" = queue.Queue(maxsize=UPLOAD_QUEUE_MAX_BATCHES)
upload_stats = {"batches_sent": 0, "batches_failed": 0, "batches_dropped": 0}


# ============================================
# Batch + upload ke Next.js
# ============================================

def flush_batch(force: bool = False):
    """Pindahkan isi buffer ke antrean upload (tidak melakukan HTTP)."""
    global last_flush
    with batch_lock:
        due = force or len(batch_buffer) >= BATCH_SIZE or \
            (time.perf_counter() - last_flush) >= BATCH_FLUSH_INTERVAL_S
        if not due or not batch_buffer:
            if due:
                last_flush = time.perf_counter()
            return
        items = batch_buffer[:]
        batch_buffer.clear()
        last_flush = time.perf_counter()

    # Kelompokkan per sesi -- sampel dari sesi lama tidak boleh ikut ke sesi baru.
    groups: list = []
    for sid, sample in items:
        if not groups or groups[-1][0] != sid:
            groups.append((sid, []))
        groups[-1][1].append(sample)
    for sid, samples in groups:
        for i in range(0, len(samples), BATCH_SIZE):
            try:
                upload_queue.put_nowait((sid, samples[i:i + BATCH_SIZE]))
            except queue.Full:
                upload_stats["batches_dropped"] += 1
                print(f"[bridge] Antrean upload penuh, buang {len(samples[i:i + BATCH_SIZE])} sampel")


def uploader_loop():
    http = requests.Session()
    while True:
        sid, samples = upload_queue.get()
        try:
            for attempt in range(1, UPLOAD_RETRIES + 1):
                try:
                    resp = http.post(f"{NEXTJS_BASE_URL}/api/sessions/{sid}/emg",
                                     json={"samples": samples}, timeout=10)
                    if resp.status_code == 201:
                        upload_stats["batches_sent"] += 1
                        break
                    print(f"[bridge] Gagal kirim batch ({resp.status_code}): {resp.text[:200]}")
                    if 400 <= resp.status_code < 500:
                        break      # payload/sesi salah, percobaan ulang tidak akan membantu
                except requests.RequestException as e:
                    print(f"[bridge] Error koneksi ke Next.js (percobaan {attempt}): {e}")
                time.sleep(0.5 * attempt)
            else:
                upload_stats["batches_failed"] += 1
                print(f"[bridge] Batch {len(samples)} sampel untuk sesi {sid} HILANG setelah {UPLOAD_RETRIES} percobaan")
        finally:
            upload_queue.task_done()


def wait_upload_idle(timeout_s: float) -> bool:
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        if upload_queue.unfinished_tasks == 0:
            return True
        time.sleep(0.05)
    return False


# ============================================
# Local API server (FastAPI) -- dipanggil oleh Next.js SessionRunner
# ============================================

app = FastAPI()

# Browser menganggap localhost:3000 (Next.js) dan localhost:8000 (bridge ini)
# sebagai origin yang BERBEDA meski sama-sama "localhost" -- tanpa CORS
# middleware ini, browser akan blokir fetch() dari SessionRunner.tsx.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],  # sesuaikan kalau Next.js jalan di port lain
    allow_methods=["*"],
    allow_headers=["*"],
)


class SessionStartRequest(BaseModel):
    sessionId: str


class PhaseUpdateRequest(BaseModel):
    sessionId: str
    phase: str


@app.post("/session/start")
def session_start(req: SessionStartRequest):
    flush_batch(force=True)      # sisa sampel sesi sebelumnya tetap ke sesi itu
    state.set_session(req.sessionId)
    return {"ok": True}


@app.post("/session/end")
def session_end():
    flush_batch(force=True)
    state.end_session()
    # Tunggu batch terakhir masuk DB supaya halaman ringkasan sesi langsung lengkap.
    drained = wait_upload_idle(5.0)
    return {"ok": True, "uploadsDrained": drained}


@app.put("/phase")
def phase_update(req: PhaseUpdateRequest):
    """Dipanggil oleh Next.js SessionRunner.tsx setiap rAF tick (di-throttle
    di sisi Next.js). Hanya mengubah state kalau sessionId cocok dan phase
    valid, supaya event basi dari sesi lama tidak salah ubah state."""
    if req.sessionId != state.session_id:
        return {"ok": False, "reason": "sessionId tidak cocok dengan sesi aktif di bridge"}
    if req.phase not in VALID_PHASES:
        return {"ok": False, "reason": f"phase '{req.phase}' tidak dikenal"}

    state.update_phase(req.phase)
    return {"ok": True, "currentPhase": state.current_phase}


def measured_rate_hz() -> Optional[float]:
    now = time.time()
    while rate_window and now - rate_window[0][0] > 2.0:
        rate_window.popleft()
    if len(rate_window) < 2:
        return None
    span = rate_window[-1][0] - rate_window[0][0]
    count = sum(n for _, n in list(rate_window)[1:])
    return round(count / span, 1) if span > 0 else None


@app.get("/health")
def health():
    now = time.time()
    last_ago = round(now - state.last_sample_time, 1) if state.last_sample_time else None
    # Sinyal dianggap aktif hanya jika sample terakhir masuk dalam 2.5 detik terakhir
    is_streaming = (last_ago is not None and last_ago < 2.5)
    # Alat dianggap hidup/terhubung hanya jika port USB terbuka DAN sinyal benar-benar mengalir
    device_active = state.serial_connected and is_streaming
    return {
        "ok": True,
        "bridgeRunning": True,
        "serialConnected": device_active,
        "portOpened": state.serial_connected,
        "isStreaming": is_streaming,
        "lastSampleAgoSec": last_ago,
        "totalSamplesReceived": state.total_samples_received,
        "sampleRateHz": measured_rate_hz() if is_streaming else None,
        "expectedSampleRateHz": SAMPLE_RATE_HZ,
        "droppedSamples": state.dropped_samples,
        "sessionDroppedSamples": state.session_dropped_samples,
        "deviceRestarts": state.device_restarts,
        "framesOk": parser_stats["frames_ok"],
        "crcErrors": parser_stats["crc_errors"],
        "uploadQueue": upload_queue.qsize(),
        "uploadBatchesSent": upload_stats["batches_sent"],
        "uploadBatchesFailed": upload_stats["batches_failed"] + upload_stats["batches_dropped"],
        "port": SERIAL_PORT,
        "baudrate": SERIAL_BAUDRATE,
        "sessionId": state.session_id,
        "currentPhase": state.current_phase,
        "bufferSize": len(batch_buffer),
    }


# ============================================
# Serial reader
# ============================================

def handle_samples(samples):
    rows = []
    for seq, raw, env in samples:
        meta = state.next_sample_meta(seq)
        if meta is None:
            continue
        sid = meta.pop("sessionId")
        meta.update({
            "r1": raw[0], "r2": raw[1], "r3": raw[2], "r4": raw[3], "r5": raw[4], "r6": raw[5],
            "p1": env[0], "p2": env[1], "p3": env[2], "p4": env[3], "p5": env[4], "p6": env[5],
        })
        rows.append((sid, meta))
    if samples:
        rate_window.append((time.time(), len(samples)))
    if rows:
        with batch_lock:
            batch_buffer.extend(rows)


def sync_parser_stats(parser: FrameParser, base: dict):
    parser_stats["frames_ok"] = base["frames_ok"] + parser.frames_ok
    parser_stats["crc_errors"] = base["crc_errors"] + parser.crc_errors
    parser_stats["bytes_skipped"] = base["bytes_skipped"] + parser.bytes_skipped


def serial_reader_loop():
    while True:
        ser = None
        try:
            print(f"[bridge] Mencoba membuka Serial port {SERIAL_PORT}...")
            ser = serial.Serial(SERIAL_PORT, SERIAL_BAUDRATE, timeout=0.05)
            try:
                ser.set_buffer_size(rx_size=SERIAL_RX_BUFFER_BYTES, tx_size=4096)  # Windows saja
            except (AttributeError, serial.SerialException):
                pass
            ser.reset_input_buffer()
            with state.lock:
                state.serial_connected = True
            print(f"[bridge] Serial port {SERIAL_PORT} terhubung. Menunggu frame dari firmware...")

            parser = FrameParser()
            base = dict(parser_stats)
            while True:
                data = ser.read(max(1, ser.in_waiting))
                if data:
                    handle_samples(parser.feed(data))
                    sync_parser_stats(parser, base)
                flush_batch()

        except (serial.SerialException, OSError) as e:
            with state.lock:
                state.serial_connected = False
            print(f"[bridge] Port serial {SERIAL_PORT} terputus / alat mati: {e}. Mencoba lagi dalam 2 detik...")
        except Exception as e:
            with state.lock:
                state.serial_connected = False
            print(f"[bridge] Error tak terduga serial reader: {e!r}. Mencoba lagi...")
        finally:
            if ser is not None and ser.is_open:
                try:
                    ser.close()
                except Exception:
                    pass
        time.sleep(2)


def run_local_api():
    uvicorn.run(app, host="127.0.0.1", port=LOCAL_API_PORT, log_level="warning")


if __name__ == "__main__":
    threading.Thread(target=uploader_loop, daemon=True).start()
    threading.Thread(target=run_local_api, daemon=True).start()
    print(f"[bridge] Local API server jalan di http://127.0.0.1:{LOCAL_API_PORT}")
    print(f"[bridge] Mode firmware: frame biner {SAMPLE_RATE_HZ} Hz, "
          f"transition guard {TRANSITION_GUARD_SAMPLES} sampel")

    try:
        serial_reader_loop()
    except KeyboardInterrupt:
        print("\n[bridge] Dihentikan oleh pengguna, kirim sisa buffer...")
        flush_batch(force=True)
        wait_upload_idle(5.0)
