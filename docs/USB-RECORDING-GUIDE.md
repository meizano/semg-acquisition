# USB Recording Guide / Panduan Perekaman via USB

**English** first, then **Bahasa Indonesia** (below).
Bahasa Indonesia ada di bagian bawah dokumen ini.

---

# English

This guide shows how to set up the wearable, the XIAO nRF52840 Sense board, and the
computer for recording the sEMG dataset over a USB cable. Follow the steps in order.
Do not skip the verification steps.

## 0. System overview

```
 Wearable (6 sEMG electrodes on the wrist)
        │ 6 analog wires
        ▼
 XIAO nRF52840 Sense  ── USB-C cable ──  Computer (Windows)
 (firmware: emg_1khz)                    ├─ emg_bridge.py   (reads USB, labels phases)
                                         ├─ Next.js web app (session screen, admin)
                                         └─ PostgreSQL      (stores every sample)
```

- The **web app** decides the timing (Preparation → Action → Rest).
- The **bridge** reads the board at 1000 Hz and tags each sample with the phase.
- The **board** only samples and sends. It does not know about sessions.

## 1. Equipment checklist

- [ ] Seeed XIAO nRF52840 Sense (with its own USB-C cable, data-capable)
- [ ] 6 "Hello sEMG" analog sensor modules (Cheez) with dry electrodes
- [ ] Reference electrode (for the ulnar styloid bone)
- [ ] Wrist strap or band to hold the electrodes
- [ ] Jumper wires or a small breadboard for the 6 signal lines, VCC and GND
- [ ] 70% isopropyl alcohol and lint-free wipes (skin preparation)
- [ ] Foam cushion to support the forearm
- [ ] Laptop (Windows 10 or 11), plugged into mains **or** on battery (battery reduces 50 Hz pickup)
- [ ] Printed consent form and participant code list

## 2. Wearable: fit the electrodes

These steps follow the placement in Chapter 3 of the research proposal. Confirm any
change with your supervisor before you collect data.

1. **Clean the skin.** Wipe the volar (palm-side) forearm near the wrist with 70% IPA.
   Let it dry for about 30 seconds. Do not use lotion on that area.
2. **Place the six electrodes** in a linear array on the palm side of the wrist,
   over the flexor tendons. Space them evenly across the strap. Keep the strap snug, not
   tight, so that each electrode has full skin contact.
3. **Place the reference electrode** over the ulnar styloid (the bony bump on the little-finger side of the wrist).
4. **Support the forearm.** The participant sits with the elbow bent and the forearm resting
   on a foam cushion. The wrist should be in neutral, not touching the table.
5. **Check the contact.** Ask the participant to make a fist. Each channel should
   change visibly. If one channel is flat, re-seat that electrode and re-clean the skin.

## 3. Wiring the board

Power the sensors from **3V3**. Never connect a sensor output above 3.3 V to the board.

| Sensor signal | XIAO pin | Channel name in data |
|---|---|---|
| Channel 1 | A0 | `r1`, `p1` |
| Channel 2 | A1 | `r2`, `p2` |
| Channel 3 | A2 | `r3`, `p3` |
| Channel 4 | A3 | `r4`, `p4` |
| Channel 5 | A4 | `r5`, `p5` |
| Channel 6 | A5 | `r6`, `p6` |
| VCC of all sensors | 3V3 | |
| GND of all sensors and reference | GND | |

- Keep the sensor wires away from the USB cable and from mains chargers.
- A4 and A5 are also I²C pins. Do not connect anything else to them.

## 4. Flash the firmware (one time)

1. Install **Arduino IDE 2.3 or later**.
2. **File → Preferences → Additional boards manager URLs**, add:
   `https://files.seeedstudio.com/arduino/package_seeeduino_boards_index.json`
3. **Tools → Board → Boards Manager**, search `Seeed nRF52`, install **Seeed nRF52 Boards** (version 1.1.13 was tested).
4. Open `firmware/emg_1khz/emg_1khz.ino` from the project folder.
5. Check that `OUTPUT_BINARY` is **1** at the top of the file. The bridge only accepts binary output.
6. **Tools → Board → Seeed nRF52 Boards → Seeed XIAO nRF52840 Sense.**
7. Connect the board by USB. **Tools → Port** should show a new COM port.
8. Click **Upload**. If the upload fails, double-tap the reset button to enter bootloader mode, then upload again.

