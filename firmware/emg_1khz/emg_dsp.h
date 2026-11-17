// emg_dsp.h -- filters and frame packing for emg_1khz.ino
//
// Plain C++ with no Arduino dependencies, so the same code can be compiled
// on a PC to test the frame format against emg_bridge.py.

#pragma once
#include <stdint.h>
#include <stddef.h>
#include <math.h>

namespace emg {

static const uint8_t  NUM_CH          = 6;
static const uint8_t  SCANS_PER_FRAME = 10;     // 10 samples per channel = 10 ms at 1 kHz
static const uint8_t  FRAME_VERSION   = 1;
static const uint8_t  SYNC0           = 0xA5;
static const uint8_t  SYNC1           = 0x5A;

// Frame layout, little-endian:
//   [0]  0xA5  [1] 0x5A          sync
//   [2]  version (1)
//   [3]  scans in this frame (10)
//   [4..7]   uint32 sequence number of the first scan (scans since boot)
//   then     uint16 raw[scans][6]    12-bit ADC counts, A0..A5
//   then     uint32 env[scans][6]    squared band-passed signal, A0..A5
//   [last 2] uint16 CRC-16/CCITT-FALSE over bytes [2 .. end of env]
static const size_t FRAME_HEADER = 8;
static const size_t FRAME_BYTES  = FRAME_HEADER
                                 + (size_t)SCANS_PER_FRAME * NUM_CH * 2
                                 + (size_t)SCANS_PER_FRAME * NUM_CH * 4
                                 + 2;  // = 370

// ---------------------------------------------------------------- filters

// Second-order IIR section, transposed direct form II.
struct Biquad {
  float b0 = 1, b1 = 0, b2 = 0, a1 = 0, a2 = 0;
  float z1 = 0, z2 = 0;

  inline float step(float x) {
    float y = b0 * x + z1;
    z1 = b1 * x - a1 * y + z2;
    z2 = b2 * x - a2 * y;
    return y;
  }

  // Coefficients from the RBJ audio-EQ cookbook.
  void set(float nb0, float nb1, float nb2, float a0, float na1, float na2) {
    b0 = nb0 / a0; b1 = nb1 / a0; b2 = nb2 / a0;
    a1 = na1 / a0; a2 = na2 / a0;
    z1 = z2 = 0;
  }
  void lowpass(float fs, float f0, float q) {
    float w = 2.0f * (float)M_PI * f0 / fs, c = cosf(w), al = sinf(w) / (2.0f * q);
    set((1 - c) / 2, 1 - c, (1 - c) / 2, 1 + al, -2 * c, 1 - al);
  }
  void highpass(float fs, float f0, float q) {
    float w = 2.0f * (float)M_PI * f0 / fs, c = cosf(w), al = sinf(w) / (2.0f * q);
    set((1 + c) / 2, -(1 + c), (1 + c) / 2, 1 + al, -2 * c, 1 - al);
  }
  void notch(float fs, float f0, float q) {
    float w = 2.0f * (float)M_PI * f0 / fs, c = cosf(w), al = sinf(w) / (2.0f * q);
    set(1, -2 * c, 1, 1 + al, -2 * c, 1 - al);
  }
};

// Per-channel envelope: high-pass 20 Hz -> mains notch -> low-pass 150 Hz -> square.
// Same structure as the OYMotion EMGFilters envelope used by the old firmware,
// but designed for the real sample rate.
struct ChannelFilter {
  Biquad hp, nt, lp;
  bool primed = false;

  void init(float fs, float hpHz, float notchHz, float notchQ, float lpHz) {
    const float BUTTERWORTH_Q = 0.70710678f;
    hp.highpass(fs, hpHz, BUTTERWORTH_Q);
    nt.notch(fs, notchHz, notchQ);
    lp.lowpass(fs, lpHz, BUTTERWORTH_Q);
    primed = false;
  }

  inline uint32_t envelope(uint16_t raw) {
    float x = (float)raw;
    if (!primed) {
      // Start the high-pass in steady state for this DC level, so the
      // sensor's ~1.65 V offset does not produce a large start-up transient.
      hp.z1 = -hp.b0 * x;
      hp.z2 = hp.b2 * x;
      primed = true;
    }
    float y = lp.step(nt.step(hp.step(x)));
    float e = y * y + 0.5f;
    return e >= 4294967295.0f ? 0xFFFFFFFFu : (uint32_t)e;
  }
};

// ------------------------------------------------------------ frame packing

static inline uint16_t crc16_ccitt(const uint8_t* p, size_t n) {
  uint16_t crc = 0xFFFF;
  while (n--) {
    crc ^= (uint16_t)(*p++) << 8;
    for (uint8_t i = 0; i < 8; i++)
      crc = (crc & 0x8000) ? (uint16_t)((crc << 1) ^ 0x1021) : (uint16_t)(crc << 1);
  }
  return crc;
}

static inline uint8_t* put16(uint8_t* p, uint16_t v) { p[0] = (uint8_t)v; p[1] = (uint8_t)(v >> 8); return p + 2; }
static inline uint8_t* put32(uint8_t* p, uint32_t v) {
  p[0] = (uint8_t)v; p[1] = (uint8_t)(v >> 8); p[2] = (uint8_t)(v >> 16); p[3] = (uint8_t)(v >> 24);
  return p + 4;
}

// raw and env are [SCANS_PER_FRAME][NUM_CH], scan-major. out must hold FRAME_BYTES.
static inline size_t packFrame(uint8_t* out, uint32_t seq,
                               const uint16_t raw[][NUM_CH], const uint32_t env[][NUM_CH]) {
  uint8_t* p = out;
  *p++ = SYNC0; *p++ = SYNC1; *p++ = FRAME_VERSION; *p++ = SCANS_PER_FRAME;
  p = put32(p, seq);
  for (uint8_t s = 0; s < SCANS_PER_FRAME; s++)
    for (uint8_t c = 0; c < NUM_CH; c++) p = put16(p, raw[s][c]);
  for (uint8_t s = 0; s < SCANS_PER_FRAME; s++)
    for (uint8_t c = 0; c < NUM_CH; c++) p = put32(p, env[s][c]);
  uint16_t crc = crc16_ccitt(out + 2, (size_t)(p - out) - 2);
  p = put16(p, crc);
  return (size_t)(p - out);
}

}  // namespace emg
