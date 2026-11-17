# AGENTS.md — sEMG Data Acquisition System

Konteks proyek untuk AI coding agent (Claude, dll) yang bekerja di repo ini.
Dokumen ini menggantikan versi sebelumnya yang berbasis BLE — proyek sudah
pivot total ke koneksi Serial (kabel USB) untuk menghindari masalah
link drop/reconnect BLE.

## Apa proyek ini

Sistem akuisisi data EMG (electromyography) untuk riset/skripsi. Terdiri dari
tiga komponen yang saling terhubung:

1. **Web app (repo ini)** — Next.js 16 + Prisma 7 + PostgreSQL. Berperan
   sebagai **Master Clock tunggal**: memandu partisipan menjalani siklus
   Persiapan → Aksi → Istirahat per repetisi gesture (`SessionRunner.tsx`),
   mencatat semua transisi fase ke `EventLog`, DAN secara aktif melaporkan
   fase aktif ke Python Bridge lewat local HTTP API setiap rAF tick.
2. **Firmware** (`firmware/emg_1khz/emg_1khz.ino` + `emg_dsp.h`) — berjalan
   di Seeed XIAO nRF52840 (Sense), membaca 6 channel sensor EMG "Hello SEMG by
   Cheez" **tepat 1000 Hz** (TIMER4 → PPI → SAADC scan + EasyDMA, CPU tidak
   ada di jalur sampling), mengirim frame biner raw + envelope lewat **Serial
   satu arah** (device → komputer saja). Firmware **tidak** tahu apa-apa soal
   fase atau sesi — sengaja dibuat "bodoh" dan stabil. Satu-satunya info waktu
   yang dikirim adalah nomor urut sampel sejak device menyala.
   Board: core "Seeed nRF52 Boards" (`Seeeduino:nrf52:xiaonRF52840Sense`,
   direkomendasikan) atau core mbed (`Seeeduino:mbed:xiaonRF52840Sense`).
   Firmware lama (analogRead + delay, nyatanya ~150 Hz tidak teratur) ada di
   riwayat git dengan nama `multiple_emg_sensors_terbaru.ino`.
3. **Python Bridge** (`emg_bridge.py`, dijalankan terpisah di laptop/PC,
   tidak masuk repo Next.js ini) — punya DUA peran sekaligus:
   - Membaca data sensor dari Serial port secara kontinu.
   - Menjalankan **local API server** (FastAPI, port 8000) yang menerima
     laporan fase aktif dari Next.js, menempelkan label `phase` itu ke
     sample Serial yang sedang mengalir, lalu bulk-insert ke `EmgRecord`
     lewat HTTP POST ke Next.js.

## Strategi: "Web-Driven Labeling via Local Python API"

Ini adalah keputusan arsitektur inti — **jangan diubah tanpa diskusi ulang**.

Tiga pendekatan dipertimbangkan sebelum keputusan ini:
- **Opsi A** (Bridge subscribe SSE `/api/trigger`, seperti gateway BLE lama):
  ditolak karena delay SSE atas jaringan tidak deterministik, berisiko salah
  label di garis transisi.
- **Opsi B** (firmware menerima command balik dari Next.js via Serial):
  ditolak karena memaksa firmware membaca input sambil terus mengirim data,
  berisiko mengganggu timing sampling (jitter).
- **Opsi C — DIPILIH**: Next.js mengirim status fase aktif ke local HTTP API
  yang dijalankan oleh Python Bridge itu sendiri (bukan SSE, bukan lewat
  firmware). Localhost-to-localhost, jadi jauh lebih cepat dan stabil
  dibanding SSE over jaringan, dan firmware tetap satu arah/bodoh.

**Catatan penting:** latensi TIDAK hilang total dengan Opsi C, hanya
diperkecil ke orde milidetik lokal (HTTP round-trip localhost), dari orde
yang lebih besar/tidak pasti di pendekatan lain. Karena itu ada mekanisme
**transition guard** (lihat poin 3 di bawah) untuk menandai sample yang
berpotensi salah label di sekitar garis batas transisi fase.

