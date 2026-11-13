/**
 * Web Bluetooth client for Muse S Athena (MS-03) and Classic Muse headbands,
 * plus a realistic synthetic Muse S Athena stream generator for testing.
 */
import {
  ATHENA_DATA_CHAR,
  ATHENA_DATA2_CHAR,
  ATHENA_DEFAULT_PRESET,
  ATHENA_EEG_SAMPLE_RATE,
  ATHENA_OPTICS_SAMPLE_RATE,
  ATHENA_MOTION_SAMPLE_RATE,
  ATHENA_OPTICS_CHANNEL_NAMES,
  parseAthenaNotification,
} from './museAthenaDecoder.js';

const MUSE_SERVICE = 0xfe8d;
const CONTROL_CHAR = '273e0001-4c4d-454d-96be-f03bac821358';
const TELEMETRY_CHAR = '273e000b-4c4d-454d-96be-f03bac821358';
const GYROSCOPE_CHAR = '273e0009-4c4d-454d-96be-f03bac821358';
const ACCELEROMETER_CHAR = '273e000a-4c4d-454d-96be-f03bac821358';
const EEG_CHARS = [
  '273e0003-4c4d-454d-96be-f03bac821358', // TP9
  '273e0004-4c4d-454d-96be-f03bac821358', // AF7
  '273e0005-4c4d-454d-96be-f03bac821358', // AF8
  '273e0006-4c4d-454d-96be-f03bac821358', // TP10
  '273e0007-4c4d-454d-96be-f03bac821358', // AUX
];

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export function encodeCommand(cmd) {
  const encoded = new TextEncoder().encode('X' + cmd + '\n');
  encoded[0] = encoded.length - 1;
  return encoded;
}

async function writeCmd(controlChar, cmd) {
  const payload = encodeCommand(cmd);
  if (typeof controlChar.writeValueWithoutResponse === 'function') {
    await controlChar.writeValueWithoutResponse(payload);
  } else {
    await controlChar.writeValue(payload);
  }
}

function decodeClassicEEGSamples(samples) {
  const out = [];
  for (let i = 0; i < samples.length; i++) {
    if (i % 3 === 0) {
      out.push((samples[i] << 4) | (samples[i + 1] >> 4));
    } else {
      out.push(((samples[i] & 0xf) << 8) | samples[i + 1]);
      i++;
    }
  }
  return out.map((n) => 0.48828125 * (n - 0x800));
}

async function discoverCharacteristicUuids(service) {
  const found = new Set();
  try {
    const chars = await service.getCharacteristics();
    for (const c of chars) {
      found.add(c.uuid.toLowerCase());
    }
    return found;
  } catch {
    const probeUuids = [
      ATHENA_DATA_CHAR,
      ATHENA_DATA2_CHAR,
      ...EEG_CHARS,
      TELEMETRY_CHAR,
      ACCELEROMETER_CHAR,
      GYROSCOPE_CHAR,
    ];
    for (const uuid of probeUuids) {
      try {
        await service.getCharacteristic(uuid);
        found.add(uuid.toLowerCase());
      } catch {
        // Ignore unavailable characteristic
      }
    }
    return found;
  }
}

/**
 * Connect to a Muse S Athena (or Classic Muse) via Web Bluetooth.
 *
 * @param {object} callbacks
 * @param {Function} callbacks.onEeg - ({ timestamp, samplesByChannel: [[TP9...], [AF7...], [AF8...], [TP10...]] })
 * @param {Function} callbacks.onOptics - ({ timestamp, channelNames, channels: number[][] })
 * @param {Function} callbacks.onMotion - ({ timestamp, accel: [{x,y,z}], gyro: [{x,y,z}] })
 * @param {Function} callbacks.onTelemetry - ({ batteryLevel })
 * @param {Function} callbacks.onStatusChange - ({ connected, deviceName, isAthena, preset })
 * @param {object} [options] - { preset: 'p1035' }
 */
