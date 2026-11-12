/**
 * Line-noise (mains) notch filter for EEG samples.
 *
 * A second-order IIR notch (RBJ biquad, Direct Form II transposed) applied
 * causally, sample by sample, so it works on the live stream. Each EEG channel
 * keeps its own filter state. Used for the live chart, the signal-quality
 * check during setup, and for the samples written to the recording file.
 */
import { defer } from 'rxjs';
import { map } from 'rxjs/operators';
import { EEG_SAMPLE_RATE, NUM_CHANNELS, NOTCH_FREQ_HZ, NOTCH_Q } from '../config/constants.js';

/**
 * Compute normalized biquad notch coefficients.
 * @param {number} f0 - Notch centre frequency (Hz)
 * @param {number} fs - Sampling rate (Hz)
 * @param {number} q - Quality factor (higher = narrower notch)
 */
export function notchCoefficients(f0 = NOTCH_FREQ_HZ, fs = EEG_SAMPLE_RATE, q = NOTCH_Q) {
  const w0 = (2 * Math.PI * f0) / fs;
  const cosW0 = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * q);
  const a0 = 1 + alpha;
  return {
    b0: 1 / a0,
    b1: (-2 * cosW0) / a0,
    b2: 1 / a0,
    a1: (-2 * cosW0) / a0,
    a2: (1 - alpha) / a0,
  };
}

/**
 * Create a stateful single-channel notch filter.
 * NaN inputs pass through as NaN without disturbing the filter state.
 * @returns {(x: number) => number}
 */
export function createNotchFilter(f0 = NOTCH_FREQ_HZ, fs = EEG_SAMPLE_RATE, q = NOTCH_Q) {
  const { b0, b1, b2, a1, a2 } = notchCoefficients(f0, fs, q);
  let z1 = 0;
  let z2 = 0;
  let primed = false;
  return (x) => {
    if (x == null || Number.isNaN(x)) return x;
    if (!primed) {
      // Start from steady state for a constant input equal to the first
      // sample, so a DC offset does not cause a start-up transient.
      z1 = x * (1 - b0);
      z2 = x * (b2 - a2);
      primed = true;
    }
    const y = b0 * x + z1;
    z1 = b1 * x - a1 * y + z2;
    z2 = b2 * x - a2 * y;
    return y;
  };
}

/**
 * RxJS operator: apply the notch filter to the EEG channels of zipSamples
 * output ({ data: [ch0..ch3, AUX?], timestamp }). Filter state is created per
 * subscription, so independent consumers (chart, quality, recording) don't
 * share or corrupt each other's state. Channels beyond NUM_CHANNELS (AUX) are
 * passed through unchanged.
 */
export function notchFilter({ freq = NOTCH_FREQ_HZ, sampleRate = EEG_SAMPLE_RATE, q = NOTCH_Q, numChannels = NUM_CHANNELS } = {}) {
  return (source) =>
    defer(() => {
      const filters = Array.from({ length: numChannels }, () => createNotchFilter(freq, sampleRate, q));
      return source.pipe(
        map((sample) => {
          if (!sample?.data) return sample;
          const data = sample.data.slice();
          for (let c = 0; c < numChannels && c < data.length; c++) {
            data[c] = filters[c](data[c]);
          }
          return { ...sample, data };
        })
      );
    });
}