## Arsitektur data flow

```
[XIAO nRF52840 + 6ch EMG]
        │ Serial, satu arah, kontinu: 1 frame biner tiap 10 ms
        │ = nomor urut + 10 sampel x (6 raw + 6 envelope) + CRC16
        │ (firmware tidak tahu fase/sesi sama sekali)
        ▼
[Python Bridge - emg_bridge.py, laptop/PC yang sama]
   ├─ Serial reader thread: parse frame + cek CRC, tempel sampleIndex +
   │  elapsedMs (dari nomor urut device) + phase (dari state lokal) +
   │  isTransition (dari transition guard)
   ├─ Uploader thread: kirim batch ke Next.js (retry), terpisah dari reader
   └─ FastAPI server (port 8000):
        PUT  /phase          <── dipanggil Next.js tiap rAF tick (throttled)
        POST /session/start  <── dipanggil Next.js saat SESSION_START
        POST /session/end    <── dipanggil Next.js saat SESSION_END/ABORT
        │
        │ HTTP POST batch (buffer penuh ATAU tiap ~250ms, mana dulu)
        ▼
[POST /api/sessions/[id]/emg] ──→ prisma.emgRecord.createMany ──→ PostgreSQL


[Next.js SessionRunner.tsx]
        │ requestAnimationFrame loop, tiap tick:
        │   1. hitung elapsed time vs SessionConfig durations (lastPhase lokal)
        │   2. update EventLog jika ada transisi (TIDAK BERUBAH dari sebelumnya)
        │   3. reportPhaseToBridge(lastPhase) -- PUT localhost:8000/phase  <-- BARU
        ▼
   (lihat poin di atas, masuk ke Python Bridge)
```

Web app dan bridge berjalan di **komputer yang sama (localhost)**. Phase
report dari Next.js ke Bridge memang punya delay non-zero (HTTP round-trip
lokal), tapi orde besarnya jauh lebih kecil dan lebih stabil dibanding
delay SSE atas jaringan yang dipakai di sistem BLE lama.

## Keputusan desain kunci (jangan diubah tanpa diskusi ulang)

### 1. Continuous Recording, label ditempel real-time (bukan post-hoc)
Berbeda dari sistem BLE lama (yang merekam kontinu lalu segmentasi fase
dilakukan belakangan di preprocessing Python/Pandas dengan join timestamp ke
`EventLog`), sekarang:
- Bridge tetap merekam **kontinu** dari `SESSION_START` sampai
  `SESSION_END`/`SESSION_ABORT`, mencakup ketiga fase.
- Tapi label `phase` ditempel **saat insert**, langsung di kolom
  `EmgRecord.phase` (enum), berdasarkan state fase terakhir yang dilaporkan
  Next.js ke bridge.
- **Tidak perlu lagi** join `EmgRecord` ke `EventLog` untuk tahu fase suatu
  sample — fase sudah jadi bagian dari row itu sendiri. Ini menyederhanakan
  preprocessing dibanding sistem lama secara signifikan.
- `EventLog` tetap dipertahankan untuk mencatat histori transisi fase di sisi
  Web (audit trail / debugging UI), tapi BUKAN lagi sumber kebenaran untuk
  segmentasi data EMG.

### 2. Web app sebagai Master Clock tunggal (tidak berubah)
Next.js `SessionRunner.tsx` tetap satu-satunya pemilik linimasa sesi —
menghitung kapan transisi PREPARATION → ACTION → REST terjadi berdasarkan
`SessionConfig` durations, dan mencatatnya ke `EventLog`. Bridge **tidak**
pernah menentukan fase sendiri — bridge cuma menyimpan state `currentPhase`
yang dikirim oleh Next.js, dan menempelkannya ke sample yang mengalir dari
Serial.

