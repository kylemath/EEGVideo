/**
 * RxJS pipeable operators for EEG stream processing.
 * Uses muse-js zipSamples for per-sample format, adds signal quality.
 */
import { pipe } from 'rxjs';
import { map, bufferCount } from 'rxjs/operators';
import { zipSamples } from 'muse-js';
import { EEG_SAMPLE_RATE, EEG_CHANNELS, QUALITY_GOOD_MIN, QUALITY_GOOD_MAX } from '../config/constants.js';

/**
 * Compute standard deviation of an array.
 * @param {number[]} arr
 * @returns {number}
 */
function stdDev(arr) {
  if (!arr || arr.length === 0) return 0;
  const valid = arr.filter((v) => !Number.isNaN(v));
  if (valid.length === 0) return 0;
  const mean = valid.reduce((a, b) => a + b, 0) / valid.length;
  const sqDiffs = valid.map((v) => Math.pow(v - mean, 2));
  return Math.sqrt(sqDiffs.reduce((a, b) => a + b, 0) / valid.length);
}

/**
 * Pipe muse-js eegReadings through zipSamples for per-sample format.
 * zipSamples emits { data: [ch0, ch1, ch2, ch3, AUX], timestamp } per sample.
 */
export function museToSamples() {
  return (source) => zipSamples(source);
}

/**
 * Add signal quality (std dev per channel) over a sliding window.
 * Emits every 256 samples (~1s) with quality for each channel.
 * Good range: 1.5–10 µV (from eeg-pipes / EEGEdu).
 */
export function addSignalQuality(windowSize = 256) {
  return pipe(
    bufferCount(windowSize),
    map((samples) => {
      if (!samples || samples.length === 0) return null;
      const numChannels = 4;
      const quality = {};
      for (let c = 0; c < numChannels; c++) {
        const channelData = samples.map((s) => s.data?.[c]).filter((v) => v != null && !Number.isNaN(v));
        const sd = stdDev(channelData);
        const chName = EEG_CHANNELS[c] ?? `ch${c}`;
        quality[chName] = {
          stdDev: sd,
          isGood: sd >= QUALITY_GOOD_MIN && sd <= QUALITY_GOOD_MAX,
        };
      }
      const last = samples[samples.length - 1];
      return {
        data: last?.data,
        timestamp: last?.timestamp,
        samplingRate: EEG_SAMPLE_RATE,
        signalQuality: quality,
      };
    })
  );
}

/**
 * Combined pipe: muse eegReadings → zipSamples → add signal quality (throttled).
 * Use for live display with quality updates.
 */
export function eegWithQuality() {
  return (source) =>
    zipSamples(source).pipe(
      bufferCount(64),
      map((batch) => {
        if (!batch || batch.length === 0) return null;
        const numChannels = 4;
        const quality = {};
        for (let c = 0; c < numChannels; c++) {
          const channelData = batch.map((s) => s.data?.[c]).filter((v) => v != null && !Number.isNaN(v));
          const sd = stdDev(channelData);
          const chName = EEG_CHANNELS[c] ?? `ch${c}`;
          quality[chName] = { stdDev: sd, isGood: sd >= QUALITY_GOOD_MIN && sd <= QUALITY_GOOD_MAX };
        }
        return {
          samples: batch,
          signalQuality: quality,
          timestamp: batch[batch.length - 1]?.timestamp,
        };
      })
    );
}

/**
 * Raw samples stream (no quality) for recording.
 */
export function eegSamplesOnly() {
  return (source) => zipSamples(source);
}
