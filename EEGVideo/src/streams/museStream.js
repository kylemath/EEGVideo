/**
 * Muse connection via Web Bluetooth.
 * Compatible with Muse 2016 (MU-02), Muse 2, and Muse S.
 *
 * Strategy: try muse-js first (has full feature set). If it fails because the
 * device lacks telemetry/gyro/accel characteristics (Muse 2016), fall back to
 * the minimal client which only needs Control + EEG.
 */
import { MuseClient } from 'muse-js';
import { connectMuseMinimal } from './museMinimal.js';
import { EEG_CHANNELS } from '../config/constants.js';

let museClient = null;
let connectionStatus = 'disconnected';

/**
 * Detect if an error from muse-js connect() is due to a missing BLE
 * characteristic (telemetry/gyro/accel) vs. a user cancellation or other error.
 * Both "User cancelled" and "No Characteristics matching UUID" are NotFoundError,
 * so we must inspect the message to distinguish them.
 */
function isCharacteristicMissing(err) {
  const msg = err?.message || '';
  if (msg.includes('cancel')) return false;
  return (
    msg.includes('273e000b') ||
    msg.includes('273e0009') ||
    msg.includes('273e000a') ||
    msg.includes('No Characteristics matching UUID')
  );
}

/**
 * Connect to Muse headband via Web Bluetooth.
 * @returns {Promise<MuseClient|object>} Connected MuseClient (or minimal client)
 */
export async function connectMuse() {
  if (!navigator.bluetooth) {
    throw new Error('Web Bluetooth not available. Use Chrome or Edge over HTTPS/localhost.');
  }

  connectionStatus = 'connecting';

  try {
    museClient = new MuseClient();
    museClient.enablePpg = false;
    console.log('[muse] Trying muse-js connection...');
    await museClient.connect();
    console.log('[muse] muse-js connected:', museClient.deviceName);
    connectionStatus = 'connected';
    return museClient;
  } catch (err) {
    if (isCharacteristicMissing(err)) {
      console.warn('[muse] muse-js failed on characteristic, falling back to minimal client:', err.message);
      const existingGatt = museClient?.gatt ?? null;
      museClient = await connectMuseMinimal(existingGatt);
      console.log('[muse] Minimal client connected:', museClient.deviceName);
      connectionStatus = 'connected';
      return museClient;
    }
    connectionStatus = 'disconnected';
    throw err;
  }
}

/**
 * Start streaming. Call AFTER subscribing to eegReadings.
 * @returns {Promise<void>}
 */
export async function startMuseStreaming() {
  if (!museClient) throw new Error('Muse not connected');
  await museClient.start();
}

/**
 * Pause streaming (stops data, keeps connection).
 */
export async function pauseMuseStreaming() {
  if (!museClient) return;
  if (museClient.pause) {
    await museClient.pause();
  }
}

/**
 * Disconnect Muse.
 */
export async function disconnectMuse() {
  if (!museClient) return;
  try {
    if (museClient.pause) await museClient.pause();
    if (museClient.disconnect) await museClient.disconnect();
  } catch (e) {
    console.warn('Muse disconnect error:', e);
  }
  museClient = null;
  connectionStatus = 'disconnected';
}

/**
 * Get the MuseClient instance (for subscribing to eegReadings).
 * @returns {MuseClient|null}
 */
export function getMuseClient() {
  return museClient;
}

/**
 * Get current connection status.
 * @returns {'disconnected'|'connecting'|'connected'}
 */
export function getConnectionStatus() {
  return connectionStatus;
}

export { EEG_CHANNELS };