Implementasi di sisi Next.js (`SessionRunner.tsx`):
- `reportPhaseToBridge(phase)` dipanggil dari dalam `tick()` rAF loop
  menggunakan variabel `lastPhase` LOKAL (bukan state React `phase`, yang
  bisa stale di closure) — ini penting, jangan diubah jadi membaca state
  `phase` langsung di titik ini.
- Dipanggil segera setiap kali phase berubah (transisi PREP→ACTION setelah
  countdown, transisi ACTION→REST, REST→PREPARATION repetisi baru), dan
  di-throttle ke maksimal sekali per `PHASE_REPORT_THROTTLE_MS` (100ms) saat
  phase tidak berubah — supaya tidak spam HTTP request tiap frame.
- `notifyBridgeSessionStart()` dipanggil tepat saat `SESSION_START` di-log
  (akhir pre-start countdown 3-2-1).
- `notifyBridgeSessionEnd()` dipanggil di titik akhir sesi: selesai normal
  (repetisi terakhir selesai) maupun abort oleh admin.
- Semua pemanggilan ke bridge bersifat **fire-and-forget** (`.catch(() => {})`)
  — kegagalan koneksi ke bridge TIDAK BOLEH menghentikan Master Clock
  Next.js. Kalau bridge belum dijalankan operator, sesi tetap berjalan
  normal di sisi Web, cuma data EMG tidak ikut terekam.
- Logika lama "freeze linimasa saat BLE disconnect" (`isPausedRef`,
  `gatewayConnected`, polling `gateway-status`, banner merah) **sudah
  dihapus seluruhnya** dari `SessionRunner.tsx` — tidak ada lagi skenario
  pause-on-disconnect karena Serial kabel tidak punya itu.

### 3. Transition guard — mitigasi delay lokal
Karena ada delay non-zero antara "Next.js memutuskan fase berubah" dan
"Bridge menerima pemberitahuan itu", beberapa sample tepat di garis transisi
berisiko tercatat dengan label fase yang sudah basi (misal masih
`PREPARATION` padahal sebenarnya sudah masuk `ACTION`).

Mitigasi: setiap kali state `currentPhase` di bridge berubah, `N` sample
pertama berikutnya (`TRANSITION_GUARD_MS` di `emg_bridge.py`, default 50 ms =
50 sample pada 1000 Hz, mencakup jeda Next.js → bridge plus satu frame
firmware 10 ms; **belum diukur dengan hardware nyata**) ditandai
`EmgRecord.isTransition = true`. Sample ini **tidak
dibuang** di level bridge/DB — keputusan dibuang atau dipakai diserahkan ke
tahap preprocessing, supaya tetap fleksibel (misal kalau ternyata delay
nyata jauh lebih kecil dari estimasi, sample ini masih bisa dipakai).

### 4. Firmware satu arah, sengaja dibuat "bodoh"
Firmware XIAO nRF52840 **tidak** membaca apa pun dari Serial (tidak ada
command masuk, tidak ada acknowledgment). Ini sengaja, untuk menghindari
risiko jitter sampling akibat firmware harus polling `Serial.available()` di
tengah loop pengiriman data. Konsekuensinya: semua kepintaran (kapan sesi
mulai/berhenti, fase aktif, transition guard) ada di sisi Python Bridge,
bukan firmware.

**Implikasi:** belum ada mekanisme reset counter via tombol fisik di
firmware. Firmware hanya mengirim nomor urut sampel sejak menyala (satu
clock: timer hardware device). Bridge menjadikannya `sampleIndex` = nomor urut
dikurangi nomor urut sampel pertama setelah `POST /session/start`, dan
`elapsedMs` = `sampleIndex` × 1000 / 1000 Hz. Sample yang hilang (USB macet,
ring buffer firmware penuh) terlihat sebagai **celah** di `sampleIndex`,
bukan disamarkan. Kalau device reset di tengah sesi, bridge melanjutkan
`sampleIndex` dari angka terakhir. Kalau ke depannya dibutuhkan tombol fisik di device
untuk memulai sesi tanpa laptop, ini perlu didiskusikan ulang karena akan
melanggar prinsip "firmware bodoh, satu arah" di atas.

