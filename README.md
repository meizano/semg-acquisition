# sEMG Acquisition System

🇬🇧 English · 🇮🇩 [Bahasa Indonesia](README.id.md)

A data-acquisition system for recording labelled surface electromyography (sEMG) of
12 finger-palm gestures, built for the research project *Machine Learning-Based sEMG
Finger-Palm Gesture Classification for One-Handed Mixed Reality Text Input*.

It has three parts that run on one Windows PC:

| Part | What it does | Code |
| --- | --- | --- |
| Firmware | Samples 6 sEMG channels at exactly 1000 Hz on a Seeed XIAO nRF52840 and streams them over USB | `firmware/emg_1khz/` |
| Python bridge | Reads the USB stream, attaches the current protocol phase to every sample and uploads it | `emg_bridge.py` |
| Web app | Guides the participant through Preparation → Action → Rest, manages participants and sessions, stores everything in PostgreSQL | `app/`, `prisma/` |

> **AI assistance.** Parts of this repository were created with the help of an AI
> assistant (Claude, by Anthropic), including the 1000 Hz firmware, the binary
> bridge protocol, the tests run against them, and this README. All AI-generated
> code was reviewed and compiled, and the bridge was tested on a PC. The firmware
> has **not yet been verified on the physical device**; follow
> [Verify the recording](#7-verify-the-recording) before collecting real data.

---

## How it fits together

```
 Hello sEMG x6 ──analog──> XIAO nRF52840
                             TIMER4 ─PPI─> SAADC (6 ch, 12-bit, 1000 Hz) ─DMA─> RAM ring
                             loop(): envelope filter + 1 binary frame / 10 ms
                                   │ USB serial (one-way, ~37 KB/s)
                                   ▼
                         emg_bridge.py ── FastAPI :8000 <── PUT /phase ── Next.js session screen
                           parse + CRC check                (current phase, every frame)
                           label phase, sampleIndex
                                   │ HTTP POST batches (separate thread)
                                   ▼
                         Next.js :3000  /api/sessions/[id]/emg ──> PostgreSQL "EmgRecord"
```

The web app is the only clock for the protocol. The firmware knows nothing about
sessions or phases; it only counts samples. The bridge turns that count into
`sampleIndex` (1 sample = 1 ms), so any lost sample appears as a gap.

---

## Repository layout

```
firmware/emg_1khz/
  emg_1khz.ino        sampling, USB output
  emg_dsp.h           envelope filters + binary frame format (shared definition)
emg_bridge.py         serial reader, phase labelling, uploader, /health
requirements.txt      Python packages for the bridge
app/                  Next.js 16 app (admin panel, session runner, API routes)
prisma/schema.prisma  database schema
public/videos/        gesture instruction videos
AGENTS.md             design decisions and conventions (Indonesian)
docs/                 user manual and screenshots (Indonesian)
```

---

## What you need

**Hardware**

- Seeed Studio XIAO nRF52840 or XIAO nRF52840 Sense
- 6 × "Hello sEMG" analog EMG sensor modules (Cheez) with dry electrodes
- USB-C data cable
- A laptop, preferably running on battery during recording to reduce 50 Hz mains pickup

**Software** (versions this was built with)

| Tool | Version | Download |
| --- | --- | --- |
| Arduino IDE | 2.3 or later | https://www.arduino.cc/en/software |
| Node.js | 20 or later (tested on 24) | https://nodejs.org |
| PostgreSQL | 16 | https://www.postgresql.org/download/ |
| Python | 3.10 or later (tested on 3.13) | https://www.python.org |
| Git | any | https://git-scm.com |

---

## 1. Wire the sensors

| Sensor | XIAO pin | nRF52840 input |
| --- | --- | --- |
| Channel 1 signal | A0 | P0.02 / AIN0 |
| Channel 2 signal | A1 | P0.03 / AIN1 |
| Channel 3 signal | A2 | P0.28 / AIN4 |
| Channel 4 signal | A3 | P0.29 / AIN5 |
| Channel 5 signal | A4 | P0.04 / AIN2 |
| Channel 6 signal | A5 | P0.05 / AIN3 |
| All sensor VCC | 3V3 | |
| All sensor GND | GND | |

- **Power the sensors from 3V3, not 5V.** The ADC input must never exceed 3.3 V.
  If a module only runs on 5 V, add a voltage divider on its output.
- A4 and A5 are also the I²C pins; do not connect anything else to them.
- Channel numbers map to database columns: channel *n* → `r<n>` (raw) and `p<n>` (envelope).

## 2. Flash the firmware

1. In Arduino IDE open **File → Preferences** and add this to *Additional boards manager URLs*:
   `https://files.seeedstudio.com/arduino/package_seeeduino_boards_index.json`
2. Open **Tools → Board → Boards Manager**, search *Seeed nRF52*, and install
   **Seeed nRF52 Boards** (tested with 1.1.13).
3. Open `firmware/emg_1khz/emg_1khz.ino`.
4. Select **Tools → Board → Seeed nRF52 Boards → Seeed XIAO nRF52840 Sense**
   (or *Seeed XIAO nRF52840* for the non-Sense board) and the board's COM port.
5. Click **Upload**. If the upload fails, double-tap the reset button to enter
   bootloader mode and upload again.

The *Seeed nRF52 mbed-enabled Boards* core also works, but the non-mbed core is recommended.

**Settings at the top of `emg_1khz.ino`**

| Setting | Default | Change it when |
| --- | --- | --- |
| `NOTCH_HZ` | 50 | Your mains is 60 Hz |
| `OUTPUT_BINARY` | 1 | Set to 0 to read the stream as text in Serial Monitor (the bridge only accepts 1) |
| `SAMPLE_RATE_HZ` | 1000 | Avoid changing; must also be changed in `emg_bridge.py` |

**Quick check:** set `OUTPUT_BINARY` to 0, upload, and open Serial Monitor. You should see
about 1000 lines per second in the form `seq,r1..r6,p1..p6`, with `seq` rising by 1 each line.
Raw values should sit near the middle of 0–4095 at rest and swing when you contract.
Set it back to 1 and upload again before using the bridge.

## 3. Set up the database

1. Install PostgreSQL 16 and remember the password you choose for the `postgres` user.
2. Create the database:
   ```bash
   psql -U postgres -c "CREATE DATABASE emg_db;"
   ```
3. Clone this repository and install the web app packages:
   ```bash
   git clone <this repository URL>
   cd <repository folder>
   npm install
   ```
4. Create a file named `.env` in the project root (it is git-ignored):
   ```env
   DATABASE_URL="postgresql://postgres:<your-password>@localhost:5432/emg_db"
   JWT_SECRET="<a long random string>"
   ```
5. Create the tables and the Prisma client:
   ```bash
   npx prisma db push
   npx prisma generate
   ```

> Use `prisma db push`, not `prisma migrate dev`. The files in `prisma/migrations/`
> are older than `schema.prisma`. Never run `prisma migrate reset` on a database that
> holds recordings: it deletes every table.

**Restoring an existing backup instead** (a `pg_dump` custom-format file):

```bash
pg_restore -U postgres -d emg_db --no-owner emg_db_full_YYYY-MM-DD.dump
npx prisma generate
```

## 4. Start the web app

```bash
npm run dev
```

Open http://localhost:3000/admin. On first visit an admin account is created:
username `admin`, password `admin123`. **Change this password straight away.**

Then, in the admin panel:

1. **Gesture**: add the 12 gestures (Telunjuk/Middle/Manis/Kelingking × Atas/Tengah/Bawah)
   and upload an instruction video for each.
2. **Konfigurasi**: set the protocol timing (preparation, action, rest seconds and
   repetitions) and mark one configuration active.

## 5. Start the Python bridge

```bash
python -m venv .venv
.venv\Scripts\activate          # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
```

Open `emg_bridge.py` and set `SERIAL_PORT` to the XIAO's port (for example `"COM3"`;
Arduino IDE shows it under **Tools → Port**). Then run:

