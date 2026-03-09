/**
 * Recording stream: buffers EEG, flushes to file incrementally.
 */
import { pipe } from 'rxjs';
import { filter, bufferTime, tap } from 'rxjs/operators';
import { zipSamples } from 'muse-js';
import { DATA_FLUSH_INTERVAL_MS } from '../config/constants.js';
import {
  createEegFileHeader,
  formatEegRow,
  extrapolateCorrectedTime,
} from '../utils/dataFormat.js';

const SAMPLE_INTERVAL = 1 / 256;

export function createRecordingStream(museClient, onFlush) {
  if (!museClient?.eegReadings) return null;
  return zipSamples(museClient.eegReadings);
}

export function recordingPipe(startTime, onFlush) {
  let prevCorrected = 0;
  let sampleIndex = 0;

  return pipe(
    bufferTime(DATA_FLUSH_INTERVAL_MS),
    filter((batch) => batch.length > 0),
    tap((samples) => {
      const rows = [];
      for (const s of samples) {
        const uncorrected = s.timestamp ?? startTime + sampleIndex * SAMPLE_INTERVAL;
        const hasGap = sampleIndex > 0 && prevCorrected != null && uncorrected - prevCorrected > SAMPLE_INTERVAL * 2;
        const corrected = extrapolateCorrectedTime(uncorrected, prevCorrected, SAMPLE_INTERVAL, hasGap);
        prevCorrected = corrected;
        sampleIndex++;
        const chValues = [s.data?.[0] ?? 0, s.data?.[1] ?? 0, s.data?.[2] ?? 0, s.data?.[3] ?? 0];
        rows.push(formatEegRow(uncorrected, corrected, chValues));
      }
      onFlush(rows.join(''));
    })
  );
}
