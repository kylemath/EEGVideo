/**
 * Unified Web Bluetooth client for all InteraXon Muse headbands:
 * - Muse S Athena (MS-03 / Gen 3): Multiplexed universal sensor characteristic (273e0013)
 * - Muse 2 / Classic Muse S: Per-sensor characteristics (273e0003..0006, 0009..000b)
 * - Muse 2016 (MU-02): Two-phase lazy GATT discovery (Control + 4 EEG characteristics)
 *
 * No Muse mobile app or OSC/LSL forwarding bridge required — connects directly
 * in the browser via Web Bluetooth and exposes standard RxJS `eegReadings`
 * compatible with `zipSamples`.
 */
import { Subject, BehaviorSubject, fromEvent } from 'rxjs';
import { map } from 'rxjs/operators';
import {
  ATHENA_DATA_CHAR,
  ATHENA_DATA2_CHAR,
  ATHENA_DEFAULT_PRESET,
  ATHENA_EEG_SAMPLE_RATE,
  parseAthenaNotification,
} from './museAthena.js';

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
const EEG_FREQUENCY = 256;
const SAMPLES_PER_READING = 12;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

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

function decodeControlFragment(dv) {
  const bytes = new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength);
  if (bytes.length === 0) return '';
  const len = bytes[0];
  return new TextDecoder().decode(bytes.subarray(1, Math.min(1 + len, bytes.length)));
}

/**
 * Connect to a device, get service + control char, and start control notifications.
 */
async function connectAndSetup(device) {
  console.log('[muse-client] Connecting to', device.name || 'Muse', '...');
  const gatt = await device.gatt.connect();
  const service = await gatt.getPrimaryService(MUSE_SERVICE);
  const controlChar = await service.getCharacteristic(CONTROL_CHAR);

  // Start notifications on control char BEFORE sending commands
  await controlChar.startNotifications();
  console.log('[muse-client] Control characteristic notifications started');

  return { gatt, service, controlChar };
}

/**
 * Inspect available GATT characteristics on the service.
 */
async function discoverCharacteristicUuids(service) {
  const found = new Set();
  try {
    const chars = await service.getCharacteristics();
    for (const c of chars) {
      found.add(c.uuid.toLowerCase());
    }
    return found;
  } catch {
    // Fallback if getCharacteristics() is restricted on a platform
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
        // Not present
      }
    }
    return found;
  }
}

/**
 * Connect to any Muse headband (Muse S Athena, Muse S, Muse 2, Muse 2016) directly
 * over Web Bluetooth without requiring the Muse app.
 *
 * @param {BluetoothRemoteGATTServer|null} existingGatt - Optional GATT from a prior connection attempt.
 * @param {object} options - Optional configuration (e.g., { preset: 'p1035', enableAux: false }).
 */
