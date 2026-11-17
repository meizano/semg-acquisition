/*
  emg_1khz.ino -- 6-channel sEMG acquisition at a fixed 1000 Hz

  Board  : Seeed XIAO nRF52840 / XIAO nRF52840 Sense
           Core "Seeed nRF52 Boards" (Seeeduino:nrf52)        -- recommended
           Core "Seeed nRF52 mbed-enabled Boards" (Seeeduino:mbed) -- also works
  Sensor : 6 x "Hello sEMG" (Cheez) analog outputs on A0..A5, powered from 3V3.
           Keep every input <= 3.3 V and share ground with the XIAO.

  How the timing works
  --------------------
  The old sketch sampled with analogRead() inside loop() and paced itself with
  delayMicroseconds(1000). Every Serial.print and BLE poll added to that period,
  so the real rate was about 150 Hz and irregular.

  Here the CPU is not in the sampling path at all:

      TIMER4 (1 MHz, compare every 1000 us)
         --PPI-->  SAADC SAMPLE: one scan of all 6 inputs (~72 us)
                   results go by EasyDMA into a ring of RAM blocks
      SAADC END (block of 10 scans full)
         --PPI-->  SAADC START on the next block

  loop() only drains finished blocks: it computes the envelope and sends one
  binary frame per block (10 ms) over USB. If USB stalls, sampling continues;
  up to 320 ms of backlog is absorbed by the ring. Anything older is dropped,
  and the drop shows up as a jump in the frame sequence number.

  Output
  ------
  OUTPUT_BINARY 1 : binary frames for emg_bridge.py (format in emg_dsp.h)
  OUTPUT_BINARY 0 : CSV text "seq,r1..r6,p1..p6" for Serial Monitor checks
  r = raw 12-bit ADC counts (0..4095 = 0..3.6 V), p = envelope (squared filtered signal).

  Firmware stays one-way: it never reads from Serial and knows nothing about
  sessions or phases. The sequence number only counts samples since power-on.
*/

#include <Arduino.h>
#include <nrf.h>
#include "emg_dsp.h"

#if !defined(ARDUINO_ARCH_MBED)
#include <Adafruit_TinyUSB.h>   // provides USB Serial on the non-mbed core
#include <nrf_sdm.h>
#endif

// ============================ User config ============================

#ifndef OUTPUT_BINARY
#define OUTPUT_BINARY 1     // set to 0 to read the stream in Serial Monitor (emg_bridge.py needs 1)
#endif

static const uint32_t SAMPLE_RATE_HZ = 1000;   // must divide 1,000,000
static const float    HIGHPASS_HZ    = 20.0f;
static const float    NOTCH_HZ       = 50.0f;  // mains frequency (60.0f where applicable)
static const float    NOTCH_Q        = 5.0f;   // -3 dB width = NOTCH_HZ / NOTCH_Q
static const float    LOWPASS_HZ     = 150.0f;

// SAADC input for each channel, in A0..A5 order. XIAO nRF52840 pin map:
// A0=P0.02=AIN0, A1=P0.03=AIN1, A2=P0.28=AIN4, A3=P0.29=AIN5, A4=P0.04=AIN2, A5=P0.05=AIN3
static const uint8_t AIN_INDEX[emg::NUM_CH] = { 0, 1, 4, 5, 2, 3 };

// ======================= Acquisition internals =======================

static const uint32_t NUM_BLOCKS     = 32;  // ring depth: 32 x 10 ms = 320 ms
static const uint32_t BLOCK_SAMPLES  = (uint32_t)emg::SCANS_PER_FRAME * emg::NUM_CH;
static const uint8_t  PPI_CH_SAMPLE  = 10;
static const uint8_t  PPI_CH_RESTART = 11;

static int16_t g_ring[NUM_BLOCKS][BLOCK_SAMPLES] __attribute__((aligned(4)));

// Number of SAADC STARTED events so far. After the n-th STARTED, blocks
// 0 .. n-2 are complete, block n-1 is being written, and the DMA pointer for
// block n is already latched in hardware.
static volatile uint32_t g_started = 0;

static uint32_t g_consumed = 0;      // blocks handed to output so far
static uint32_t g_dropped  = 0;      // blocks lost to ring overrun
static emg::ChannelFilter g_filter[emg::NUM_CH];

static void saadcIsr(void) {
  if (NRF_SAADC->EVENTS_STARTED) {
    NRF_SAADC->EVENTS_STARTED = 0;
    (void)NRF_SAADC->EVENTS_STARTED;  // make sure the clear lands before returning
    uint32_t n = g_started + 1;
    g_started = n;
    NRF_SAADC->RESULT.PTR = (uint32_t)g_ring[n % NUM_BLOCKS];
  }
}

#if !defined(ARDUINO_ARCH_MBED)
// The non-mbed core keeps its vector table in flash, so the handler is bound by name.
extern "C" void SAADC_IRQHandler(void) { saadcIsr(); }
#endif