**Find the COM port.** Open Device Manager → Ports (COM & LPT). Note the number next to
the XIAO (for example `COM7`). You will need it in step 5 of section 6.

## 5. Install the computer software (one time)

1. Install **PostgreSQL 16**. Note the password you set for user `postgres`.
2. Install **Node.js 20 or later**, **Python 3.10 or later**, and **Git**.
3. Create the database:
   ```bash
   psql -U postgres -c "CREATE DATABASE emg_db;"
   ```
4. In the project folder, install the web app packages and create the database tables:
   ```bash
   npm install
   npx prisma db push
   npx prisma generate
   ```
   Use `prisma db push`. Do **not** run `prisma migrate reset`: it deletes all recordings.
5. Create a file named `.env` in the project folder:
   ```env
   DATABASE_URL="postgresql://postgres:<your-password>@localhost:5432/emg_db"
   JWT_SECRET="<a long random string>"
   ```
6. Create the Python environment for the bridge:
   ```bash
   python -m venv .venv
   .venv\Scripts\activate
   pip install -r requirements.txt
   ```

## 6. Start a recording

Do these steps every time you record. Use three terminal windows.

**Step 1: Start the web app** (terminal 1):
```bash
npm run dev
```
Open http://localhost:3000/admin. Log in with username `admin`. The first-time password is
`admin123`; change it immediately.

**Step 2: Check the configuration** (admin panel):
- **Konfigurasi**: one configuration is marked active with the correct durations and repetitions.
- **Gesture**: all 12 gestures are present.

**Step 3: Set the COM port.** Open `emg_bridge.py` and set `SERIAL_PORT` to the port from
section 4 (for example `"COM7"`). Save the file.

**Step 4: Start the bridge** (terminal 2):
```bash
.venv\Scripts\activate
python emg_bridge.py
```
Keep this window open. Only run **one** bridge at a time.

**Step 5: Check the board** (browser, any tab):
open http://127.0.0.1:8000/health

Expected:
- `serialConnected`: `true`
- `sampleRateHz`: between 990 and 1010
- `crcErrors`: `0` or very low

If these numbers are wrong, do not start recording. See section 8.

**Step 6: Check the signal.** Ask the participant to rest. Then ask for a
few fist closures. Check that the channels change between rest and action. If the raw
values swing across the full range even at rest, stop and fix electrode contact or grounding.

**Step 7: Create the session** (admin panel):
1. **Buat Sesi Baru**.
2. In the participant **name** field, enter the **participant code** (for example `P001`),
   not the full name. The form field is labelled for a name, but a code keeps personal names
   out of the database and any exports.
3. Choose the gesture and the session time (morning or afternoon).

**Step 8: Record:**
1. Open the session screen and press start. The screen counts down 3-2-1.
2. The screen then cycles Preparation → Action → Rest for each repetition.
3. The participant follows the on-screen video and cue.
4. When the session finishes, the bridge uploads the last batch automatically.

**Step 9: Verify the recording** (terminal 3, replace the session ID):
```sql
SELECT count(*) AS total,
       min("sampleIndex") AS idx_min, max("sampleIndex") AS idx_max,
       max("elapsedMs") / 1000.0 AS seconds,
       count(*) FILTER (WHERE phase = 'ACTION') AS action,
       count(*) FILTER (WHERE phase = 'REST') AS rest
FROM "EmgRecord" WHERE "sessionId" = '<session id>';
```
Pass if `idx_max = total - 1`, `total` is close to `seconds × 1000`, and `action` and `rest` are both above zero.

Also check `/health` again: `sessionDroppedSamples` should be `0`.

## 7. Session checklist (every session)

- [ ] Participant consent form signed; participant code assigned
- [ ] Skin cleaned, electrodes placed, reference electrode placed
- [ ] Forearm supported, wrist in neutral
- [ ] Bridge running, `/health` checked
- [ ] Session created with the participant code and correct gesture
- [ ] Session completed; last verification query passed
- [ ] Laptop not in power-saving mode during recording

## 8. Troubleshooting