export async function connectMuseMinimal(existingGatt = null, options = {}) {
  let device;

  if (existingGatt?.device) {
    device = existingGatt.device;
    if (existingGatt.connected) {
      console.log('[muse-client] Using existing connected GATT session...');
    }
  } else {
    device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [MUSE_SERVICE] }, { namePrefix: 'Muse' }],
      optionalServices: [MUSE_SERVICE],
    });
  }

  let { gatt, service, controlChar } = await connectAndSetup(device);
  let uuids = await discoverCharacteristicUuids(service);

  const isAthena = uuids.has(ATHENA_DATA_CHAR) && !uuids.has(EEG_CHARS[0]);
  const eegCharsReady = uuids.has(EEG_CHARS[0]);

  if (isAthena) {
    console.log('[muse-client] Detected Muse S Athena (MS-03) firmware via 273e0013');
  } else if (eegCharsReady) {
    console.log('[muse-client] Detected Classic Muse (EEG characteristics immediately available)');
  } else {
    console.log('[muse-client] EEG chars not available yet (Muse 2016 / lazy GATT) — sending wake commands...');
    await writeCmd(controlChar, 'v1');
    await wait(100);
    await writeCmd(controlChar, 'h');
    await writeCmd(controlChar, 'p21');
    await writeCmd(controlChar, 's');
    await writeCmd(controlChar, 'd');
    await wait(500);

    // Re-check GATT table first before disconnecting
    uuids = await discoverCharacteristicUuids(service);
    if (!uuids.has(EEG_CHARS[0]) && !uuids.has(ATHENA_DATA_CHAR)) {
      // Force Chrome to re-discover newly advertised GATT characteristics
      if (gatt.connected) gatt.disconnect();
      await wait(500);
      console.log('[muse-client] Reconnecting to discover EEG characteristics...');
      ({ gatt, service, controlChar } = await connectAndSetup(device));
      uuids = await discoverCharacteristicUuids(service);
    }

    if (!uuids.has(EEG_CHARS[0]) && !uuids.has(ATHENA_DATA_CHAR)) {
      throw new Error(
        'EEG characteristics still not available after init + reconnect. ' +
        'Try turning the Muse off and on again.'
      );
    }
  }

  const finalIsAthena = uuids.has(ATHENA_DATA_CHAR) && !uuids.has(EEG_CHARS[0]);

  const eegReadings = new Subject();
  const telemetryData = new Subject();
  const accelerometerData = new Subject();
  const gyroscopeData = new Subject();
  const opticsReadings = new Subject();
  const controlResponses = new Subject();
  const connectionStatus = new BehaviorSubject(true);
  const subscriptions = [];

  // Control response accumulator
  let controlBuffer = '';
  const controlSub = fromEvent(controlChar, 'characteristicvaluechanged').subscribe((ev) => {
    const fragment = decodeControlFragment(ev.target.value);
    for (let i = 0; i < fragment.length; i++) {
      const ch = fragment[i];
      controlBuffer += ch;
      if (ch === '}') {
        const startIdx = controlBuffer.indexOf('{');
        if (startIdx !== -1) {
          const candidate = controlBuffer.slice(startIdx);
          try {
            controlResponses.next(JSON.parse(candidate));
          } catch {
            // Ignore malformed fragment
          }
        }
        controlBuffer = '';
      } else if (controlBuffer.length > 4096) {
        controlBuffer = controlBuffer.slice(-1024);
      }
    }
  });
  subscriptions.push(controlSub);

  // Classic timestamp tracker (16-bit sequence index, 12 samples per reading)
  let classicLastIndex = null;
  let classicLastTimestamp = null;
  function getClassicTimestamp(eventIndex) {
    const READING_DELTA = (1000 / EEG_FREQUENCY) * SAMPLES_PER_READING;
    if (classicLastIndex == null || classicLastTimestamp == null) {
      classicLastIndex = eventIndex;
      classicLastTimestamp = Date.now() - READING_DELTA;
    }
    while (classicLastIndex - eventIndex > 0x1000) eventIndex += 0x10000;
    if (eventIndex === classicLastIndex) return classicLastTimestamp;
    if (eventIndex > classicLastIndex) {
      classicLastTimestamp += READING_DELTA * (eventIndex - classicLastIndex);
      classicLastIndex = eventIndex;
      return classicLastTimestamp;
    }
    return classicLastTimestamp - READING_DELTA * (classicLastIndex - eventIndex);
  }

  // Athena sequence & timestamp tracker (8-bit subpacket index, 4 or 2 samples per subpacket)
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
    let dropped = 0;
    if (last) {
      const step = (seqIndex - last.seq + 256) % 256 || 1;
      unwrappedCount = last.count + step;
      dropped = step - 1;
    }
    athenaSeqTracker.set(key, { seq: seqIndex, count: unwrappedCount });
    const sampleIndex = unwrappedCount * samplesPerSubpacket;
    const timestamp = athenaStartWallTime + (sampleIndex * 1000) / sampleRate;
    return { unwrappedCount, sampleIndex, timestamp, dropped };
  }

  // Listen for unexpected BLE disconnect
  const onGattDisconnected = () => {
    connectionStatus.next(false);
  };
  device.addEventListener('gattserverdisconnected', onGattDisconnected);

  const client = {
    gatt,
    service,
    controlChar,
    eegReadings,
    telemetryData,
    accelerometerData,
    gyroscopeData,
    opticsReadings,
    controlResponses,
    connectionStatus,
    deviceName: device.name || (finalIsAthena ? 'Muse S Athena' : 'Muse'),
    isAthena: finalIsAthena,
    preset: finalIsAthena ? (options.preset || ATHENA_DEFAULT_PRESET) : 'p21',

    async sendCommand(cmd) {
      await writeCmd(this.controlChar, cmd);
    },

    async start() {
      if (this.isAthena) {
        // 1. Subscribe to Athena multiplexed data characteristic BEFORE sending start commands
        const handleAthenaNotification = (ev) => {
          const dv = ev.target.value;
          const bytes = new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength);
          parseAthenaNotification(bytes, (sub) => {
            if (sub.type === 'eeg') {
              athenaReceivedEEG = true;
              const nSamples = sub.values[0]?.length || 4;
              const { unwrappedCount, timestamp } = trackAthenaSubpacket(
                sub.tag,
                sub.index,
                nSamples,
                ATHENA_EEG_SAMPLE_RATE
              );
              const numCh = Math.min(sub.values.length, options.enableAux ? 8 : 4);
              for (let ch = 0; ch < numCh; ch++) {
                eegReadings.next({
                  electrode: ch,
                  index: unwrappedCount,
                  samples: sub.values[ch],
                  timestamp,
                });
              }
            } else if (sub.type === 'optics') {
              const nSamples = sub.values[0]?.length || 3;
              const { unwrappedCount, timestamp } = trackAthenaSubpacket(
                sub.tag,
                sub.index,
                nSamples,
                64
              );
              opticsReadings.next({
                index: unwrappedCount,
                channels: sub.values,
                timestamp,
              });
            } else if (sub.type === 'motion') {
              accelerometerData.next({
                sequenceId: sub.index,
                samples: [0, 1, 2].map((i) => ({
                  x: sub.values[0][i],
                  y: sub.values[1][i],
                  z: sub.values[2][i],
                })),
              });
              gyroscopeData.next({
                sequenceId: sub.index,
                samples: [0, 1, 2].map((i) => ({
                  x: sub.values[3][i],
                  y: sub.values[4][i],
                  z: sub.values[5][i],
                })),
              });
            } else if (sub.type === 'battery') {
              telemetryData.next({
                sequenceId: sub.index,
                batteryLevel: sub.values[0][0],
                fuelGaugeVoltage: 0,
                temperature: 0,
              });
            }
          });
        };

        const dataChar = await this.service.getCharacteristic(ATHENA_DATA_CHAR);
        await dataChar.startNotifications();
        subscriptions.push(
          fromEvent(dataChar, 'characteristicvaluechanged').subscribe(handleAthenaNotification)
        );

        if (uuids.has(ATHENA_DATA2_CHAR)) {
          try {
            const data2Char = await this.service.getCharacteristic(ATHENA_DATA2_CHAR);
            await data2Char.startNotifications();
            subscriptions.push(
              fromEvent(data2Char, 'characteristicvaluechanged').subscribe(handleAthenaNotification)
            );
          } catch {
            // Secondary Athena characteristic is optional
          }
        }

        // 2. Send Athena initialization handshake sequence:
        //    v6 -> s -> h -> preset (p1035) -> s -> dc001 -> dc001 -> L1 -> s
        console.log(`[muse-client] Starting Muse S Athena with preset ${this.preset}...`);
        const initSequence = [
          ['v6', 200],
          ['s', 200],
          ['h', 200],
          [this.preset, 200],
          ['s', 200],
          ['dc001', 50],
          ['dc001', 100],
          ['L1', 300],
          ['s', 200],
        ];
        for (const [cmd, delayMs] of initSequence) {
          await writeCmd(this.controlChar, cmd);
          await wait(delayMs);
        }

        // Wait up to 1.5s for EEG packets; if firmware rejected dc001, send 'd' fallback
        for (let waited = 0; waited < 1500 && !athenaReceivedEEG; waited += 100) {
          await wait(100);
        }
        if (!athenaReceivedEEG) {
          console.log('[muse-client] Sending classic resume ("d") fallback for Athena firmware...');
          await writeCmd(this.controlChar, 'd');
          for (let waited = 0; waited < 1500 && !athenaReceivedEEG; waited += 100) {
            await wait(100);
          }
        }
        console.log('[muse-client] Muse S Athena EEG stream started');
        return;
      }

      // Classic Muse (Muse 2016, Muse 2, Classic Muse S)
      await writeCmd(this.controlChar, 'h');
      await writeCmd(this.controlChar, 'p21');
      await writeCmd(this.controlChar, 's');
      await writeCmd(this.controlChar, 'd');

      const numCh = options.enableAux ? 5 : 4;
      for (let ch = 0; ch < numCh; ch++) {
        if (ch === 4 && !uuids.has(EEG_CHARS[4])) continue;
        const char = await this.service.getCharacteristic(EEG_CHARS[ch]);
        await char.startNotifications();
        const sub = fromEvent(char, 'characteristicvaluechanged')
          .pipe(
            map((ev) => ev.target.value),
            map((dv) => {
              const eventIndex = dv.getUint16(0);
              const samples = decodeClassicEEGSamples(
                new Uint8Array(dv.buffer, dv.byteOffset + 2, dv.byteLength - 2)
              );
              const timestamp = getClassicTimestamp(eventIndex);
              return { electrode: ch, index: eventIndex, samples, timestamp };
            })
          )
          .subscribe((reading) => eegReadings.next(reading));
        subscriptions.push(sub);
      }

      // Optional non-fatal telemetry & IMU on Classic Muse
      if (uuids.has(TELEMETRY_CHAR)) {
        try {
          const telemChar = await this.service.getCharacteristic(TELEMETRY_CHAR);
          await telemChar.startNotifications();
          subscriptions.push(
            fromEvent(telemChar, 'characteristicvaluechanged').subscribe((ev) => {
              const dv = ev.target.value;
              telemetryData.next({
                sequenceId: dv.getUint16(0),
                batteryLevel: dv.getUint16(2) / 512,
                fuelGaugeVoltage: dv.getUint16(4) * 2.2,
                temperature: dv.getUint16(8),
              });
            })
          );
        } catch {
          // Ignore optional telemetry failure
        }
      }

      console.log('[muse-client] Classic Muse EEG stream started (4 channels)');
    },

    async pause() {
      await writeCmd(this.controlChar, 'h');
    },

    async resume() {
      if (this.isAthena) {
        await writeCmd(this.controlChar, 'dc001');
        await wait(50);
        await writeCmd(this.controlChar, 'dc001');
      } else {
        await writeCmd(this.controlChar, 'd');
      }
    },

    disconnect() {
      if (this.isAthena && this.controlChar && this.gatt?.connected) {
        writeCmd(this.controlChar, 'h').catch(() => {});
      }
      device.removeEventListener('gattserverdisconnected', onGattDisconnected);
      subscriptions.forEach((s) => s.unsubscribe());
      eegReadings.complete();
      telemetryData.complete();
      accelerometerData.complete();
      gyroscopeData.complete();
      opticsReadings.complete();
      controlResponses.complete();
      connectionStatus.next(false);
      connectionStatus.complete();
      if (this.gatt?.connected) this.gatt.disconnect();
    },
  };

  return client;
}
