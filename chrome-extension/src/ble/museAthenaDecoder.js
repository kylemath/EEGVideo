/**
 * Decoder for the Muse S Athena (MS-03) Bluetooth Low Energy protocol.
 *
 * The Muse S Athena multiplexes all sensors onto GATT characteristic
 * `273e0013-4c4d-454d-96be-f03bac821358` (with optional secondary `273e0014`).
 *
 * Packet layout:
 *   [0]      packet length (including 9-byte header)
 *   [1..2]   16-bit little-endian packet counter
 *   [3..8]   device clock and session metadata
 *   [9..]    subpackets: [tag][index][3 metadata bytes][payload]
 *
 * EEG (14-bit) and optics (20-bit) samples are bit-packed little-endian (LSB first),
 * interleaved in sample-major order across channels.
 */

export const ATHENA_EEG_SAMPLE_RATE = 256;
export const ATHENA_OPTICS_SAMPLE_RATE = 64;
export const ATHENA_MOTION_SAMPLE_RATE = 52;

/** Microvolts per LSB of a 14-bit EEG sample (1.45 mV full scale). */
export const ATHENA_EEG_SCALE = 1450 / 16383;
/** Raw 14-bit EEG midpoint corresponding to 0 µV. */
export const ATHENA_EEG_MIDPOINT = 8192;

/** Primary multiplexed sensor characteristic on Muse S Athena. */
export const ATHENA_DATA_CHAR = '273e0013-4c4d-454d-96be-f03bac821358';
/** Secondary Athena characteristic (optional, subscribed when present). */
export const ATHENA_DATA2_CHAR = '273e0014-4c4d-454d-96be-f03bac821358';

export const ATHENA_EEG_CHANNEL_NAMES = [
  'TP9',
  'AF7',
  'AF8',
  'TP10',
  'AUX1',
  'AUX2',
  'AUX3',
  'AUX4',
];

export const ATHENA_OPTICS_CHANNEL_NAMES = {
  4: ['LI_730', 'RI_730', 'LI_850', 'RI_850'],
  8: ['LO_730', 'RO_730', 'LO_850', 'RO_850', 'LI_730', 'RI_730', 'LI_850', 'RI_850'],
  16: [
    'LO_730', 'RO_730', 'LO_850', 'RO_850', 'LI_730', 'RI_730', 'LI_850', 'RI_850',
    'LO_RED', 'RO_RED', 'LO_AMB', 'RO_AMB', 'LI_RED', 'RI_RED', 'LI_AMB', 'RI_AMB',
  ],
};

export const ATHENA_PRESETS = {
  p21: '4 ch EEG, motion, battery',
  p1021: '4 ch EEG, motion, battery, DRL/REF',
  p1035: '4 ch EEG + 4 ch optics (730/850nm fNIRS + PPG, low power)',
  p1036: '4 ch EEG + 4 ch optics (730/850nm fNIRS + PPG, high power)',
  p1033: '4 ch EEG + 8 ch optics (outer+inner 730/850nm, low power)',
  p1034: '4 ch EEG + 8 ch optics (outer+inner 730/850nm, high power)',
  p1045: '8 ch EEG + 4 ch optics (low power)',
  p1043: '8 ch EEG + 8 ch optics (low power)',
  p1041: '8 ch EEG + 16 ch optics (low power)',
  p1042: '8 ch EEG + 16 ch optics (high power)',
};

export const ATHENA_DEFAULT_PRESET = 'p1035';

const PACKET_HEADER_SIZE = 9;
const SUBPACKET_HEADER_SIZE = 5;

export const ATHENA_TAGS = {
  0x11: { type: 'eeg', channels: 4, samples: 4, bytes: 28 },
  0x12: { type: 'eeg', channels: 8, samples: 2, bytes: 28 },
  0x34: { type: 'optics', channels: 4, samples: 3, bytes: 30 },
  0x35: { type: 'optics', channels: 8, samples: 2, bytes: 40 },
  0x36: { type: 'optics', channels: 16, samples: 1, bytes: 40 },
  0x47: { type: 'motion', channels: 6, samples: 3, bytes: 36 },
  0x53: { type: 'drlref', channels: 2, samples: 6, bytes: 24 },
  0x88: { type: 'battery', channels: 1, samples: 1, bytes: 20, variableLength: true },
  0x98: { type: 'battery', channels: 1, samples: 1, bytes: 20 },
};

const ACCELEROMETER_SCALE = 1 / 16384; // g per count
const GYROSCOPE_SCALE = -0.0074768; // deg/s per count

/**
 * Unpack unsigned integers from a little-endian bitstream, LSB first.
 * @param {Uint8Array} bytes
 * @param {number} offset
 * @param {number} count
 * @param {number} bits
 * @returns {number[]}
 */
