# Sistem Akuisisi sEMG

Sistem akuisisi data untuk merekam sinyal electromyography permukaan (sEMG) dari 12 gesture jari-telapak tangan. Dibuat untuk penelitian *Machine Learning-Based sEMG Finger-Palm Gesture Classification for One-Handed Mixed Reality Text Input*.

Sistem ini terdiri dari tiga bagian yang berjalan di satu PC Windows:

| Bagian | Fungsi | Kode |
| --- | --- | --- |
| Firmware | Membaca 6 channel sEMG tepat 1000 Hz pada Seeed XIAO nRF52840 dan mengirimkannya lewat USB | `firmware/emg_1khz/` |
| Bridge Python | Membaca aliran USB, menempelkan fase protokol ke setiap sampel, lalu mengunggahnya | `emg_bridge.py` |
| Aplikasi web | Memandu partisipan melewati Persiapan → Aksi → Istirahat, mengelola partisipan dan sesi, menyimpan data ke PostgreSQL | `app/`, `prisma/` |

> **Bantuan AI.** Sebagian repositori ini dibuat dengan bantuan asisten AI (Claude, dari Anthropic), termasuk firmware 1000 Hz, protokol bridge biner, pengujian, dan README ini. Semua kode yang dihasilkan AI telah ditinjau, dikompilasi, dan diuji di PC. Firmware **belum diverifikasi pada perangkat fisik**. Ikuti [Langkah 7: Verifikasi rekaman](#7-verifikasi-rekaman) sebelum merekam data sungguhan.

Panduan ini juga tersedia dalam bahasa Inggris di [README.md](README.md).

---

## Cara kerja sistem

```
 Hello sEMG x6 ──analog──> XIAO nRF52840
                             TIMER4 ─PPI─> SAADC (6 ch, 12-bit, 1000 Hz) ─DMA─> buffer RAM
                             loop(): filter envelope + 1 frame biner / 10 ms
                                   │ USB serial (satu arah, ~37 KB/s)
                                   ▼
                         emg_bridge.py ── FastAPI :8000 <── PUT /phase ── layar sesi Next.js
                           parse + cek CRC                  (fase saat ini, tiap frame)
                           beri label fase, sampleIndex
                                   │ HTTP POST batch (thread terpisah)
                                   ▼
                         Next.js :3000  /api/sessions/[id]/emg ──> PostgreSQL tabel "EmgRecord"
```

Aplikasi web adalah satu-satunya penentu waktu protokol. Firmware tidak tahu apa-apa tentang sesi atau fase; firmware hanya menghitung sampel. Bridge mengubah hitungan itu menjadi `sampleIndex` (1 sampel = 1 ms), sehingga setiap sampel yang hilang akan terlihat sebagai celah.

---

## Struktur folder

```
firmware/emg_1khz/
  emg_1khz.ino        pengambilan sampel, output USB
  emg_dsp.h           filter envelope + format frame biner (definisi bersama)
emg_bridge.py         pembaca serial, pemberi label fase, pengunggah, /health
requirements.txt      paket Python untuk bridge
app/                  aplikasi Next.js 16 (panel admin, layar sesi, route API)
prisma/schema.prisma  skema database
public/videos/        video instruksi gesture
AGENTS.md             keputusan desain dan konvensi (bahasa Indonesia)
docs/                 manual pengguna dan screenshot (bahasa Indonesia)
```

---

## Yang dibutuhkan

**Perangkat keras**

- Seeed Studio XIAO nRF52840 atau XIAO nRF52840 Sense
- 6 modul sensor EMG analog "Hello sEMG" (Cheez) dengan elektroda kering
- Kabel USB-C yang mendukung data
- Laptop; sebaiknya dijalankan dengan baterai saat merekam untuk mengurangi gangguan 50 Hz dari listrik PLN

**Perangkat lunak** (versi yang dipakai saat pengembangan)

| Alat | Versi | Unduh |
| --- | --- | --- |
| Arduino IDE | 2.3 atau lebih baru | https://www.arduino.cc/en/software |
| Node.js | 20 atau lebih baru (diuji dengan 24) | https://nodejs.org |
| PostgreSQL | 16 | https://www.postgresql.org/download/ |
| Python | 3.10 atau lebih baru (diuji dengan 3.13) | https://www.python.org |
| Git | versi apa pun | https://git-scm.com |

---

## 1. Pasang sensor

| Sensor | Pin XIAO | Input nRF52840 |
| --- | --- | --- |
| Sinyal channel 1 | A0 | P0.02 / AIN0 |
| Sinyal channel 2 | A1 | P0.03 / AIN1 |
| Sinyal channel 3 | A2 | P0.28 / AIN4 |
| Sinyal channel 4 | A3 | P0.29 / AIN5 |
| Sinyal channel 5 | A4 | P0.04 / AIN2 |
| Sinyal channel 6 | A5 | P0.05 / AIN3 |
| VCC semua sensor | 3V3 | |
| GND semua sensor | GND | |

- **Beri daya sensor dari 3V3, bukan 5V.** Input ADC tidak boleh melebihi 3,3 V. Jika modul hanya bekerja pada 5 V, pasang pembagi tegangan di outputnya.
- A4 dan A5 juga merupakan pin I²C; jangan hubungkan apa pun lain ke pin ini.
- Nomor channel sesuai dengan kolom database: channel *n* → `r<n>` (mentah) dan `p<n>` (envelope).

## 2. Unggah firmware

1. Di Arduino IDE buka **File → Preferences**, lalu tambahkan ini ke *Additional boards manager URLs*:
   `https://files.seeedstudio.com/arduino/package_seeeduino_boards_index.json`
2. Buka **Tools → Board → Boards Manager**, cari *Seeed nRF52*, lalu pasang **Seeed nRF52 Boards** (diuji dengan versi 1.1.13).
3. Buka `firmware/emg_1khz/emg_1khz.ino`.
4. Pilih **Tools → Board → Seeed nRF52 Boards → Seeed XIAO nRF52840 Sense** (atau *Seeed XIAO nRF52840* untuk board non-Sense), lalu pilih port COM board.
5. Klik **Upload**. Jika unggahan gagal, tekan tombol reset dua kali untuk masuk ke mode bootloader, lalu unggah lagi.

Core *Seeed nRF52 mbed-enabled Boards* juga bisa dipakai, tetapi core non-mbed lebih disarankan.

**Pengaturan di bagian atas `emg_1khz.ino`**

| Pengaturan | Nilai default | Ubah jika |
| --- | --- | --- |
| `NOTCH_HZ` | 50 | Listrik di lokasi Anda 60 Hz |
| `OUTPUT_BINARY` | 1 | Isi 0 untuk membaca data sebagai teks di Serial Monitor (bridge hanya menerima nilai 1) |
| `SAMPLE_RATE_HZ` | 1000 | Sebaiknya jangan diubah; harus diubah juga di `emg_bridge.py` |

**Pengecekan cepat:** ubah `OUTPUT_BINARY` menjadi 0, unggah, lalu buka Serial Monitor. Anda seharusnya melihat sekitar 1000 baris per detik dengan format `seq,r1..r6,p1..p6`, dan `seq` naik 1 setiap baris. Nilai mentah sebaiknya berada di sekitar tengah 0–4095 saat istirahat dan berubah ketika otot berkontraksi. Setelah itu, kembalikan ke 1 dan unggah lagi sebelum memakai bridge.

## 3. Siapkan database

1. Pasang PostgreSQL 16 dan catat kata sandi untuk user `postgres`.
2. Buat database:
   ```bash
   psql -U postgres -c "CREATE DATABASE emg_db;"
   ```
3. Clone repositori ini dan pasang paket aplikasi web:
   ```bash
   git clone https://github.com/meizano/semg-acquisition.git
   cd semg-acquisition
   npm install
   ```
4. Buat file bernama `.env` di folder utama proyek (file ini diabaikan oleh git):
   ```env
   DATABASE_URL="postgresql://postgres:<kata-sandi-anda>@localhost:5432/emg_db"
   JWT_SECRET="<string acak yang panjang>"
   ```
5. Buat tabel dan Prisma client:
   ```bash
   npx prisma db push
   npx prisma generate
   ```

> Gunakan `prisma db push`, bukan `prisma migrate dev`. File di `prisma/migrations/` lebih lama daripada `schema.prisma`. Jangan pernah menjalankan `prisma migrate reset` pada database yang berisi rekaman: perintah itu menghapus semua tabel.

**Jika memulihkan backup yang sudah ada** (file `pg_dump` format custom):

```bash
pg_restore -U postgres -d emg_db --no-owner emg_db_full_TAHUN-BULAN-TANGGAL.dump
npx prisma generate
```

## 4. Jalankan aplikasi web

```bash
npm run dev
```

Buka http://localhost:3000/admin. Saat pertama kali dibuka, akun admin dibuat otomatis: username `admin`, kata sandi `admin123`. **Segera ganti kata sandi ini.**

Lalu di panel admin:

1. **Gesture**: tambahkan 12 gesture (Telunjuk/Middle/Manis/Kelingking × Atas/Tengah/Bawah) dan unggah video instruksi untuk tiap gesture.
2. **Konfigurasi**: atur durasi protokol (persiapan, aksi, istirahat dalam detik, dan jumlah repetisi), lalu tandai satu konfigurasi sebagai aktif.

## 5. Jalankan bridge Python

```bash
python -m venv .venv
.venv\Scripts\activate          # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
```

Buka `emg_bridge.py` dan atur `SERIAL_PORT` ke port XIAO (misalnya `"COM3"`; Arduino IDE menampilkannya di **Tools → Port**). Lalu jalankan:

```bash
python emg_bridge.py
```

Jalankan **hanya satu** bridge dalam satu waktu. Bridge kedua tidak bisa membuka port atau port 8000.

Buka http://127.0.0.1:8000/health. Dengan XIAO terpasang, Anda seharusnya melihat `"serialConnected": true` dan `"sampleRateHz"` mendekati `1000`.

## 6. Rekam sesi

1. Di panel admin buka **Buat Sesi Baru**, isi data partisipan, lalu pilih gesture.
2. Buka layar sesi dan tekan mulai. Layar akan menghitung mundur, lalu berganti Persiapan → Aksi → Istirahat sesuai jumlah repetisi yang diatur.
3. Aplikasi web memberi tahu bridge fase yang sedang berjalan; bridge memberi label pada setiap sampel lalu mengunggahnya. Bridge harus sudah berjalan sebelum sesi dimulai, jika tidak, data EMG tidak akan tersimpan.
4. Setelah selesai, buka sesi di **Riwayat Sesi** untuk memeriksa jumlah sampel dan mengekspor CSV atau JSON.

## 7. Verifikasi rekaman

Lakukan ini pada sesi uji singkat sebelum merekam partisipan.

**Kesehatan bridge** — http://127.0.0.1:8000/health

| Field | Nilai yang diharapkan |
| --- | --- |
| `sampleRateHz` | 990–1010 |
| `sessionDroppedSamples` | 0 |
| `crcErrors` | 0 atau sangat sedikit |
| `uploadBatchesFailed` | 0 |

**Pemeriksaan database** (ganti id sesi):

```sql
SELECT count(*) AS total,
       min("sampleIndex") AS idx_min, max("sampleIndex") AS idx_max,
       max("elapsedMs") / 1000.0 AS detik,
       count(*) FILTER (WHERE "isTransition") AS transisi,
       count(*) FILTER (WHERE phase = 'ACTION') AS aksi,
       count(*) FILTER (WHERE phase = 'REST') AS istirahat
FROM "EmgRecord" WHERE "sessionId" = '<id sesi>';
```

Lulus jika `idx_max = total - 1` (tidak ada celah), `total ≈ detik × 1000`, dan `aksi` serta `istirahat` keduanya lebih dari nol.

**Pemeriksaan sinyal** — sebelum mengumpulkan dataset, pastikan sinyal mentah benar-benar berubah antara Aksi dan Istirahat untuk satu orang. Jika nilai mentah berayun di seluruh rentang bahkan saat istirahat, perbaiki dulu kontak elektroda, elektroda referensi, dan gangguan listrik.

---

## Format data

Setiap baris di `EmgRecord` adalah satu sampel:

| Kolom | Arti |
| --- | --- |
| `sessionId` | Tautan ke `Session` (partisipan, gesture, blok pagi/sore) |
| `sampleIndex` | Nomor sampel dalam sesi, berjarak 1 ms; lompatan berarti ada sampel yang hilang |
| `elapsedMs` | `sampleIndex` dalam milidetik |
| `phase` | `PREPARATION`, `ACTION` atau `REST` |
| `isTransition` | `true` untuk 50 ms pertama setelah perubahan fase; label bisa tertinggal dari layar |
| `r1`–`r6` | Hitungan ADC mentah 12-bit (0–4095 = 0–3,6 V), channel A0–A5 |
| `p1`–`p6` | Envelope dari perangkat: high-pass 20 Hz, notch 50 Hz, low-pass 150 Hz, dikuadratkan |
| `gesture` | Nama gesture |

Format frame USB didokumentasikan di `firmware/emg_1khz/emg_dsp.h`. Firmware dan `FrameParser` di `emg_bridge.py` harus selalu diubah bersamaan.

**Rekaman lama tidak kompatibel.** Sesi yang direkam sebelum firmware 1000 Hz (Juli–November 2026) diambil sampelnya sekitar 150 Hz dengan ADC 10-bit, dan kolomnya tersimpan selang-seling (`r1` = mentah ch1, `r2` = envelope ch1, `r3` = mentah ch2, …). Simpan terpisah dari rekaman baru.

**Untuk machine learning**, filter sendiri `r1`–`r6` alih-alih mengandalkan `p1`–`p6`, buang atau kurangi bobot baris `isTransition`, dan pisahkan data latih/uji berdasarkan partisipan atau blok rekaman, jangan berdasarkan jendela dari rekaman yang sama.

---

## Pemecahan masalah

| Masalah | Solusi |
| --- | --- |
| Bridge menampilkan "Port serial ... terputus" | `SERIAL_PORT` salah, kabel hanya untuk mengisi daya, atau program lain (Serial Monitor, bridge kedua) memakai port |
| `sampleRateHz` di `/health` jauh di bawah 1000 | Firmware versi lama atau `OUTPUT_BINARY` bernilai 0; unggah ulang `emg_1khz.ino` |
| `crcErrors` terus bertambah | Kabel USB longgar atau hub; colokkan XIAO langsung ke PC |
| Sesi tidak punya baris EMG | Bridge belum berjalan saat sesi dimulai, atau Next.js tidak di port 3000 |
| `Module not found: app/generated/prisma` | Jalankan `npx prisma generate` |
| Error koneksi database | Layanan PostgreSQL berhenti atau `DATABASE_URL` di `.env` salah |
| Port 3000 sudah dipakai | `npm run dev -- -p 3001`, lalu ubah `NEXTJS_BASE_URL` di `emg_bridge.py` dan origin CORS |

---

## Privasi data

Rekaman, dump database, dan hasil ekspor berisi data pribadi partisipan penelitian. Jangan commit ke repositori ini, dan jangan commit `.env`. Screenshot di `docs/` tidak boleh memperlihatkan nama asli partisipan.

## Ucapan terima kasih

Dikembangkan untuk penelitian pascasarjana di Universiti Teknikal Malaysia Melaka (UTeM), dengan kontribusi dari mahasiswa pengembang proyek. Bantuan AI (Claude, Anthropic) dipakai untuk sebagian kode dan dokumentasi, seperti yang dijelaskan di atas.
