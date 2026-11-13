/**
 * IndexedDB Storage & Multi-Format Dataset Exporter for Muse S Athena Sync Logger.
 *
 * Shared across the extension's background service worker, BLE bridge tab, and popup
 * via the same `chrome-extension://` origin.
 */

const DB_NAME = 'MuseAthenaComputerUseDB';
const DB_VERSION = 1;

export function openSessionDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (ev) => {
      const db = ev.target.result;
      if (!db.objectStoreNames.contains('physio_ticks')) {
        const s1 = db.createObjectStore('physio_ticks', { keyPath: 'id', autoIncrement: true });
        s1.createIndex('timestamp', 'timestamp', { unique: false });
      }
      if (!db.objectStoreNames.contains('computer_events')) {
        const s2 = db.createObjectStore('computer_events', { keyPath: 'id', autoIncrement: true });
        s2.createIndex('timestamp', 'timestamp', { unique: false });
        s2.createIndex('eventType', 'eventType', { unique: false });
      }
      if (!db.objectStoreNames.contains('screenshots')) {
        const s3 = db.createObjectStore('screenshots', { keyPath: 'screenshotId' });
        s3.createIndex('timestamp', 'timestamp', { unique: false });
      }
      if (!db.objectStoreNames.contains('raw_samples')) {
        const s4 = db.createObjectStore('raw_samples', { keyPath: 'id', autoIncrement: true });
        s4.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function addPhysioTick(record) {
  const db = await openSessionDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('physio_ticks', 'readwrite');
    tx.objectStore('physio_ticks').add(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function addComputerEvent(record) {
  const db = await openSessionDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('computer_events', 'readwrite');
    tx.objectStore('computer_events').add(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function addScreenshot(record) {
  const db = await openSessionDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('screenshots', 'readwrite');
    tx.objectStore('screenshots').put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function addRawSampleChunk(record) {
  const db = await openSessionDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('raw_samples', 'readwrite');
    tx.objectStore('raw_samples').add(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getAllFromStore(storeName) {
  const db = await openSessionDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function getStoreCounts() {
  const db = await openSessionDb();
  const stores = ['physio_ticks', 'computer_events', 'screenshots', 'raw_samples'];
  const counts = {};
  await Promise.all(
    stores.map(
      (name) =>
        new Promise((resolve) => {
          const tx = db.transaction(name, 'readonly');
          const req = tx.objectStore(name).count();
          req.onsuccess = () => {
            counts[name] = req.result || 0;
            resolve();
          };
          req.onerror = () => {
            counts[name] = 0;
            resolve();
          };
        })
    )
  );
  return counts;
}

export async function clearAllSessionData() {
  const db = await openSessionDb();
  const stores = ['physio_ticks', 'computer_events', 'screenshots', 'raw_samples'];
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, 'readwrite');
    for (const s of stores) {
      tx.objectStore(s).clear();
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function csvEscape(val) {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Build CSV string for continuous physiological state time series (4 Hz ticks).
 */
export function formatPhysioTicksCsv(ticks) {
  const headers = [
    'timestamp_ms',
    'iso_time',
    'session_time_ms',
    'session_id',
    'heart_rate_bpm',
    'hrv_rmssd_ms',
    'hr_confidence',
    'hbo2_uM',
    'hhb_uM',
    'hbt_uM',
    'left_hbo2_uM',
    'right_hbo2_uM',
    'left_hhb_uM',
    'right_hhb_uM',
    'left_hbt_uM',
    'right_hbt_uM',
    'focus_index',
    'calm_index',
    'frontal_alpha_asymmetry',
    'delta_rel',
    'theta_rel',
    'alpha_rel',
    'beta_rel',
    'gamma_rel',
    'delta_abs_uV2',
    'theta_abs_uV2',
    'alpha_abs_uV2',
    'beta_abs_uV2',
    'gamma_abs_uV2',
    'alpha_z',
    'focus_z',
    'head_angular_vel_deg_s',
    'stillness_score_pct',
    'sd_tp9_uV',
    'sd_af7_uV',
    'sd_af8_uV',
    'sd_tp10_uV',
    'good_electrodes',
    'eeg_artifact',
    'state_tags',
    'active_domain',
    'active_url',
    'active_title',
    'recent_clicks_10s',
    'recent_keys_10s',
    'recent_scroll_px_10s',
    'latest_screenshot_id',
  ];

  const lines = [headers.join(',')];
  for (const t of ticks) {
    const p = t.physio || t;
    const sq = p.signalQuality || {};
    const row = [
      t.timestamp,
      new Date(t.timestamp).toISOString(),
      t.sessionTimeMs ?? 0,
      t.sessionId || '',
      p.heartRateBpm ?? 0,
      p.hrvRmssdMs ?? 0,
      p.hrConfidence ?? 0,
      p.hbO2 ?? 0,
      p.hhb ?? 0,
      p.hbt ?? 0,
      p.leftHbO2 ?? 0,
      p.rightHbO2 ?? 0,
      p.leftHHb ?? 0,
      p.rightHHb ?? 0,
      p.leftHbT ?? 0,
      p.rightHbT ?? 0,
      p.focusIndex ?? 0,
      p.calmIndex ?? 0,
      p.frontalAlphaAsymmetry ?? 0,
      p.deltaRel ?? 0,
      p.thetaRel ?? 0,
      p.alphaRel ?? 0,
      p.betaRel ?? 0,
      p.gammaRel ?? 0,
      p.deltaAbs ?? 0,
      p.thetaAbs ?? 0,
      p.alphaAbs ?? 0,
      p.betaAbs ?? 0,
      p.gammaAbs ?? 0,
      p.alphaZ ?? 0,
      p.focusZ ?? 0,
      p.headAngularVelocityDegS ?? 0,
      p.stillnessScore ?? 100,
      sq.TP9 ?? 0,
      sq.AF7 ?? 0,
      sq.AF8 ?? 0,
      sq.TP10 ?? 0,
      sq.goodCount ?? 0,
      sq.eegArtifact ? 1 : 0,
      (p.stateTags || []).join('|'),
      t.activeDomain || '',
      t.activeUrl || '',
      t.activeTitle || '',
      t.recentClicks10s ?? 0,
      t.recentKeys10s ?? 0,
      t.recentScrollPx10s ?? 0,
      t.latestScreenshotId || '',
    ];
    lines.push(row.map(csvEscape).join(','));
  }
  return lines.join('\n');
}

/**
 * Build CSV string for computer-use events pre-joined with instantaneous physiological state.
 */
export function formatComputerEventsCsv(events) {
  const headers = [
    'timestamp_ms',
    'iso_time',
    'session_time_ms',
    'session_id',
    'event_type',
    'domain',
    'url',
    'page_title',
    'x',
    'y',
    'norm_x',
    'norm_y',
    'dom_tag',
    'dom_selector',
    'dom_text',
    'key_count',
    'typing_wpm',
    'mean_iki_ms',
    'backspace_count',
    'typed_text',
    'scroll_delta_y',
    'scroll_depth_pct',
    'mouse_dist_px',
    'mouse_vel_px_s',
    'manual_tag_note',
    'screenshot_id',
    // Synchronized physiological snapshot at the exact event moment
    'heart_rate_bpm',
    'hrv_rmssd_ms',
    'hbo2_uM',
    'hhb_uM',
    'hbt_uM',
    'focus_index',
    'calm_index',
    'frontal_alpha_asymmetry',
    'delta_rel',
    'theta_rel',
    'alpha_rel',
    'beta_rel',
    'gamma_rel',
    'alpha_z',
    'focus_z',
    'stillness_score_pct',
    'eeg_artifact',
    'state_tags',
  ];

  const lines = [headers.join(',')];
  for (const e of events) {
    const p = e.physio || {};
    const sq = p.signalQuality || {};
    const row = [
      e.timestamp,
      new Date(e.timestamp).toISOString(),
      e.sessionTimeMs ?? 0,
      e.sessionId || '',
      e.eventType || '',
      e.domain || '',
      e.url || '',
      e.pageTitle || '',
      e.x ?? '',
      e.y ?? '',
      e.normX ?? '',
      e.normY ?? '',
      e.tagName || '',
      e.selector || '',
      e.elementText || '',
      e.keyCount ?? '',
      e.wpm ?? '',
      e.ikiMs ?? '',
      e.backspaceCount ?? '',
      e.keyText || '',
      e.scrollDeltaY ?? '',
      e.scrollDepthPct ?? '',
      e.mouseDistancePx ?? '',
      e.mouseVelocityPxS ?? '',
      e.note || '',
      e.screenshotId || '',
      p.heartRateBpm ?? 0,
      p.hrvRmssdMs ?? 0,
      p.hbO2 ?? 0,
      p.hhb ?? 0,
      p.hbt ?? 0,
      p.focusIndex ?? 0,
      p.calmIndex ?? 0,
      p.frontalAlphaAsymmetry ?? 0,
      p.deltaRel ?? 0,
      p.thetaRel ?? 0,
      p.alphaRel ?? 0,
      p.betaRel ?? 0,
      p.gammaRel ?? 0,
      p.alphaZ ?? 0,
      p.focusZ ?? 0,
      p.stillnessScore ?? 100,
      sq.eegArtifact ? 1 : 0,
      (p.stateTags || []).join('|'),
    ];
    lines.push(row.map(csvEscape).join(','));
  }
  return lines.join('\n');
}

/**
 * Format raw 256 Hz EEG & 64 Hz Optics samples to CSV.
 */
export function formatRawSamplesCsv(chunks) {
  const headers = [
    'timestamp_ms',
    'sensor_type',
    'ch1_tp9_or_li730',
    'ch2_af7_or_ri730',
    'ch3_af8_or_li850',
    'ch4_tp10_or_ri850',
  ];
  const lines = [headers.join(',')];
  for (const c of chunks) {
    if (c.sensorType === 'eeg' && c.samplesByChannel) {
      const n = c.samplesByChannel[0]?.length || 0;
      for (let i = 0; i < n; i++) {
        const t = Math.round(c.timestamp - ((n - 1 - i) * 1000) / 256);
        lines.push(
          [
            t,
            'eeg_uV',
            (c.samplesByChannel[0]?.[i] ?? 0).toFixed(3),
            (c.samplesByChannel[1]?.[i] ?? 0).toFixed(3),
            (c.samplesByChannel[2]?.[i] ?? 0).toFixed(3),
            (c.samplesByChannel[3]?.[i] ?? 0).toFixed(3),
          ].join(',')
        );
      }
    } else if (c.sensorType === 'optics' && c.channels) {
      const n = c.channels[0]?.length || 0;
      for (let i = 0; i < n; i++) {
        const t = Math.round(c.timestamp - ((n - 1 - i) * 1000) / 64);
        lines.push(
          [
            t,
            'optics_raw',
            Math.round(c.channels[0]?.[i] ?? 0),
            Math.round(c.channels[1]?.[i] ?? 0),
            Math.round(c.channels[2]?.[i] ?? 0),
            Math.round(c.channels[3]?.[i] ?? 0),
          ].join(',')
        );
      }
    }
  }
  return lines.join('\n');
}

/**
 * Build a POSIX USTAR .tar archive (Uint8Array) from an array of { name, bytes } entries.
 * Allows exporting all CSVs, JSONL, Python starter script, and JPEG screenshots in a single download.
 */
export function buildTarArchive(files) {
  const encoder = new TextEncoder();
  const blocks = [];

  for (const file of files) {
    const contentBytes =
      typeof file.bytes === 'string' ? encoder.encode(file.bytes) : file.bytes;
    const size = contentBytes.byteLength;

    const header = new Uint8Array(512);
    const nameBytes = encoder.encode(file.name.slice(0, 99));
    header.set(nameBytes, 0);

    // File mode (0644), uid (0), gid (0)
    header.set(encoder.encode('0000644\0'), 100);
    header.set(encoder.encode('0000000\0'), 108);
    header.set(encoder.encode('0000000\0'), 116);

    // File size in octal (11 digits + null)
    const sizeOctal = size.toString(8).padStart(11, '0') + '\0';
    header.set(encoder.encode(sizeOctal), 124);

    // Modification time in octal
    const mtimeOctal = Math.floor(Date.now() / 1000).toString(8).padStart(11, '0') + '\0';
    header.set(encoder.encode(mtimeOctal), 136);

    // Checksum placeholder (8 spaces)
    header.set(encoder.encode('        '), 148);
    // Typeflag '0' (regular file)
    header[156] = 48;
    // USTAR indicator
    header.set(encoder.encode('ustar\x0000'), 257);

    // Calculate checksum
    let chksum = 0;
    for (let i = 0; i < 512; i++) chksum += header[i];
    const chkOctal = chksum.toString(8).padStart(6, '0') + '\0 ';
    header.set(encoder.encode(chkOctal), 148);

    blocks.push(header);
    blocks.push(contentBytes);

    const remainder = size % 512;
    if (remainder !== 0) {
      blocks.push(new Uint8Array(512 - remainder));
    }
  }

  // Two 512-byte zero blocks mark end of tar archive
  blocks.push(new Uint8Array(1024));

  const totalLength = blocks.reduce((acc, b) => acc + b.byteLength, 0);
  const out = new Uint8Array(totalLength);
  let offset = 0;
  for (const b of blocks) {
    out.set(b, offset);
    offset += b.byteLength;
  }
  return out;
}

export function dataUrlToUint8Array(dataUrl) {
  const commaIdx = dataUrl.indexOf(',');
  const base64 = commaIdx !== -1 ? dataUrl.slice(commaIdx + 1) : dataUrl;
  const binStr = atob(base64);
  const bytes = new Uint8Array(binStr.length);
  for (let i = 0; i < binStr.length; i++) {
    bytes[i] = binStr.charCodeAt(i);
  }
  return bytes;
}

/**
 * Companion Python analysis starter script included in every exported dataset bundle.
 */
export function generatePythonAnalysisScript() {
  return `#!/usr/bin/env python3
"""
Muse S Athena — Brain & Computer-Use Correlation Analysis Starter Script
========================================================================
Loads the synchronized datasets exported by the Muse S Athena Chrome Extension:
  - physiology_timeseries.csv (4 Hz continuous EEG bands, Focus, Calm, FAA, fNIRS HbO2/HHb/HbT, HR, HRV)
  - computer_use_events.csv   (clicks, typing cadence/WPM, scrolls, navigations, screenshots + instantaneous physio)
  - session_bundle.jsonl      (unified event + physiology + screenshot metadata stream)

Usage:
  python3 analyze_session.py
"""

import pandas as pd
import numpy as np

def main():
    physio = pd.read_csv("physiology_timeseries.csv")
    events = pd.read_csv("computer_use_events.csv")

    print(f"Loaded {len(physio):,} physiological state ticks (4 Hz) and {len(events):,} computer-use events.")
    if len(physio) > 0:
        duration_min = (physio["timestamp_ms"].max() - physio["timestamp_ms"].min()) / 60000.0
        print(f"Session Duration: {duration_min:.2f} minutes\\n")

        print("=== Physiological Summary Across Session ===")
        cols = [
            "heart_rate_bpm", "hrv_rmssd_ms",
            "hbo2_uM", "hhb_uM", "hbt_uM",
            "focus_index", "calm_index", "frontal_alpha_asymmetry",
            "alpha_rel", "beta_rel", "theta_rel"
        ]
        available = [c for c in cols if c in physio.columns]
        print(physio[available].describe().round(3))

    if len(events) > 0 and "domain" in events.columns:
        print("\\n=== Mean Physiological State by Website Domain ===")
        by_domain = events.groupby("domain").agg(
            event_count=("event_type", "count"),
            mean_focus=("focus_index", "mean"),
            mean_alpha_rel=("alpha_rel", "mean"),
            mean_hr_bpm=("heart_rate_bpm", "mean"),
            mean_hbo2_uM=("hbo2_uM", "mean"),
            mean_hbt_uM=("hbt_uM", "mean"),
        ).round(3)
        print(by_domain.sort_values("event_count", ascending=False).head(15))

        print("\\n=== High-Focus vs. High-Alpha Moments & Associated Screenshots ===")
        tagged = events[events["state_tags"].notna() & (events["state_tags"] != "")]
        for _, row in tagged.head(10).iterrows():
            print(
                f"[{row['iso_time']}] {row['event_type']} on {row['domain']} | "
                f"Tags={row['state_tags']} | Focus={row['focus_index']:.2f} | "
                f"HbO2={row['hbo2_uM']:.2f} uM | HR={row['heart_rate_bpm']} BPM | "
                f"Shot={row['screenshot_id']}"
            )

if __name__ == "__main__":
    main()
`;
}