export function unpackLE(bytes, offset, count, bits) {
  const values = new Array(count);
  const mask = (1 << bits) - 1;
  let acc = 0;
  let accBits = 0;
  let pos = offset;
  for (let i = 0; i < count; i++) {
    while (accBits < bits) {
      acc |= bytes[pos++] << accBits;
      accBits += 8;
    }
    values[i] = acc & mask;
    acc >>>= bits;
    accBits -= bits;
  }
  return values;
}

/**
 * Convert a raw 14-bit Athena EEG sample to microvolts.
 * @param {number} x - Raw 14-bit sample [0..16383]
 * @returns {number} Value in microvolts [-725..725]
 */
export function athenaEegToMicrovolts(x) {
  return (x - ATHENA_EEG_MIDPOINT) * ATHENA_EEG_SCALE;
}

/**
 * Deinterleave sample-major values into one array per channel.
 * @param {number[]} values
 * @param {number} channels
 * @param {number} samples
 * @returns {number[][]}
 */
export function deinterleave(values, channels, samples) {
  const out = [];
  for (let ch = 0; ch < channels; ch++) {
    const column = new Array(samples);
    for (let s = 0; s < samples; s++) {
      column[s] = values[s * channels + ch];
    }
    out.push(column);
  }
  return out;
}

function decodePayload(spec, bytes, p) {
  const n = spec.channels * spec.samples;
  switch (spec.type) {
    case 'eeg': {
      const raw = deinterleave(unpackLE(bytes, p, n, 14), spec.channels, spec.samples);
      return { raw, values: raw.map((ch) => ch.map(athenaEegToMicrovolts)) };
    }
    case 'optics': {
      const raw = deinterleave(unpackLE(bytes, p, n, 20), spec.channels, spec.samples);
      return { raw, values: raw };
    }
    case 'motion': {
      const dv = new DataView(bytes.buffer, bytes.byteOffset + p, spec.bytes);
      const values = [];
      for (let i = 0; i < n; i++) {
        const v = dv.getInt16(i * 2, true);
        values.push(i % 6 < 3 ? v * ACCELEROMETER_SCALE : v * GYROSCOPE_SCALE);
      }
      return { raw: null, values: deinterleave(values, spec.channels, spec.samples) };
    }
    case 'drlref': {
      const dv = new DataView(bytes.buffer, bytes.byteOffset + p, spec.bytes);
      const values = [];
      for (let i = 0; i < n; i++) {
        values.push(dv.getUint16(i * 2, true));
      }
      return { raw: null, values: deinterleave(values, spec.channels, spec.samples) };
    }
    case 'battery': {
      const percent = Math.min(100, Math.max(0, (bytes[p] | (bytes[p + 1] << 8)) / 256));
      return { raw: null, values: [[percent]] };
    }
  }
}

/**
 * Parse one BLE notification from the Athena data characteristic and invoke
 * `onSubpacket` for each decoded subpacket in order.
 *
 * @param {Uint8Array} bytes
 * @param {Function} onSubpacket
 * @returns {{packets: number, subpackets: number, skippedBytes: number}}
 */
export function parseAthenaNotification(bytes, onSubpacket) {
  let packets = 0;
  let subpackets = 0;
  let skippedBytes = 0;
  let offset = 0;

  while (offset < bytes.length) {
    const length = bytes[offset];
    if (length < PACKET_HEADER_SIZE + SUBPACKET_HEADER_SIZE || offset + length > bytes.length) {
      skippedBytes += bytes.length - offset;
      break;
    }
    const end = offset + length;
    const packetCounter = bytes[offset + 1] | (bytes[offset + 2] << 8);
    let i = offset + PACKET_HEADER_SIZE;

    while (i + SUBPACKET_HEADER_SIZE <= end) {
      const tag = bytes[i];
      const spec = ATHENA_TAGS[tag];
      if (!spec) break;

      const p = i + SUBPACKET_HEADER_SIZE;
      if (spec.variableLength) {
        if (p + 2 > end) break;
        const { raw, values } = decodePayload(spec, bytes, p);
        onSubpacket({ type: spec.type, tag, index: bytes[i + 1], packetCounter, raw, values });
        subpackets++;
        const fixedNext = p + spec.bytes;
        if (fixedNext <= end && (fixedNext === end || ATHENA_TAGS[bytes[fixedNext]])) {
          i = fixedNext;
        } else {
          i = end;
        }
        continue;
      }

      if (p + spec.bytes > end) break;
      const { raw, values } = decodePayload(spec, bytes, p);
      onSubpacket({ type: spec.type, tag, index: bytes[i + 1], packetCounter, raw, values });
      subpackets++;
      i = p + spec.bytes;
    }

    skippedBytes += end - i;
    packets++;
    offset = end;
  }

  return { packets, subpackets, skippedBytes };
}