### 5. Format frame Serial
Firmware mengirim satu frame biner tiap 10 ms (little-endian, definisi
lengkap di `firmware/emg_1khz/emg_dsp.h`, parser di `FrameParser` pada
`emg_bridge.py` — keduanya harus diubah bersama):
```
A5 5A | version=1 | scans=10 | seq u32 | raw u16[10][6] | env u32[10][6] | CRC-16/CCITT-FALSE
```
370 byte per frame (37 KB/s). `raw` = ADC 12-bit (0..4095 = 0..3.6 V),
`env` = sinyal setelah high-pass 20 Hz, notch 50 Hz, low-pass 150 Hz,
dikuadratkan. Urutan channel A0..A5 → `r1..r6` dan `p1..p6`. Data yang
direkam sebelum firmware ini (Juli–November 2026) memakai ADC 10-bit,
~150 Hz, dan kolomnya tersimpan selang-seling (`r1`=raw ch1, `r2`=envelope
ch1, …) — jangan digabung langsung dengan rekaman baru.

Untuk cek manual di Serial Monitor, compile dengan `OUTPUT_BINARY 0`
(CSV `seq,r1..r6,p1..p6`); bridge hanya menerima mode biner.

## Skema database tambahan (di luar starter Next.js default)

- `EmgRecord` — satu baris per sample Serial yang diterima bridge selama
  sesi aktif.
  - `sampleIndex` (Int) — counter urutan murni 0..n per sesi, di-generate
    oleh bridge, reset tiap `session/start`.
  - `elapsedMs` (Int) — milidetik sejak `session/start` diterima bridge,
    juga di-generate bridge (bukan dari `millis()` firmware) — aman dari
    overflow karena durasi sesi jauh di bawah batas `Int` 32-bit.
  - `phase` (enum `Phase`: `PREPARATION` | `ACTION` | `REST`) — label
    supervised learning, ditempel bridge berdasarkan state yang dilaporkan
    Next.js.
  - `isTransition` (Boolean, default `false`) — `true` untuk N sample
    pertama setelah perubahan fase (lihat poin 3 di atas).
  - `r1..r6`, `p1..p6` (Float) — raw dan processed/envelope per channel.
  - `createdAt` — wall-clock metadata saja, **bukan** sumber urutan (pakai
    `sampleIndex`/`elapsedMs` untuk itu).
  - Index: `[sessionId, phase]` dan `[sessionId, sampleIndex]`.

Model `EmgSample` dan `GatewayEvent` dari sistem BLE lama **sudah dihapus**
sepenuhnya dari schema — termasuk relasi `Session.emgSamples` dan
`Session.gatewayEvents` (diganti `Session.emgRecords`). Tidak ada lagi
konsep "gap koneksi" karena Serial kabel tidak punya skenario
disconnect/reconnect seperti BLE.

## File penting yang BELUM PERNAH DICEK — wajib dibaca sebelum lanjut

**Catatan untuk agent yang melanjutkan pekerjaan ini:** seluruh dokumen ini
ditulis berdasarkan riwayat diskusi dan file-file yang sejauh ini diunggah ke
sesi sebelumnya. Daftar di bawah adalah file yang **diketahui ada** (disebut
langsung di kode atau di percakapan) tapi **isinya belum pernah dilihat**.
Jangan asumsikan isinya cocok dengan deskripsi di dokumen ini sebelum
benar-benar membacanya — terutama untuk file API route, karena perubahan
skema (`EmgSample`/`GatewayEvent` → `EmgRecord`) hampir pasti membuat
beberapa di antaranya tidak lagi cocok dengan database yang ada sekarang.