static void startCrystalClock(void) {
  // The 1 kHz timebase is only as accurate as HFCLK: the crystal is ~20 ppm,
  // the internal RC oscillator up to a few percent.
#if !defined(ARDUINO_ARCH_MBED)
  uint8_t sdEnabled = 0;
  sd_softdevice_is_enabled(&sdEnabled);
  if (sdEnabled) {
    sd_clock_hfclk_request();
    uint32_t running = 0;
    while (!running) sd_clock_hfclk_is_running(&running);
    return;
  }
#endif
  NRF_CLOCK->EVENTS_HFCLKSTARTED = 0;
  NRF_CLOCK->TASKS_HFCLKSTART = 1;
  while (!NRF_CLOCK->EVENTS_HFCLKSTARTED) { }
}

static void setupSaadc(void) {
  NRF_SAADC->ENABLE = 0;

  for (uint8_t i = 0; i < 8; i++) {
    NRF_SAADC->CH[i].PSELP = SAADC_CH_PSELP_PSELP_NC;
    NRF_SAADC->CH[i].PSELN = SAADC_CH_PSELN_PSELN_NC;
  }
  for (uint8_t c = 0; c < emg::NUM_CH; c++) {
    NRF_SAADC->CH[c].CONFIG =
        (SAADC_CH_CONFIG_RESP_Bypass     << SAADC_CH_CONFIG_RESP_Pos)   |
        (SAADC_CH_CONFIG_RESN_Bypass     << SAADC_CH_CONFIG_RESN_Pos)   |
        (SAADC_CH_CONFIG_GAIN_Gain1_6    << SAADC_CH_CONFIG_GAIN_Pos)   |  // 0.6 V / (1/6) = 3.6 V full scale
        (SAADC_CH_CONFIG_REFSEL_Internal << SAADC_CH_CONFIG_REFSEL_Pos) |
        (SAADC_CH_CONFIG_TACQ_10us       << SAADC_CH_CONFIG_TACQ_Pos)   |
        (SAADC_CH_CONFIG_MODE_SE         << SAADC_CH_CONFIG_MODE_Pos)   |
        (SAADC_CH_CONFIG_BURST_Disabled  << SAADC_CH_CONFIG_BURST_Pos);
    // PSELP value 1 = AnalogInput0, 2 = AnalogInput1, ...
    NRF_SAADC->CH[c].PSELP = (uint32_t)AIN_INDEX[c] + SAADC_CH_PSELP_PSELP_AnalogInput0;
  }

  NRF_SAADC->RESOLUTION = SAADC_RESOLUTION_VAL_12bit;
  NRF_SAADC->OVERSAMPLE = SAADC_OVERSAMPLE_OVERSAMPLE_Bypass;
  NRF_SAADC->SAMPLERATE = SAADC_SAMPLERATE_MODE_Task << SAADC_SAMPLERATE_MODE_Pos;
  NRF_SAADC->INTENCLR   = 0xFFFFFFFF;
  NRF_SAADC->ENABLE     = SAADC_ENABLE_ENABLE_Enabled;

  // Offset calibration, then STOP to clear the SAADC state before the first START.
  NRF_SAADC->EVENTS_CALIBRATEDONE = 0;
  NRF_SAADC->TASKS_CALIBRATEOFFSET = 1;
  while (!NRF_SAADC->EVENTS_CALIBRATEDONE) { }
  NRF_SAADC->EVENTS_CALIBRATEDONE = 0;
  while (NRF_SAADC->STATUS == (SAADC_STATUS_STATUS_Busy << SAADC_STATUS_STATUS_Pos)) { }
  NRF_SAADC->EVENTS_STOPPED = 0;
  NRF_SAADC->TASKS_STOP = 1;
  while (!NRF_SAADC->EVENTS_STOPPED) { }
  NRF_SAADC->EVENTS_STOPPED = 0;

  NRF_SAADC->RESULT.PTR    = (uint32_t)g_ring[0];
  NRF_SAADC->RESULT.MAXCNT = BLOCK_SAMPLES;
  NRF_SAADC->EVENTS_STARTED = 0;
  NRF_SAADC->EVENTS_END     = 0;

#if defined(ARDUINO_ARCH_MBED)
  // mbed keeps the vector table in RAM; install the handler there.
  NVIC_SetVector(SAADC_IRQn, (uint32_t)&saadcIsr);
#endif
  NVIC_SetPriority(SAADC_IRQn, 3);
  NVIC_ClearPendingIRQ(SAADC_IRQn);
  NVIC_EnableIRQ(SAADC_IRQn);
  NRF_SAADC->INTENSET = SAADC_INTENSET_STARTED_Msk;
}