```bash
python emg_bridge.py
```

Run **only one** bridge at a time. A second copy cannot open the port or port 8000.

Check http://127.0.0.1:8000/health. With the XIAO plugged in you should see
`"serialConnected": true` and `"sampleRateHz"` close to `1000`.

## 6. Record a session

1. In the admin panel go to **Buat Sesi Baru**, enter the participant details and pick a gesture.
2. Open the session screen and press start. The screen counts down, then cycles
   Preparation → Action → Rest for the configured repetitions.
3. The web app tells the bridge the current phase; the bridge labels every sample and
   uploads it. The bridge must be running before the session starts, or no EMG is stored.
4. At the end, open the session in **Riwayat Sesi** to check the sample count and
   export CSV or JSON.

## 7. Verify the recording

Do this on a short test session before recording participants.

**Bridge health** — http://127.0.0.1:8000/health

| Field | Expected |
| --- | --- |
| `sampleRateHz` | 990–1010 |
| `sessionDroppedSamples` | 0 |
| `crcErrors` | 0 or very low |
| `uploadBatchesFailed` | 0 |

**Database check** (replace the session id):

```sql
SELECT count(*) AS total,
       min("sampleIndex") AS idx_min, max("sampleIndex") AS idx_max,
       max("elapsedMs") / 1000.0 AS seconds,
       count(*) FILTER (WHERE "isTransition") AS transition,
       count(*) FILTER (WHERE phase = 'ACTION') AS action,
       count(*) FILTER (WHERE phase = 'REST') AS rest
FROM "EmgRecord" WHERE "sessionId" = '<session id>';
```