| Problem | What to do |
|---|---|
| No COM port appears | Use a data-capable USB cable. Try another USB port. Double-tap reset and re-check Device Manager. |
| Bridge says "Port serial ... terputus" | Wrong `SERIAL_PORT`, or Arduino Serial Monitor is open (close it). |
| `sampleRateHz` far below 1000 | Board has old firmware or `OUTPUT_BINARY` is 0. Re-upload `emg_1khz.ino` with `OUTPUT_BINARY 1`. |
| `crcErrors` keeps rising | Loose cable or USB hub. Plug the board directly into the laptop. |
| A channel is flat | Electrode not in contact. Re-clean, re-seat, check the wire to the A-pin. |
| Large 50 Hz hum in raw data | Charge the laptop from battery, check the reference electrode, move the sensor wires away from the charger. |
| Session has no EMG rows | Bridge was not running when the session started. Start the bridge first, then create a new session. |
| `Module not found: app/generated/prisma` | Run `npx prisma generate`. |

## 9. Data and privacy

- Enter participant **codes**, not names. Keep the code-to-name list in a locked folder, separate from the data.
- Do not commit `.env`, recordings, database dumps or exports to any repository.
- Screenshots of the admin panel must not show real participant names.
- Old recordings (before the 1000 Hz firmware) are not compatible with new ones. Keep them separate.

---

# Bahasa Indonesia

Panduan ini menjelaskan cara menyiapkan wearable, board XIAO nRF52840 Sense, dan
komputer untuk merekam dataset sEMG melalui kabel USB. Ikuti langkah sesuai urutan.
Jangan lewati langkah verifikasi.

## 0. Gambaran sistem

```
 Wearable (6 elektroda sEMG di pergelangan tangan)
        │ 6 kabel analog
        ▼
 XIAO nRF52840 Sense  ── kabel USB-C ──  Komputer (Windows)
 (firmware: emg_1khz)                    ├─ emg_bridge.py   (membaca USB, memberi label fase)
                                         ├─ Aplikasi web Next.js (layar sesi, admin)
                                         └─ PostgreSQL      (menyimpan setiap sampel)
```

- **Aplikasi web** menentukan waktu (Persiapan → Aksi → Istirahat).
- **Bridge** membaca board pada 1000 Hz dan memberi label fase pada setiap sampel.
- **Board** hanya mengambil dan mengirim sampel. Board tidak tahu tentang sesi.

## 1. Daftar perlengkapan

- [ ] Seeed XIAO nRF52840 Sense (dengan kabel USB-C yang mendukung data)
- [ ] 6 modul sensor analog "Hello sEMG" (Cheez) dengan elektroda kering
- [ ] Elektroda referensi (untuk tulang ulnar styloid)
- [ ] Strap atau gelang untuk menahan elektroda
- [ ] Kabel jumper atau papan breadboard kecil untuk 6 jalur sinyal, VCC, dan GND
- [ ] Alkohol isopropil 70% dan tisu bebas serat (persiapan kulit)
- [ ] Bantalan busa untuk menopang lengan bawah
- [ ] Laptop (Windows 10 atau 11), tersambung ke listrik **atau** memakai baterai (baterai mengurangi gangguan 50 Hz)
- [ ] Formulir persetujuan tercetak dan daftar kode partisipan

## 2. Wearable: pasang elektroda

Langkah ini mengikuti penempatan di Bab 3 proposal penelitian. Konfirmasi setiap
perubahan dengan pembimbing sebelum mengumpulkan data.

1. **Bersihkan kulit.** Seka lengan bawah sisi telapak (sisi volar) di dekat pergelangan
   dengan alkohol 70%. Biarkan kering sekitar 30 detik. Jangan memakai lotion di area itu.
2. **Pasang enam elektroda** dalam susunan garis lurus di sisi telapak pergelangan,
   di atas tendon fleksor. Beri jarak merata di sepanjang strap. Strap harus pas, tidak
   terlalu ketat, agar setiap elektroda menempel penuh di kulit.
3. **Pasang elektroda referensi** di atas ulnar styloid (tonjolan tulang di sisi
   jari kelingking pergelangan).
4. **Topang lengan bawah.** Partisipan duduk dengan siku ditekuk dan lengan bawah
   bertumpu pada bantalan busa. Pergelangan dalam posisi netral, tidak menyentuh meja.
5. **Periksa kontak.** Minta partisipan mengepalkan tangan. Setiap channel harus
   berubah terlihat. Jika ada channel yang datar, pasang ulang elektroda itu dan bersihkan kulit lagi.

## 3. Menyambungkan board

Beri daya sensor dari **3V3**. Jangan pernah menyambungkan output sensor di atas 3,3 V ke board.

