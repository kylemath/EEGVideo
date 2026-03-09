/**
 * Minimal Muse client for Muse 2016 (MU-02), Muse 2, and Muse S.
 *
 * Protocol notes (from reverse-engineering + Brainimation project):
 *
 * 1. Control characteristic (273e0001) must have notifications started BEFORE
 *    sending any commands — the device uses this bidirectional channel.
 *
 * 2. On Muse 2016, EEG characteristics (273e0003–0006) only appear AFTER
 *    sending preset + start commands. On Muse 2/S they may be available
 *    immediately.
 *
 * 3. The device may boot into a limited mode. Sending 'v1' (version query)
 *    helps transition to normal mode.
 *
 * 4. After init commands, we must disconnect and reconnect to force Chrome
 *    to re-discover the GATT database (Chrome caches characteristics
 *    per-connection and won't see newly-advertised ones).
 */
import { Subject, fromEvent } from 'rxjs';
import { map } from 'rxjs/operators';

const MUSE_SERVICE = 0xfe8d;
const CONTROL_CHAR = '273e0001-4c4d-454d-96be-f03bac821358';
const EEG_CHARS = [
  '273e0003-4c4d-454d-96be-f03bac821358',
  '273e0004-4c4d-454d-96be-f03bac821358',
  '273e0005-4c4d-454d-96be-f03bac821358',
  '273e0006-4c4d-454d-96be-f03bac821358',
];
const EEG_FREQUENCY = 256;
const SAMPLES_PER_READING = 12;

