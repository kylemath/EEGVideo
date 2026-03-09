/**
 * EEG data and marker file format utilities.
 */
import { EEG_CHANNELS } from '../config/constants.js';

/** Column names for combined output (no comment prefix). */
export const COMBINED_COLUMNS =
  'row_type,timestamp,uncorrected_time,corrected_time,' +
  EEG_CHANNELS.join(',') +
  ',marker_type,media_time,performance_time,description';

export function createEegFileHeader(startTime) {
  const lines = [
    '# EEG Data - Muse 2',
    `# Channels: ${EEG_CHANNELS.join(',')}`,
    '# SamplingRate: 256',
    `# StartTime: ${startTime}`,
    '# Format: uncorrected_time,corrected_time,' + EEG_CHANNELS.join(','),
  ];
  return lines.join('\n') + '\n';
}

export function createMarkerFileHeader() {
  const lines = [
    '# Markers',
    '# Format: type,media_time,performance_time,description',
  ];
  return lines.join('\n') + '\n';
}

/**
 * Combined file header: metadata comments + column name row (no #).
 */
export function createCombinedFileHeader(startTime) {
  const lines = [
    '# EEG + Markers - Muse 2',
    `# Channels: ${EEG_CHANNELS.join(',')}`,
    '# SamplingRate: 256',
    `# StartTime: ${startTime}`,
    COMBINED_COLUMNS,
  ];
  return lines.join('\n') + '\n';
}

export function formatEegRow(uncorrectedTime, correctedTime, channelValues) {
  return [uncorrectedTime.toFixed(4), correctedTime.toFixed(4), ...channelValues.map((v) => v.toFixed(2))].join(',') + '\n';
}

export function formatMarkerRow(type, mediaTime, performanceTime, description = '') {
  return `${type},${mediaTime.toFixed(4)},${performanceTime.toFixed(4)},${description}\n`;
}

/**
 * Format an EEG row for combined output. Empty marker columns.
 */
export function formatCombinedEegRow(timestamp, uncorrectedTime, correctedTime, channelValues) {
  const ch = channelValues.map((v) => v.toFixed(2)).join(',');
  return `eeg,${timestamp.toFixed(4)},${uncorrectedTime.toFixed(4)},${correctedTime.toFixed(4)},${ch},,,,\n`;
}

/**
 * Format a marker row for combined output. Empty EEG columns.
 */
export function formatCombinedMarkerRow(timestamp, type, mediaTime, performanceTime, description = '') {
  const empty = Array(2 + EEG_CHANNELS.length)
    .fill('')
    .join(',');
  return `marker,${timestamp.toFixed(4)},${empty},${type},${mediaTime.toFixed(4)},${performanceTime.toFixed(4)},${description}\n`;
}

/**
 * Extrapolate corrected time from packet timestamps and gap detection.
 * @param {number} uncorrectedTime - Raw timestamp from packet
 * @param {number} prevCorrected - Previous corrected time
 * @param {number} expectedDelta - Expected time between samples (1/256)
 * @param {boolean} hasGap - Whether a gap was detected
 */
export function extrapolateCorrectedTime(uncorrectedTime, prevCorrected, expectedDelta, hasGap) {
  if (prevCorrected == null) return uncorrectedTime;
  if (hasGap) {
    return prevCorrected + expectedDelta;
  }
  return uncorrectedTime;
}