export async function connectMuseAthena(callbacks = {}, options = {}) {
  if (!navigator.bluetooth) {
    throw new Error('Web Bluetooth is not available in this context.');
  }

  const device = await navigator.bluetooth.requestDevice({
    filters: [{ services: [MUSE_SERVICE] }, { namePrefix: 'Muse' }],
    optionalServices: [MUSE_SERVICE],
  });

  const connectAndSetup = async () => {
    const gatt = await device.gatt.connect();
    const service = await gatt.getPrimaryService(MUSE_SERVICE);
    const controlChar = await service.getCharacteristic(CONTROL_CHAR);
    await controlChar.startNotifications();
    return { gatt, service, controlChar };
  };

  let { gatt, service, controlChar } = await connectAndSetup();
  let uuids = await discoverCharacteristicUuids(service);

  const isAthenaInitial = uuids.has(ATHENA_DATA_CHAR) && !uuids.has(EEG_CHARS[0]);
  const eegCharsReady = uuids.has(EEG_CHARS[0]);

  if (!isAthenaInitial && !eegCharsReady) {
    await writeCmd(controlChar, 'v1');
    await wait(100);
    await writeCmd(controlChar, 'h');
    await writeCmd(controlChar, 'p21');
    await writeCmd(controlChar, 's');
    await writeCmd(controlChar, 'd');
    await wait(500);
    uuids = await discoverCharacteristicUuids(service);
    if (!uuids.has(EEG_CHARS[0]) && !uuids.has(ATHENA_DATA_CHAR)) {
      if (gatt.connected) gatt.disconnect();
      await wait(500);
      ({ gatt, service, controlChar } = await connectAndSetup());
      uuids = await discoverCharacteristicUuids(service);
    }
  }

  const isAthena = uuids.has(ATHENA_DATA_CHAR) && !uuids.has(EEG_CHARS[0]);
  const preset = isAthena ? (options.preset || ATHENA_DEFAULT_PRESET) : 'p21';
  const deviceName = device.name || (isAthena ? 'Muse S Athena' : 'Muse');

  const listeners = [];
  const athenaSeqTracker = new Map();
  let athenaStartWallTime = null;
  let athenaReceivedEEG = false;

  function trackAthenaSubpacket(tag, seqIndex, samplesPerSubpacket, sampleRate) {
    if (athenaStartWallTime === null) {
      athenaStartWallTime = Date.now();
    }
    const key = `tag_${tag}`;
    const last = athenaSeqTracker.get(key);
    let unwrappedCount = 0;
    if (last) {
      const step = (seqIndex - last.seq + 256) % 256 || 1;
      unwrappedCount = last.count + step;
    }
    athenaSeqTracker.set(key, { seq: seqIndex, count: unwrappedCount });
    const sampleIndex = unwrappedCount * samplesPerSubpacket;
    const timestamp = athenaStartWallTime + (sampleIndex * 1000) / sampleRate;
    return { unwrappedCount, timestamp };
  }

  const onDisconnected = () => {
    callbacks.onStatusChange?.({
      connected: false,
      deviceName,
      isAthena,
      preset,
    });
  };
  device.addEventListener('gattserverdisconnected', onDisconnected);

  if (isAthena) {
    const handleAthenaNotification = (ev) => {
      const dv = ev.target.value;
      const bytes = new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength);
      parseAthenaNotification(bytes, (sub) => {
        if (sub.type === 'eeg') {
          athenaReceivedEEG = true;
          const nSamples = sub.values[0]?.length || 4;
          const { timestamp } = trackAthenaSubpacket(
            sub.tag,
            sub.index,
            nSamples,
            ATHENA_EEG_SAMPLE_RATE
          );
          callbacks.onEeg?.({
            timestamp,
            samplesByChannel: sub.values.slice(0, 4),
          });
        } else if (sub.type === 'optics') {
          const nSamples = sub.values[0]?.length || 3;
          const { timestamp } = trackAthenaSubpacket(
            sub.tag,
            sub.index,
            nSamples,
            ATHENA_OPTICS_SAMPLE_RATE
          );
          const numCh = sub.values.length;
          const channelNames = ATHENA_OPTICS_CHANNEL_NAMES[numCh] || ATHENA_OPTICS_CHANNEL_NAMES[4];
          callbacks.onOptics?.({
            timestamp,
            channelNames,
            channels: sub.values,
          });
        } else if (sub.type === 'motion') {
          const nSamples = sub.values[0]?.length || 3;
          const { timestamp } = trackAthenaSubpacket(
            sub.tag,
            sub.index,
            nSamples,
            ATHENA_MOTION_SAMPLE_RATE
          );
          const accel = [];
          const gyro = [];
          for (let i = 0; i < nSamples; i++) {
            accel.push({
              x: sub.values[0][i],
              y: sub.values[1][i],
              z: sub.values[2][i],
            });
            gyro.push({
              x: sub.values[3][i],
              y: sub.values[4][i],
              z: sub.values[5][i],
            });
          }
          callbacks.onMotion?.({ timestamp, accel, gyro });
        } else if (sub.type === 'battery') {
          callbacks.onTelemetry?.({
            batteryLevel: Math.round(sub.values[0][0]),
          });
        }
      });
    };

    const dataChar = await service.getCharacteristic(ATHENA_DATA_CHAR);
    await dataChar.startNotifications();
    dataChar.addEventListener('characteristicvaluechanged', handleAthenaNotification);
    listeners.push({ target: dataChar, type: 'characteristicvaluechanged', fn: handleAthenaNotification });

    if (uuids.has(ATHENA_DATA2_CHAR)) {
      try {
        const data2Char = await service.getCharacteristic(ATHENA_DATA2_CHAR);
        await data2Char.startNotifications();
        data2Char.addEventListener('characteristicvaluechanged', handleAthenaNotification);
        listeners.push({ target: data2Char, type: 'characteristicvaluechanged', fn: handleAthenaNotification });
      } catch {
        // Optional secondary characteristic
      }
    }

    const initSequence = [
      ['v6', 200],
      ['s', 200],
      ['h', 200],
      [preset, 200],
      ['s', 200],
      ['dc001', 50],
      ['dc001', 100],
      ['L1', 300],
      ['s', 200],
    ];
    for (const [cmd, delayMs] of initSequence) {
      await writeCmd(controlChar, cmd);
      await wait(delayMs);
    }

    for (let waited = 0; waited < 1500 && !athenaReceivedEEG; waited += 100) {
      await wait(100);
    }
    if (!athenaReceivedEEG) {
      await writeCmd(controlChar, 'd');
      for (let waited = 0; waited < 1500 && !athenaReceivedEEG; waited += 100) {
        await wait(100);
      }
    }
  } else {
    // Classic Muse fallback (4ch EEG)
    await writeCmd(controlChar, 'h');
    await writeCmd(controlChar, 'p21');
    await writeCmd(controlChar, 's');
    await writeCmd(controlChar, 'd');

    const channelBuffers = [[], [], [], []];
    for (let ch = 0; ch < 4; ch++) {
      const char = await service.getCharacteristic(EEG_CHARS[ch]);
      await char.startNotifications();
      const fn = (ev) => {
        const dv = ev.target.value;
        const samples = decodeClassicEEGSamples(
          new Uint8Array(dv.buffer, dv.byteOffset + 2, dv.byteLength - 2)
        );
        channelBuffers[ch].push(...samples);
        const minLen = Math.min(...channelBuffers.map((b) => b.length));
        if (minLen >= 12) {
          const slice = channelBuffers.map((b) => b.splice(0, 12));
          callbacks.onEeg?.({
            timestamp: Date.now(),
            samplesByChannel: slice,
          });
        }
      };
      char.addEventListener('characteristicvaluechanged', fn);
      listeners.push({ target: char, type: 'characteristicvaluechanged', fn });
    }
  }

  callbacks.onStatusChange?.({
    connected: true,
    deviceName,
    isAthena,
    preset,
  });

  return {
    deviceName,
    isAthena,
    preset,
    async disconnect() {
      try {
        if (isAthena && controlChar && gatt?.connected) {
          await writeCmd(controlChar, 'h');
        }
      } catch {
        // Ignore error on disconnect
      }
      for (const { target, type, fn } of listeners) {
        target.removeEventListener(type, fn);
      }
      device.removeEventListener('gattserverdisconnected', onDisconnected);
      if (gatt?.connected) {
        gatt.disconnect();
      }
      callbacks.onStatusChange?.({
        connected: false,
        deviceName,
        isAthena,
        preset,
      });
    },
  };
}