1. **`/api/sessions/[id]/gateway-status/route.ts`** (path perkiraan,
   nama file pasti belum dikonfirmasi) — endpoint ini disebut di
   `SessionRunner.tsx` versi LAMA (sebelum dibersihkan) dan kemungkinan masih
   ada di repo, mengacu ke model `GatewayEvent` yang sudah dihapus dari
   schema. Kalau masih ada dan masih diimpor/dipanggil dari tempat lain
   (bukan `SessionRunner.tsx`, karena pemanggilannya sudah saya hapus dari
   situ), endpoint ini akan gagal di-build atau error runtime karena
   `prisma.gatewayEvent` tidak ada lagi.

2. **`emg_gateway.py`** (script BLE lama, di luar repo Next.js, disebut di
   `AGENTS.md` versi sebelumnya) — ini gateway BLE yang digantikan oleh
   `emg_bridge.py` (Serial). Belum dikonfirmasi apakah file ini masih
   dijalankan/dipakai di workflow Anda atau sudah ditinggalkan total. Kalau
   masih ada di komputer Anda dan tidak sengaja dijalankan bersamaan dengan
   `emg_bridge.py`, dua proses ini akan rebutan jadi satu-satunya penulis ke
   `/api/sessions/[id]/emg` dengan bentuk payload yang BERBEDA (yang lama
   kirim `raw`/`envelope` sebagai array ke `EmgSample`, yang baru kirim
   `r1..r6`/`p1..p6` flat ke `EmgRecord`) — keduanya akan gagal terhadap
   schema yang sekarang.

3. **Endpoint API lain yang mungkin query `EmgSample` atau `GatewayEvent`**
   secara langsung (misal halaman dashboard/visualisasi data sesi, export
   CSV, atau endpoint summary) — belum diaudit sama sekali. Jalankan
   `grep -rn "emgSample\|gatewayEvent\|EmgSample\|GatewayEvent" .` dari root
   repo Next.js (di luar `node_modules`) untuk menemukan semua pemakaian yang
   tersisa sebelum migration dijalankan, karena `prisma migrate dev` akan
   drop tabel-tabel itu dan kode apa pun yang masih mereferensikannya akan
   error saat dipanggil (TypeScript mungkin masih lolos compile kalau ada
   `any`/cast, tapi runtime akan gagal).

4. **`/api/sessions/[id]/events/route.ts`** (endpoint yang menerima
   `flushEvents()` dari `SessionRunner.tsx`) — belum pernah dilihat isinya.
   Tidak ada perubahan yang seharusnya dibutuhkan di sini (event logging
   tidak tersentuh oleh pivot BLE→Serial), tapi belum dikonfirmasi langsung;
   cek kalau ada perilaku tak terduga terkait `EventLog`.

5. **Skrip/halaman preprocessing Python (Pandas) untuk tahap ML** — disebut
   beberapa kali sebagai rencana ke depan (mencocokkan `phase`, memakai
   `isTransition`, dst) tapi belum ada satu pun file aktual yang diunggah
   atau ditulis. Kalau sudah ada draft di sisi Anda, agent berikutnya perlu
   melihatnya untuk memastikan asumsi nama kolom (`sampleIndex`, `elapsedMs`,
   `isTransition`) di sana cocok dengan schema final di atas.

**Cara tercepat memverifikasi semua ini:** minta operator (Rayhan) untuk
mengunggah hasil `grep -rln "EmgSample\|GatewayEvent\|gateway-status" .`
dari root repo Next.js, plus folder tempat `emg_gateway.py` (lama) dan
`emg_bridge.py` (baru) berada, sebelum melanjutkan implementasi apa pun yang
menyentuh data flow EMG.

## Hal yang sudah diverifikasi vs yang belum

**Sudah diverifikasi:**
- Skema Prisma `EmgRecord` + enum `Phase` valid secara sintaks (review
  manual, belum pernah dijalankan `prisma migrate dev` ke Postgres
  sungguhan untuk skema ini).
- Integrasi `reportPhaseToBridge`/`notifyBridgeSessionStart`/
  `notifyBridgeSessionEnd` di `SessionRunner.tsx` sudah ditempel langsung ke
  file produksi (bukan ilustrasi terpisah lagi), dengan urutan deklarasi
  `useCallback` yang benar (dideklarasikan sebelum dipakai di `nextPhase`
  dan `useEffect` main timer loop) — diverifikasi lewat pembacaan kode
  manual, **belum** dites dijalankan di browser sungguhan.
