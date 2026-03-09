/**
 * EEGVideo configuration constants.
 * Import these instead of hardcoding values.
 */

export const EEG_SAMPLE_RATE = 256;
export const EEG_CHANNELS = ['TP9', 'AF7', 'AF8', 'TP10'];
export const NUM_CHANNELS = EEG_CHANNELS.length;

export const FRAME_MARKER_INTERVAL = 10;
export const AUDIO_MARKER_INTERVAL = 512;
export const DATA_FLUSH_INTERVAL_MS = 2000;

export const QUALITY_GOOD_MIN = 1.5;
export const QUALITY_GOOD_MAX = 10;

export const MUSE_SERVICE_UUID = '0000fe8d-0000-1000-8000-00805f9b34fb';