/**
 * Create a realistic simulated Muse S Athena stream for testing and calibration
 * when a physical headband is not connected.
 *
 * Simulates:
 * - 256 Hz 4-channel EEG with slowly shifting Alpha (10 Hz), Beta (20 Hz), Theta (6 Hz),
 *   and frontal asymmetry modulations
 * - 64 Hz 4-channel dual-wavelength fNIRS/PPG optics (LI_730, RI_730, LI_850, RI_850)
 *   with cardiac PPG waveform (~72 BPM + respiratory sinus arrhythmia HRV) and
 *   slow prefrontal hemodynamic HbO2/HHb waves
 * - 52 Hz 6-axis IMU motion
 */
export function createSimulatedAthenaClient(callbacks = {}) {
  const deviceName = 'Muse S Athena (Simulated)';
  const isAthena = true;
  const preset = 'p1035';

  let sampleCounterEeg = 0;
  let sampleCounterOptics = 0;
  let running = true;

  callbacks.onStatusChange?.({
    connected: true,
    deviceName,
    isAthena,
    preset,
    simulated: true,
  });

  callbacks.onTelemetry?.({ batteryLevel: 88 });

  // Emit every 62.5 ms: 16 EEG samples (256 Hz), 4 Optics samples (64 Hz), 3 Motion samples (~48 Hz)
  const intervalId = setInterval(() => {
    if (!running) return;
    const now = Date.now();

    // 1. Generate 16 EEG samples per channel (256 Hz)
    const eegChannels = [[], [], [], []];
    for (let s = 0; s < 16; s++) {
      const t = sampleCounterEeg / ATHENA_EEG_SAMPLE_RATE;
      sampleCounterEeg++;

      // Slowly cycle between a high-focus (beta-dominant) state and a calm (alpha-dominant) state every ~30s
      const statePhase = Math.sin(2 * Math.PI * (t / 30));
      const alphaAmp = statePhase > 0 ? 12.0 : 5.0;
      const betaAmp = statePhase > 0 ? 4.0 : 10.5;
      const thetaAmp = 4.5 + 1.5 * Math.cos(2 * Math.PI * (t / 45));
      const deltaAmp = 3.5;

      for (let ch = 0; ch < 4; ch++) {
        const chPhase = ch * 0.35;
        // Frontal asymmetry difference between AF7 (ch 1) and AF8 (ch 2)
        const asymScale = ch === 2 ? 1.15 : ch === 1 ? 0.88 : 1.0;
        const val =
          deltaAmp * Math.sin(2 * Math.PI * 2.5 * t + chPhase) +
          thetaAmp * Math.sin(2 * Math.PI * 6.0 * t + chPhase) +
          alphaAmp * asymScale * Math.sin(2 * Math.PI * 10.2 * t + chPhase) +
          betaAmp * Math.sin(2 * Math.PI * 20.5 * t + chPhase * 1.7) +
          1.2 * Math.sin(2 * Math.PI * 35.0 * t) +
          (Math.random() - 0.5) * 2.2;
        eegChannels[ch].push(val);
      }
    }
    callbacks.onEeg?.({
      timestamp: now,
      samplesByChannel: eegChannels,
    });

    // 2. Generate 4 Optics samples per channel (64 Hz): ['LI_730', 'RI_730', 'LI_850', 'RI_850']
    const opticsChannels = [[], [], [], []];
    const baseI0 = 250000;
    for (let s = 0; s < 4; s++) {
      const t = sampleCounterOptics / ATHENA_OPTICS_SAMPLE_RATE;
      sampleCounterOptics++;

      // Heart rate ~ 72 BPM (1.2 Hz) with respiratory sinus arrhythmia (0.22 Hz phase modulation)
      const cardiacPhase = 2 * Math.PI * 1.2 * t + 0.18 * Math.sin(2 * Math.PI * 0.22 * t);
      // Realistic systolic + dicrotic notch pulse shape
      const ppgPulse =
        Math.sin(cardiacPhase) + 0.35 * Math.sin(2 * cardiacPhase - 0.6);

      // Slow prefrontal oxygenation wave (~0.04 Hz Mayer/task wave):
      // When HbO2 rises (+1.5 uM), 850nm absorption increases (intensity drops slightly more than 730nm)
      const hemoWave = Math.sin(2 * Math.PI * 0.035 * t);
      const od730 = -0.0008 * hemoWave + 0.0018 * ppgPulse;
      const od850 = 0.0022 * hemoWave + 0.0032 * ppgPulse;

      const i730L = baseI0 * Math.exp(-od730) + (Math.random() - 0.5) * 15;
      const i730R = baseI0 * Math.exp(-od730 * 0.96) + (Math.random() - 0.5) * 15;
      const i850L = baseI0 * Math.exp(-od850) + (Math.random() - 0.5) * 15;
      const i850R = baseI0 * Math.exp(-od850 * 1.03) + (Math.random() - 0.5) * 15;

      opticsChannels[0].push(i730L);
      opticsChannels[1].push(i730R);
      opticsChannels[2].push(i850L);
      opticsChannels[3].push(i850R);
    }
    callbacks.onOptics?.({
      timestamp: now,
      channelNames: ['LI_730', 'RI_730', 'LI_850', 'RI_850'],
      channels: opticsChannels,
    });

    // 3. Generate 3 Motion samples
    const accel = [];
    const gyro = [];
    for (let s = 0; s < 3; s++) {
      accel.push({
        x: 0.02 + (Math.random() - 0.5) * 0.005,
        y: -0.01 + (Math.random() - 0.5) * 0.005,
        z: 0.99 + (Math.random() - 0.5) * 0.005,
      });
      gyro.push({
        x: (Math.random() - 0.5) * 0.8,
        y: (Math.random() - 0.5) * 0.8,
        z: (Math.random() - 0.5) * 0.8,
      });
    }
    callbacks.onMotion?.({ timestamp: now, accel, gyro });
  }, 62.5);

  return {
    deviceName,
    isAthena,
    preset,
    simulated: true,
    async disconnect() {
      running = false;
      clearInterval(intervalId);
      callbacks.onStatusChange?.({
        connected: false,
        deviceName,
        isAthena,
        preset,
        simulated: true,
      });
    },
  };
}