| Sinyal sensor | Pin XIAO | Nama channel di data |
|---|---|---|
| Channel 1 | A0 | `r1`, `p1` |
| Channel 2 | A1 | `r2`, `p2` |
| Channel 3 | A2 | `r3`, `p3` |
| Channel 4 | A3 | `r4`, `p4` |
| Channel 5 | A4 | `r5`, `p5` |
| Channel 6 | A5 | `r6`, `p6` |
| VCC semua sensor | 3V3 | |
| GND semua sensor dan referensi | GND | |

- Jauhkan kabel sensor dari kabel USB dan pengisi daya listrik.
- A4 dan A5 juga pin I²C. Jangan hubungkan apa pun lain ke pin ini.

## 4. Unggah firmware (sekali saja)

1. Pasang **Arduino IDE 2.3 atau lebih baru**.
2. **File → Preferences → Additional boards manager URLs**, tambahkan:
   `https://files.seeedstudio.com/arduino/package_seeeduino_boards_index.json`
3. **Tools → Board → Boards Manager**, cari `Seeed nRF52`, pasang **Seeed nRF52 Boards** (versi 1.1.13 sudah diuji).
4. Buka `firmware/emg_1khz/emg_1khz.ino` dari folder proyek.
5. Pastikan `OUTPUT_BINARY` bernilai **1** di bagian atas file. Bridge hanya menerima output biner.
6. **Tools → Board → Seeed nRF52 Boards → Seeed XIAO nRF52840 Sense.**
7. Hubungkan board dengan USB. **Tools → Port** seharusnya menampilkan port COM baru.
8. Klik **Upload**. Jika unggahan gagal, tekan tombol reset dua kali untuk masuk mode bootloader, lalu unggah lagi.

**Cari port COM.** Buka Device Manager → Ports (COM & LPT). Catat nomor di sebelah
XIAO (misalnya `COM7`). Nomor ini dibutuhkan di langkah 3 bagian 6.

## 5. Pasang perangkat lunak komputer (sekali saja)

1. Pasang **PostgreSQL 16**. Catat kata sandi yang Anda buat untuk user `postgres`.
2. Pasang **Node.js 20 atau lebih baru**, **Python 3.10 atau lebih baru**, dan **Git**.
3. Buat database:
   ```bash
   psql -U postgres -c "CREATE DATABASE emg_db;"
   ```
4. Di folder proyek, pasang paket aplikasi web dan buat tabel database:
   ```bash
   npm install
   npx prisma db push
   npx prisma generate
   ```
   Gunakan `prisma db push`. **Jangan** menjalankan `prisma migrate reset`: perintah itu menghapus semua rekaman.
5. Buat file bernama `.env` di folder proyek:
   ```env
   DATABASE_URL="postgresql://postgres:<kata-sandi-anda>@localhost:5432/emg_db"
   JWT_SECRET="<string acak yang panjang>"
   ```
6. Buat lingkungan Python untuk bridge:
   ```bash
   python -m venv .venv
   .venv\Scripts\activate
   pip install -r requirements.txt
   ```

## 6. Memulai perekaman

Lakukan langkah ini setiap kali merekam. Gunakan tiga jendela terminal.

**Langkah 1: Jalankan aplikasi web** (terminal 1):
```bash
npm run dev
```
Buka http://localhost:3000/admin. Login dengan username `admin`. Kata sandi awal
adalah `admin123`; segera ganti.

**Langkah 2: Periksa konfigurasi** (panel admin):
- **Konfigurasi**: satu konfigurasi sudah ditandai aktif dengan durasi dan repetisi yang benar.
- **Gesture**: ke-12 gesture sudah ada.

**Langkah 3: Atur port COM.** Buka `emg_bridge.py` dan atur `SERIAL_PORT` ke port dari
bagian 4 (misalnya `"COM7"`). Simpan file.

**Langkah 4: Jalankan bridge** (terminal 2):
```bash
.venv\Scripts\activate
python emg_bridge.py
```
Biarkan jendela ini terbuka. Jalankan **hanya satu** bridge dalam satu waktu.

**Langkah 5: Periksa board** (browser, tab mana pun):
buka http://127.0.0.1:8000/health

Yang diharapkan:
- `serialConnected`: `true`
- `sampleRateHz`: antara 990 dan 1010
- `crcErrors`: `0` atau sangat sedikit

