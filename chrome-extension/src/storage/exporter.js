/**
 * Dataset Export Helper for Muse S Athena Sync Logger.
 *
 * Exports synchronized datasets for external Python / R analysis:
 * 1. Complete Session TAR Bundle (.tar):
 *    - physiology_timeseries.csv (4 Hz continuous physiological state)
 *    - computer_use_events.csv (all clicks/keys/scrolls/navigations + instantaneous physio)
 *    - session_bundle.jsonl (unified newline-delimited JSON stream)
 *    - raw_eeg_optics.csv (when raw 256 Hz EEG / 64 Hz Optics logging is enabled)
 *    - screenshots/shot_XXXXX.jpg (all captured event & periodic JPEG screenshots)
 *    - analyze_session.py (ready-to-run pandas/numpy correlation script)
 * 2. Standalone CSV / JSONL downloads
 */
import {
  getAllFromStore,
  formatPhysioTicksCsv,
  formatComputerEventsCsv,
  formatRawSamplesCsv,
  buildTarArchive,
  dataUrlToUint8Array,
  generatePythonAnalysisScript,
} from './sessionDb.js';

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  if (typeof chrome !== 'undefined' && chrome.downloads?.download) {
    chrome.downloads.download(
      {
        url,
        filename,
        saveAs: false,
      },
      () => {
        setTimeout(() => URL.revokeObjectURL(url), 15000);
      }
    );
  } else {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 15000);
  }
}

export async function exportPhysioCsvFile() {
  const ticks = await getAllFromStore('physio_ticks');
  const csv = formatPhysioTicksCsv(ticks);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  triggerDownload(blob, `muse_athena_physiology_${Date.now()}.csv`);
  return { count: ticks.length };
}

export async function exportEventsCsvFile() {
  const events = await getAllFromStore('computer_events');
  const csv = formatComputerEventsCsv(events);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  triggerDownload(blob, `muse_athena_computer_events_${Date.now()}.csv`);
  return { count: events.length };
}

export async function exportJsonlFile() {
  const [ticks, events, screenshots] = await Promise.all([
    getAllFromStore('physio_ticks'),
    getAllFromStore('computer_events'),
    getAllFromStore('screenshots'),
  ]);

  const lines = [];
  for (const t of ticks) {
    lines.push(JSON.stringify({ record_type: 'physio_tick', ...t }));
  }
  for (const e of events) {
    lines.push(JSON.stringify({ record_type: 'computer_event', ...e }));
  }
  for (const s of screenshots) {
    const { dataUrl, ...meta } = s;
    lines.push(
      JSON.stringify({
        record_type: 'screenshot_meta',
        ...meta,
        file_path: `screenshots/${s.screenshotId}`,
      })
    );
  }

  const blob = new Blob([lines.join('\n') + '\n'], { type: 'application/x-ndjson' });
  triggerDownload(blob, `muse_athena_session_${Date.now()}.jsonl`);
  return { ticks: ticks.length, events: events.length, screenshots: screenshots.length };
}

export async function exportFullBundleTar() {
  const [ticks, events, screenshots, rawChunks] = await Promise.all([
    getAllFromStore('physio_ticks'),
    getAllFromStore('computer_events'),
    getAllFromStore('screenshots'),
    getAllFromStore('raw_samples'),
  ]);

  const physioCsv = formatPhysioTicksCsv(ticks);
  const eventsCsv = formatComputerEventsCsv(events);

  const jsonlLines = [];
  for (const t of ticks) {
    jsonlLines.push(JSON.stringify({ record_type: 'physio_tick', ...t }));
  }
  for (const e of events) {
    jsonlLines.push(JSON.stringify({ record_type: 'computer_event', ...e }));
  }
  for (const s of screenshots) {
    const { dataUrl, ...meta } = s;
    jsonlLines.push(
      JSON.stringify({
        record_type: 'screenshot_meta',
        ...meta,
        file_path: `screenshots/${s.screenshotId}`,
      })
    );
  }

  const tarEntries = [
    { name: 'physiology_timeseries.csv', bytes: physioCsv },
    { name: 'computer_use_events.csv', bytes: eventsCsv },
    { name: 'session_bundle.jsonl', bytes: jsonlLines.join('\n') + '\n' },
    { name: 'analyze_session.py', bytes: generatePythonAnalysisScript() },
  ];

  if (rawChunks.length > 0) {
    tarEntries.push({
      name: 'raw_eeg_optics.csv',
      bytes: formatRawSamplesCsv(rawChunks),
    });
  }

  for (const s of screenshots) {
    if (s.dataUrl && s.screenshotId) {
      try {
        const jpgBytes = dataUrlToUint8Array(s.dataUrl);
        tarEntries.push({
          name: `screenshots/${s.screenshotId}`,
          bytes: jpgBytes,
        });
      } catch {
        // Skip malformed screenshot
      }
    }
  }

  const tarBytes = buildTarArchive(tarEntries);
  const blob = new Blob([tarBytes], { type: 'application/x-tar' });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  triggerDownload(blob, `muse_athena_dataset_${stamp}.tar`);

  return {
    ticks: ticks.length,
    events: events.length,
    screenshots: screenshots.length,
    rawChunks: rawChunks.length,
  };
}
