/**
 * Muse connection via Web Bluetooth.
 * Compatible with Muse S Athena (MS-03), Muse S, Muse 2, and Muse 2016 (MU-02).
 *
 * Strategy: try muse-js first (now updated with native Muse S Athena 273e0013
 * support and optional telemetry for Muse 2016). If an unpatched muse-js is
 * ever encountered and fails on a characteristic, fall back to the local
 * connectMuseMinimal client.
 */
import { MuseClient } from 'muse-js';
import { connectMuseMinimal } from './museMinimal.js';
import { EEG_CHANNELS } from '../config/constants.js';

let museClient = null;
let connectionStatus = 'disconnected';

function isCharacteristicMissing(err) {
  const msg = err?.message || '';
  if (msg.includes('cancel')) return false;
  return (
    msg.includes('273e000b') ||
    msg.includes('273e0009') ||
    msg.includes('273e000a') ||
    msg.includes('273e0003') ||
    msg.includes('No Characteristics matching UUID')
  );
}

/**
 * Connect to Muse headband via Web Bluetooth.
 * @param {object} [options] - Optional configuration (e.g. `{ preset: 'p1035' }`)
 * @returns {Promise<MuseClient|object>} Connected MuseClient
 */
export async function connectMuse(options = {}) {
  if (!navigator.bluetooth) {
    throw new Error('Web Bluetooth not available. Use Chrome or Edge over HTTPS/localhost.');
  }

  connectionStatus = 'connecting';

  try {
    museClient = new MuseClient();
    museClient.enablePpg = !!options.enablePpg;
    museClient.enableAux = !!options.enableAux;
    if (options.preset) {
      museClient.preset = options.preset;
    }
    console.log('[muse] Connecting via muse-js...');
    await museClient.connect();
    console.log(
      `[muse] muse-js connected to ${museClient.deviceName} (${
        museClient.isAthena ? 'Athena protocol' : 'Classic protocol'
      })`
    );
    connectionStatus = 'connected';
    return museClient;
  } catch (err) {
    if (isCharacteristicMissing(err)) {
      console.warn('[muse] muse-js failed on characteristic, falling back to minimal client:', err.message);
      const existingGatt = museClient?.gatt ?? null;
      museClient = await connectMuseMinimal(existingGatt, options);
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
 * @returns {object|null}
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