function decodeEEGSamples(samples) {
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

function encodeCommand(cmd) {
  const encoded = new TextEncoder().encode('X' + cmd + '\n');
  encoded[0] = encoded.length - 1;
  return encoded;
}

async function writeCmd(controlChar, cmd) {
  await controlChar.writeValue(encodeCommand(cmd));
}

/**
 * Helper: connect to a device, get service + control char, start control
 * notifications (required for Muse protocol handshake).
 */
async function connectAndSetup(device) {
  console.log('[minimal-muse] Connecting to', device.name || 'Muse', '...');
  const gatt = await device.gatt.connect();
  const service = await gatt.getPrimaryService(MUSE_SERVICE);
  const controlChar = await service.getCharacteristic(CONTROL_CHAR);

  // CRITICAL: start notifications on control char — the Muse requires this
  // bidirectional channel to be open before it processes commands properly.
  await controlChar.startNotifications();
  console.log('[minimal-muse] Control char notifications started');

  return { gatt, service, controlChar };
}

/**
 * Create a minimal Muse client compatible with Muse 2016, Muse 2, and Muse S.
 *
 * @param {BluetoothRemoteGATTServer|null} existingGatt - GATT from a failed
 *   muse-js attempt. The device will be disconnected and reconnected fresh.
 *   If null, a new Bluetooth picker is shown.
 */
export async function connectMuseMinimal(existingGatt = null) {
  let device;

  if (existingGatt) {
    device = existingGatt.device;
    console.log('[minimal-muse] Disconnecting stale muse-js GATT...');
    if (existingGatt.connected) existingGatt.disconnect();
    await new Promise((r) => setTimeout(r, 300));
  } else {
    device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [MUSE_SERVICE] }],
    });
  }

  let { gatt, service, controlChar } = await connectAndSetup(device);

  // Check if EEG chars are available immediately (Muse 2/S).
  let eegCharsReady = false;
  try {
    await service.getCharacteristic(EEG_CHARS[0]);
    eegCharsReady = true;
    console.log('[minimal-muse] EEG chars available on first connect');
  } catch {
    console.log('[minimal-muse] EEG chars not available yet — sending init commands...');
  }

  if (!eegCharsReady) {
    // Send init commands to wake the device / exit boot mode.
    // 'v1' = version query (helps exit boot mode on some firmware).
    // 'p21' = preset 21 (EEG mode). 's' = start. 'd' = resume.
    await writeCmd(controlChar, 'v1');
    await new Promise((r) => setTimeout(r, 100));
    await writeCmd(controlChar, 'h');
    await writeCmd(controlChar, 'p21');
    await writeCmd(controlChar, 's');
    await writeCmd(controlChar, 'd');
    console.log('[minimal-muse] Init commands sent, waiting for device...');

    // After init commands the Muse 2016 adds EEG characteristics to its GATT
    // database. Chrome caches characteristics per-connection, so we MUST
    // disconnect and reconnect to see the new ones.
    await new Promise((r) => setTimeout(r, 500));

    if (gatt.connected) gatt.disconnect();
    await new Promise((r) => setTimeout(r, 500));

    console.log('[minimal-muse] Reconnecting to discover EEG characteristics...');
    ({ gatt, service, controlChar } = await connectAndSetup(device));

    // Verify EEG chars are now available.
    try {
      await service.getCharacteristic(EEG_CHARS[0]);
      console.log('[minimal-muse] EEG chars found after reconnect');
    } catch (e) {
      throw new Error(
        'EEG characteristics still not available after init + reconnect. ' +
        'Try turning the Muse off and on again. (' + e.message + ')'
      );
    }
  }

  const eegReadings = new Subject();
  const eegSubscriptions = [];

  let lastIndex = null;
  let lastTimestamp = null;
  function getTimestamp(eventIndex) {
    const READING_DELTA = (1000 / EEG_FREQUENCY) * SAMPLES_PER_READING;
    if (lastIndex == null || lastTimestamp == null) {
      lastIndex = eventIndex;
      lastTimestamp = Date.now() - READING_DELTA;
    }
    while (lastIndex - eventIndex > 0x1000) eventIndex += 0x10000;
    if (eventIndex === lastIndex) return lastTimestamp;
    if (eventIndex > lastIndex) {
      lastTimestamp += READING_DELTA * (eventIndex - lastIndex);
      lastIndex = eventIndex;
      return lastTimestamp;
    }
    lastTimestamp -= READING_DELTA * (lastIndex - eventIndex);
    lastIndex = eventIndex;
    return lastTimestamp;
  }

  const client = {
    gatt,
    service,
    controlChar,
    eegReadings,
    deviceName: device.name || null,

    async sendCommand(cmd) {
      await this.controlChar.writeValue(encodeCommand(cmd));
    },

    async start() {
      // Init commands (may already have been sent during connect for Muse 2016,
      // but safe to re-send for Muse 2/S path or if state is uncertain).
      await writeCmd(this.controlChar, 'h');
      await writeCmd(this.controlChar, 'p21');
      await writeCmd(this.controlChar, 's');
      await writeCmd(this.controlChar, 'd');

      // Get all 4 EEG characteristics and start notifications.
      for (let ch = 0; ch < 4; ch++) {
        const char = await this.service.getCharacteristic(EEG_CHARS[ch]);
        await char.startNotifications();
        const sub = fromEvent(char, 'characteristicvaluechanged')
          .pipe(
            map((ev) => ev.target.value),
            map((dv) => {
              const eventIndex = dv.getUint16(0);
              const samples = decodeEEGSamples(new Uint8Array(dv.buffer).subarray(2));
              const timestamp = getTimestamp(eventIndex);
              return { electrode: ch, index: eventIndex, samples, timestamp };
            })
          )
          .subscribe((reading) => eegReadings.next(reading));
        eegSubscriptions.push(sub);
      }
      console.log('[minimal-muse] EEG stream started (4 channels)');
    },

    async pause() {
      await writeCmd(this.controlChar, 'h');
    },

    async resume() {
      await writeCmd(this.controlChar, 'd');
    },

    disconnect() {
      eegSubscriptions.forEach((s) => s.unsubscribe());
      eegReadings.complete();
      if (this.gatt?.connected) this.gatt.disconnect();
    },
  };

  return client;
}
