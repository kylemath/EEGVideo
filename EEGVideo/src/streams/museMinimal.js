/**
 * Minimal Muse client — Control characteristic only at connect time.
 *
 * Key insight from Muse protocol reverse-engineering: EEG characteristics
 * (273e0003–0006) are NOT advertised until AFTER the device receives the
 * preset ("p21") and start ("s") commands. Attempting getCharacteristic()
 * for EEG channels before sending those commands will throw NotFoundError on
 * Muse 2016 (MU-02) and some Muse 2 firmwares.
 *
 * Connection flow:
 *   connect() → control char only
 *   start()   → send h/p21/s/d, wait 500 ms, THEN fetch EEG chars
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

/**
 * Create a minimal Muse client compatible with Muse 2016, Muse 2, and Muse S.
 *
 * CRITICAL: When reusing a GATT from a failed muse-js attempt, Chrome's GATT
 * characteristic cache is stale. We MUST disconnect and reconnect the same
 * device to force fresh service discovery. The device reference survives
 * disconnect, so no second Bluetooth picker is needed.
 *
 * @param {BluetoothRemoteGATTServer|null} existingGatt - GATT from a failed
 *   muse-js attempt. The device will be disconnected and reconnected fresh.
 *   If null, a new Bluetooth picker is shown.
 */
export async function connectMuseMinimal(existingGatt = null) {
  let device;

  if (existingGatt) {
    device = existingGatt.device;
    console.log('[minimal-muse] Disconnecting stale muse-js GATT to clear characteristic cache...');
    if (existingGatt.connected) existingGatt.disconnect();
    await new Promise((r) => setTimeout(r, 300));
  } else {
    device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [MUSE_SERVICE] }],
    });
  }

  console.log('[minimal-muse] Connecting to', device.name || 'Muse', '...');
  const gatt = await device.gatt.connect();
  const service = await gatt.getPrimaryService(MUSE_SERVICE);
  const controlChar = await service.getCharacteristic(CONTROL_CHAR);
  console.log('[minimal-muse] Control characteristic OK');

  // eegReadings is a hot Subject; consumers subscribe before start() is called.
  // start() feeds it once EEG characteristics appear post-init-commands.
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
    deviceName: gatt.device?.name || null,

    async sendCommand(cmd) {
      await this.controlChar.writeValue(encodeCommand(cmd));
    },

    async start() {
      // Try getting EEG chars immediately (works on Muse 2/S with fresh GATT).
      // If not found, send init commands and retry (needed for Muse 2016).
      let eegChars = await this._tryGetEEGChars();

      if (!eegChars) {
        console.log('[minimal-muse] EEG chars not yet available, sending init commands...');
        await this.sendCommand('h');
        await this.controlChar.writeValue(encodeCommand('p21'));
        await this.sendCommand('s');
        await this.sendCommand('d');

        const delays = [500, 1000, 2000];
        for (let attempt = 0; attempt < delays.length; attempt++) {
          await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
          eegChars = await this._tryGetEEGChars();
          if (eegChars) {
            console.log(`[minimal-muse] Got EEG chars after init (attempt ${attempt + 1})`);
            break;
          }
          console.warn(`[minimal-muse] EEG chars not ready (attempt ${attempt + 1}/${delays.length})`);
          if (attempt === delays.length - 1) {
            throw new Error('EEG characteristics not available. Device may need a restart.');
          }
        }
      } else {
        console.log('[minimal-muse] EEG chars available immediately');
        await this.sendCommand('h');
        await this.controlChar.writeValue(encodeCommand('p21'));
        await this.sendCommand('s');
        await this.sendCommand('d');
      }

      for (let ch = 0; ch < 4; ch++) {
        await eegChars[ch].startNotifications();
        const sub = fromEvent(eegChars[ch], 'characteristicvaluechanged')
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

    async _tryGetEEGChars() {
      try {
        const chars = [];
        for (let ch = 0; ch < 4; ch++) {
          chars.push(await this.service.getCharacteristic(EEG_CHARS[ch]));
        }
        return chars;
      } catch {
        return null;
      }
    },

    async pause() {
      await this.sendCommand('h');
    },

    async resume() {
      await this.sendCommand('d');
    },

    disconnect() {
      eegSubscriptions.forEach((s) => s.unsubscribe());
      eegReadings.complete();
      if (this.gatt?.connected) this.gatt.disconnect();
    },
  };

  return client;
}