Jika angka-angka ini tidak sesuai, jangan mulai merekam. Lihat bagian 8.

**Langkah 6: Periksa sinyal.** Minta partisipan beristirahat. Kemudian minta beberapa
kali mengepalkan tangan. Periksa apakah channel berubah antara istirahat dan aksi. Jika
nilai mentah berayun di seluruh rentang bahkan saat istirahat, hentikan dan perbaiki kontak elektroda atau pentanahan.

**Langkah 7: Buat sesi** (panel admin):
1. **Buat Sesi Baru**.
2. Di kolom **nama** partisipan, isi **kode partisipan** (misalnya `P001`), **bukan** nama lengkap.
   Kolom itu diberi label untuk nama, tetapi kode menjaga nama pribadi tetap di luar database dan ekspor.
3. Pilih gesture dan waktu sesi (pagi atau sore).

**Langkah 8: Rekam:**
1. Buka layar sesi lalu tekan mulai. Layar menghitung mundur 3-2-1.
2. Layar kemudian berganti Persiapan → Aksi → Istirahat untuk setiap repetisi.
3. Partisipan mengikuti video dan isyarat di layar.
4. Saat sesi selesai, bridge mengunggah batch terakhir secara otomatis.

**Langkah 9: Verifikasi rekaman** (terminal 3, ganti ID sesi):
```sql
SELECT count(*) AS total,
       min("sampleIndex") AS idx_min, max("sampleIndex") AS idx_max,
       max("elapsedMs") / 1000.0 AS detik,
       count(*) FILTER (WHERE phase = 'ACTION') AS aksi,
       count(*) FILTER (WHERE phase = 'REST') AS istirahat
FROM "EmgRecord" WHERE "sessionId" = '<id sesi>';
```
Lulus jika `idx_max = total - 1`, `total` mendekati `detik × 1000`, dan `aksi` serta `istirahat` keduanya lebih dari nol.

Periksa juga `/health` lagi: `sessionDroppedSamples` seharusnya `0`.

## 7. Daftar periksa setiap sesi

- [ ] Formulir persetujuan partisipan sudah ditandatangani; kode partisipan sudah diberikan
- [ ] Kulit sudah dibersihkan, elektroda dan elektroda referensi sudah terpasang
- [ ] Lengan bawah ditopang, pergelangan netral
- [ ] Bridge berjalan, `/health` sudah diperiksa
- [ ] Sesi dibuat dengan kode partisipan dan gesture yang benar
- [ ] Sesi selesai; query verifikasi terakhir lulus
- [ ] Laptop tidak dalam mode hemat daya selama perekaman

## 8. Pemecahan masalah

| Masalah | Yang harus dilakukan |
|---|---|
| Tidak ada port COM yang muncul | Pakai kabel USB yang mendukung data. Coba port USB lain. Tekan reset dua kali dan periksa Device Manager lagi. |
| Bridge menampilkan "Port serial ... terputus" | `SERIAL_PORT` salah, atau Arduino Serial Monitor masih terbuka (tutup dulu). |
| `sampleRateHz` jauh di bawah 1000 | Board memakai firmware lama atau `OUTPUT_BINARY` bernilai 0. Unggah ulang `emg_1khz.ino` dengan `OUTPUT_BINARY 1`. |
| `crcErrors` terus bertambah | Kabel longgar atau hub USB. Colokkan board langsung ke laptop. |
| Satu channel datar | Elektroda tidak kontak. Bersihkan lagi, pasang ulang, periksa kabel ke pin A. |
| Dengung 50 Hz besar di data mentah | Isi daya laptop dari baterai, periksa elektroda referensi, jauhkan kabel sensor dari pengisi daya. |
| Sesi tidak punya baris EMG | Bridge belum berjalan saat sesi dimulai. Jalankan bridge dulu, lalu buat sesi baru. |
| `Module not found: app/generated/prisma` | Jalankan `npx prisma generate`. |

## 9. Data dan privasi

- Masukkan **kode** partisipan, bukan nama. Simpan daftar kode-ke-nama di folder terkunci, terpisah dari data.
- Jangan commit `.env`, rekaman, dump database, atau ekspor ke repositori mana pun.
- Screenshot panel admin tidak boleh memperlihatkan nama asli partisipan.
- Rekaman lama (sebelum firmware 1000 Hz) tidak kompatibel dengan rekaman baru. Simpan terpisah.