Pass if `idx_max = total - 1` (no gaps), `total ≈ seconds × 1000`, and both
`action` and `rest` are above zero.

**Signal check** — before collecting a dataset, confirm the raw signal actually changes
between Action and Rest for one person. If raw values swing across the whole range
even at rest, fix electrode contact, the reference electrode and mains interference first.

---

## Data format

Each row of `EmgRecord` is one sample:

| Column | Meaning |
| --- | --- |
| `sessionId` | Links to `Session` (participant, gesture, morning/afternoon block) |
| `sampleIndex` | Sample number in the session, 1 ms apart; a jump means samples were lost |
| `elapsedMs` | `sampleIndex` in milliseconds |
| `phase` | `PREPARATION`, `ACTION` or `REST` |
| `isTransition` | `true` for the first 50 ms after a phase change; label may lag the screen |
| `r1`–`r6` | Raw 12-bit ADC counts (0–4095 = 0–3.6 V), channels A0–A5 |
| `p1`–`p6` | On-device envelope: high-pass 20 Hz, notch 50 Hz, low-pass 150 Hz, squared |
| `gesture` | Gesture name |

The USB frame format is documented in `firmware/emg_1khz/emg_dsp.h`. The firmware and
`FrameParser` in `emg_bridge.py` must always be changed together.

**Older recordings are not compatible.** Sessions recorded before the 1000 Hz firmware
(July–November 2026) were sampled at about 150 Hz with a 10-bit ADC, and their columns
are interleaved (`r1` = raw ch1, `r2` = envelope ch1, `r3` = raw ch2, …). Keep them
separate from new recordings.

**For machine learning**, filter `r1`–`r6` yourself rather than relying on `p1`–`p6`,
drop or down-weight `isTransition` rows, and split train/test data by participant or
by recording block, never by windows of the same recording.

---

## Troubleshooting

| Problem | Fix |
| --- | --- |
| Bridge prints "Port serial ... terputus" | Wrong `SERIAL_PORT`, cable is charge-only, or another program (Serial Monitor, a second bridge) has the port open |
| `/health` shows `sampleRateHz` far below 1000 | Firmware is the old version or `OUTPUT_BINARY` is 0; re-flash `emg_1khz.ino` |
| `crcErrors` keeps rising | Loose USB cable or hub; plug the XIAO straight into the PC |
| Session has no EMG rows | Bridge was not running when the session started, or Next.js is not on port 3000 |
| `Module not found: app/generated/prisma` | Run `npx prisma generate` |
| Database connection error | PostgreSQL service is stopped or `DATABASE_URL` in `.env` is wrong |
| Port 3000 in use | `npm run dev -- -p 3001`, then update `NEXTJS_BASE_URL` in `emg_bridge.py` and the CORS origin |

---

## Data privacy

Recordings, database dumps and exports contain personal data of research participants.
Do not commit them to this repository, and do not commit `.env`. Screenshots in `docs/`
should not show real participant names.

## Credits

Developed for postgraduate research at Universiti Teknikal Malaysia Melaka (UTeM), with
contributions from the project's student developers. AI assistance (Claude, Anthropic)
was used for parts of the code and documentation, as noted above.