- Penghapusan logika BLE (`isPausedRef`, `gatewayConnected`, polling
  `gateway-status`, banner merah) dari `SessionRunner.tsx` sudah diverifikasi
  tidak menyisakan referensi rusak (grep menyeluruh, hasil bersih).

**Belum diverifikasi** (butuh hardware/runtime asli, tidak tersedia di
sandbox yang dipakai untuk mengembangkan ini):
- Firmware `emg_1khz` sudah lolos compile di kedua core, dan format frame +
  filter-nya sudah dites di PC (kode `emg_dsp.h` yang sama dikompilasi native,
  frame-nya di-parse `FrameParser`). **Belum** dijalankan di XIAO sungguhan:
  laju 1000 Hz, throughput USB, dan nilai ADC dari sensor masih perlu dicek
  lewat `GET /health` (`sampleRateHz`, `droppedSamples`, `crcErrors`).
- Local FastAPI server (port 8000) belum pernah dites menerima request
  sungguhan dari `SessionRunner.tsx` di browser — termasuk soal apakah
  throttle 100ms (`PHASE_REPORT_THROTTLE_MS`) sudah pas atau perlu
  disesuaikan setelah dites nyata.
- Nilai `TRANSITION_GUARD_MS` (default 50 ms = 50 sample pada 1000 Hz) adalah
  perkiraan, **belum dikalibrasi** terhadap jeda Next.js → bridge yang terukur
  nyata.
- `prisma.emgRecord.createMany` di `POST /api/sessions/[id]/emg/route.ts`
  belum pernah dites dengan Prisma Client yang sudah di-generate dari
  schema baru — pastikan jalankan `npx prisma generate` setelah migration.
- Migrasi Prisma (`npx prisma migrate dev`) untuk schema `EmgRecord` belum
  pernah dijalankan ke database PostgreSQL sungguhan.
- Route API lama yang masih mereferensikan `EmgSample`/`gateway-status` di
  sisi server (kalau ada selain `SessionRunner.tsx`) **belum dibersihkan** —
  perlu di-audit terpisah, di luar scope perubahan `SessionRunner.tsx` yang
  sudah dilakukan.

Kalau menyentuh area-area di atas, uji ulang sebelum menganggap kode "sudah
pasti jalan" — terutama bagian firmware (format output Serial) dan
kalibrasi `TRANSITION_GUARD_SAMPLES`, karena keduanya paling bergantung pada
hardware spesifik yang tidak bisa disimulasikan di sandbox ini.

## Konvensi kode yang sudah dipakai di repo ini

- Endpoint API dinamis pakai pola `params: Promise<{ id: string }>` (Next.js
  15+ App Router async params), bukan `params: { id: string }` langsung.
- Semua tabel pakai `id String @id @default(cuid())`, bukan auto-increment.
- Relasi ke `Session` selalu `onDelete: Cascade`.
- Field enum (`Phase`) dipakai untuk label kategorikal yang akan jadi target
  supervised learning — hindari `String` bebas untuk kolom semacam ini,
  supaya tervalidasi di level database, bukan cuma harapan dari sisi
  aplikasi.
- Field yang jadi sumber urutan/waktu untuk time-series (`sampleIndex`,
  `elapsedMs`) di-generate di satu titik tunggal (Python Bridge), bukan
  digabung dari beberapa sumber clock berbeda — hindari pola lama
  (`deviceTimestampUs` dari firmware + `receivedAt` dari server) yang
  rentan konflik antar-clock.
- Panggilan dari `SessionRunner.tsx` ke Python Bridge (`localhost:8000`)
  selalu fire-and-forget (`.catch(() => {})`) — jangan pernah `await` di
  jalur kritis rAF/UI, dan jangan biarkan kegagalan bridge menghentikan
  Master Clock Next.js.