static void setupTimerAndPpi(void) {
  NRF_TIMER4->TASKS_STOP  = 1;
  NRF_TIMER4->TASKS_CLEAR = 1;
  NRF_TIMER4->MODE      = TIMER_MODE_MODE_Timer;
  NRF_TIMER4->BITMODE   = TIMER_BITMODE_BITMODE_32Bit;
  NRF_TIMER4->PRESCALER = 4;                                // 16 MHz / 2^4 = 1 MHz
  NRF_TIMER4->CC[0]     = 1000000UL / SAMPLE_RATE_HZ;       // 1000 ticks = 1 ms
  NRF_TIMER4->SHORTS    = TIMER_SHORTS_COMPARE0_CLEAR_Msk;
  NRF_TIMER4->INTENCLR  = 0xFFFFFFFF;

  NRF_PPI->CH[PPI_CH_SAMPLE].EEP  = (uint32_t)&NRF_TIMER4->EVENTS_COMPARE[0];
  NRF_PPI->CH[PPI_CH_SAMPLE].TEP  = (uint32_t)&NRF_SAADC->TASKS_SAMPLE;
  NRF_PPI->CH[PPI_CH_RESTART].EEP = (uint32_t)&NRF_SAADC->EVENTS_END;
  NRF_PPI->CH[PPI_CH_RESTART].TEP = (uint32_t)&NRF_SAADC->TASKS_START;
  NRF_PPI->CHENSET = (1UL << PPI_CH_SAMPLE) | (1UL << PPI_CH_RESTART);
}

static void startAcquisition(void) {
  NRF_SAADC->TASKS_START = 1;            // latches g_ring[0]; ISR then points DMA at g_ring[1]
  while (g_started == 0) { }
  NRF_TIMER4->TASKS_START = 1;           // first scan 1 ms from now
}

// ============================== Output ===============================

static void sendBlock(uint32_t blockIndex) {
  static uint16_t raw[emg::SCANS_PER_FRAME][emg::NUM_CH];
  static uint32_t env[emg::SCANS_PER_FRAME][emg::NUM_CH];

  const int16_t* src = g_ring[blockIndex % NUM_BLOCKS];
  for (uint8_t s = 0; s < emg::SCANS_PER_FRAME; s++) {
    for (uint8_t c = 0; c < emg::NUM_CH; c++) {
      int16_t v = src[s * emg::NUM_CH + c];      // single-ended can read slightly below 0
      uint16_t r = v < 0 ? 0 : (uint16_t)v;
      raw[s][c] = r;
      env[s][c] = g_filter[c].envelope(r);       // filters run even with no host attached
    }
  }

  if (!Serial) return;                           // no host has the port open

  const uint32_t seq = blockIndex * emg::SCANS_PER_FRAME;

#if OUTPUT_BINARY
  static uint8_t frame[emg::FRAME_BYTES];
  size_t n = emg::packFrame(frame, seq, raw, env);
  Serial.write(frame, n);
#else
  static char text[emg::SCANS_PER_FRAME * 112];
  size_t len = 0;
  for (uint8_t s = 0; s < emg::SCANS_PER_FRAME; s++) {
    len += snprintf(text + len, sizeof(text) - len,
                    "%lu,%u,%u,%u,%u,%u,%u,%lu,%lu,%lu,%lu,%lu,%lu\n",
                    (unsigned long)(seq + s),
                    raw[s][0], raw[s][1], raw[s][2], raw[s][3], raw[s][4], raw[s][5],
                    (unsigned long)env[s][0], (unsigned long)env[s][1], (unsigned long)env[s][2],
                    (unsigned long)env[s][3], (unsigned long)env[s][4], (unsigned long)env[s][5]);
  }
  Serial.write((const uint8_t*)text, len);
#endif
}

// ============================== Arduino ==============================

void setup() {
  Serial.begin(115200);   // USB CDC: the baud value is ignored, the link runs at USB speed

  for (uint8_t c = 0; c < emg::NUM_CH; c++)
    g_filter[c].init((float)SAMPLE_RATE_HZ, HIGHPASS_HZ, NOTCH_HZ, NOTCH_Q, LOWPASS_HZ);

  startCrystalClock();
  setupSaadc();
  setupTimerAndPpi();
  startAcquisition();     // sampling runs from here on, host connected or not
}

void loop() {
  const uint32_t started = g_started;
  if (started < 2) return;
  const uint32_t ready = started - 1;            // blocks [0, ready) are complete

  // Block (started - NUM_BLOCKS) shares its slot with the block that starts
  // next; keep one more block of margin and skip anything older.
  if (started + 2 > NUM_BLOCKS) {
    const uint32_t oldestSafe = started + 2 - NUM_BLOCKS;
    if (g_consumed < oldestSafe) {
      g_dropped += oldestSafe - g_consumed;
      g_consumed = oldestSafe;
    }
  }

  while (g_consumed < ready) {
    sendBlock(g_consumed);
    g_consumed++;
  }
}
