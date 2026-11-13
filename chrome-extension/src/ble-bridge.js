/**
 * Persistent Web Bluetooth Bridge & Live Physiology Controller.
 *
 * Runs inside `ble-bridge.html` (pinned extension tab) so the Web Bluetooth GATT
 * connection to the Muse S Athena remains uninterrupted while the user browses
 * across tabs and windows.
 */
import { connectMuseAthena, createSimulatedAthenaClient } from './ble/museAthenaClient.js';
import { PhysiologyEngine } from './dsp/physiologyEngine.js';
import {
  exportFullBundleTar,
  exportPhysioCsvFile,
  exportEventsCsvFile,
  exportJsonlFile,
} from './storage/exporter.js';

const engine = new PhysiologyEngine();
let activeClient = null;
let tickTimer = null;

// Rolling history for live canvas plot (last 180 ticks = 45 seconds at 4 Hz)
const history = {
  hbO2: [],
  hhb: [],
  hbt: [],
  focus: [],
};
const MAX_HISTORY = 180;

const el = {
  osBadge: document.getElementById('osBadge'),
  screenBadge: document.getElementById('screenBadge'),
  bleBadge: document.getElementById('bleBadge'),
  recBadge: document.getElementById('recBadge'),
  batteryText: document.getElementById('batteryText'),
  connectBtn: document.getElementById('connectBtn'),
  simulateBtn: document.getElementById('simulateBtn'),
  disconnectBtn: document.getElementById('disconnectBtn'),
  resetFnirsBtn: document.getElementById('resetFnirsBtn'),
  shareScreenBtn: document.getElementById('shareScreenBtn'),
  baseline60Btn: document.getElementById('baseline60Btn'),
  presetSelect: document.getElementById('presetSelect'),
  errorBox: document.getElementById('errorBox'),
  mHr: document.getElementById('mHr'),
  mHrv: document.getElementById('mHrv'),
  mStill: document.getElementById('mStill'),
  mHbo2: document.getElementById('mHbo2'),
  mHhb: document.getElementById('mHhb'),
  mHbt: document.getElementById('mHbt'),
  mFocus: document.getElementById('mFocus'),
  mCalm: document.getElementById('mCalm'),
  mFaa: document.getElementById('mFaa'),
  elTP9: document.getElementById('elTP9'),
  elAF7: document.getElementById('elAF7'),
  elAF8: document.getElementById('elAF8'),
  elTP10: document.getElementById('elTP10'),
  tagsContainer: document.getElementById('tagsContainer'),
  hemoCanvas: document.getElementById('hemoCanvas'),
  countsText: document.getElementById('countsText'),
  startRecBtn: document.getElementById('startRecBtn'),
  stopRecBtn: document.getElementById('stopRecBtn'),
  exportBundleBtn: document.getElementById('exportBundleBtn'),
  exportPhysioCsvBtn: document.getElementById('exportPhysioCsvBtn'),
  exportEventsCsvBtn: document.getElementById('exportEventsCsvBtn'),
  exportJsonlBtn: document.getElementById('exportJsonlBtn'),
};

function showError(msg) {
  if (!msg) {
    el.errorBox.style.display = 'none';
    el.errorBox.textContent = '';
  } else {
    el.errorBox.style.display = 'block';
    el.errorBox.textContent = msg;
  }
}

function createSensorCallbacks() {
  return {
    onEeg({ timestamp, samplesByChannel }) {
      engine.pushEeg(samplesByChannel);
      chrome.runtime.sendMessage({
        type: 'RAW_SENSOR_CHUNK',
        payload: { timestamp, sensorType: 'eeg', samplesByChannel },
      }).catch(() => {});
    },
    onOptics({ timestamp, channelNames, channels }) {
      engine.pushOptics({ timestamp, channelNames, channels });
      chrome.runtime.sendMessage({
        type: 'RAW_SENSOR_CHUNK',
        payload: { timestamp, sensorType: 'optics', channelNames, channels },
      }).catch(() => {});
    },
    onMotion({ timestamp, accel, gyro }) {
      engine.pushMotion({ timestamp, accel, gyro });
    },
    onTelemetry({ batteryLevel }) {
      engine.pushTelemetry({ batteryLevel });
      if (batteryLevel != null) {
        el.batteryText.textContent = `Battery: ${batteryLevel}%`;
      }
    },
    onStatusChange(status) {
      chrome.runtime.sendMessage({
        type: 'BLE_STATUS_UPDATE',
        payload: status,
      }).catch(() => {});
      updateConnectionUi(status);
    },
  };
}

function updateConnectionUi(status) {
  if (status.connected) {
    el.bleBadge.textContent = `${status.deviceName || 'Muse S Athena'} (${status.preset || 'p1035'})`;
    el.bleBadge.className = 'badge connected';
    el.connectBtn.disabled = true;
    el.simulateBtn.disabled = true;
    el.disconnectBtn.disabled = false;
    el.resetFnirsBtn.disabled = false;
  } else {
    el.bleBadge.textContent = 'Disconnected';
    el.bleBadge.className = 'badge';
    el.connectBtn.disabled = false;
    el.simulateBtn.disabled = false;
    el.disconnectBtn.disabled = true;
    el.resetFnirsBtn.disabled = true;
  }
}

function startPhysioLoop() {
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = setInterval(() => {
    if (!activeClient) return;
    const snap = engine.computeSnapshot();
    chrome.runtime.sendMessage({
      type: 'PHYSIO_TICK',
      payload: snap,
    }).catch(() => {});
    renderSnapshot(snap);
  }, 250);
}

function stopPhysioLoop() {
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
}

function renderElectrodePill(pillEl, name, sd) {
  pillEl.textContent = `${name}: ${sd.toFixed(1)} µV`;
  if (sd >= 1.0 && sd <= 35.0) {
    pillEl.className = 'electrode-pill good';
  } else if (sd > 35.0) {
    pillEl.className = 'electrode-pill noisy';
  } else {
    pillEl.className = 'electrode-pill';
  }
}

function renderSnapshot(snap) {
  el.mHr.textContent = snap.heartRateBpm > 0 ? snap.heartRateBpm.toFixed(0) : '--';
  el.mHrv.textContent = snap.hrvRmssdMs > 0 ? snap.hrvRmssdMs.toFixed(0) : '--';
  el.mStill.textContent = `${snap.stillnessScore}`;

  const fmtSigned = (v) => (v >= 0 ? `+${v.toFixed(2)}` : v.toFixed(2));
  el.mHbo2.textContent = fmtSigned(snap.hbO2);
  el.mHhb.textContent = fmtSigned(snap.hhb);
  el.mHbt.textContent = fmtSigned(snap.hbt);

  el.mFocus.textContent = snap.eegReady ? snap.focusIndex.toFixed(2) : '--';
  el.mCalm.textContent = snap.eegReady ? snap.calmIndex.toFixed(2) : '--';
  el.mFaa.textContent = snap.eegReady ? fmtSigned(snap.frontalAlphaAsymmetry) : '--';

  const sq = snap.signalQuality || {};
  renderElectrodePill(el.elTP9, 'TP9', sq.TP9 || 0);
  renderElectrodePill(el.elAF7, 'AF7', sq.AF7 || 0);
  renderElectrodePill(el.elAF8, 'AF8', sq.AF8 || 0);
  renderElectrodePill(el.elTP10, 'TP10', sq.TP10 || 0);

  el.tagsContainer.innerHTML = '';
  for (const tag of snap.stateTags || []) {
    const span = document.createElement('span');
    span.className = 'state-tag';
    span.textContent = tag;
    el.tagsContainer.appendChild(span);
  }

  history.hbO2.push(snap.hbO2);
  history.hhb.push(snap.hhb);
  history.hbt.push(snap.hbt);
  history.focus.push(snap.focusIndex);
  for (const k of ['hbO2', 'hhb', 'hbt', 'focus']) {
    if (history[k].length > MAX_HISTORY) history[k].shift();
  }
  drawTraces();
}

function drawTraces() {
  const canvas = el.hemoCanvas;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  // Zero line
  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, h / 2);
  ctx.lineTo(w, h / 2);
  ctx.stroke();

  const allHemo = [...history.hbO2, ...history.hhb, ...history.hbt];
  let maxAbs = 0.5;
  for (const v of allHemo) {
    if (Math.abs(v) > maxAbs) maxAbs = Math.abs(v);
  }
  maxAbs *= 1.15;

  const plotSeries = (arr, color, scaleFn) => {
    if (arr.length < 2) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < arr.length; i++) {
      const x = (i / (MAX_HISTORY - 1)) * w;
      const y = scaleFn(arr[i], h);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  };

  const hemoScale = (v, height) => height / 2 - (v / maxAbs) * (height * 0.42);
  plotSeries(history.hbO2, '#f87171', hemoScale);
  plotSeries(history.hhb, '#38bdf8', hemoScale);
  plotSeries(history.hbt, '#4ade80', hemoScale);
}

async function handleConnectBluetooth() {
  showError('');
  try {
    if (activeClient) await activeClient.disconnect();
    const preset = el.presetSelect.value || 'p1035';
    activeClient = await connectMuseAthena(createSensorCallbacks(), { preset });
    startPhysioLoop();
  } catch (err) {
    showError(err?.message || 'Bluetooth connection failed or cancelled.');
  }
}

async function handleStartSimulation() {
  showError('');
  if (activeClient) await activeClient.disconnect();
  activeClient = createSimulatedAthenaClient(createSensorCallbacks());
  startPhysioLoop();
}

async function handleDisconnect() {
  stopPhysioLoop();
  if (activeClient) {
    await activeClient.disconnect();
    activeClient = null;
  }
}

el.connectBtn.addEventListener('click', handleConnectBluetooth);
el.simulateBtn.addEventListener('click', handleStartSimulation);
el.disconnectBtn.addEventListener('click', handleDisconnect);
el.resetFnirsBtn.addEventListener('click', () => {
  engine.resetFnirsBaseline();
});

el.startRecBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'START_RECORDING' }, () => refreshStatus());
});

el.stopRecBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'STOP_RECORDING' }, () => refreshStatus());
});

el.exportBundleBtn.addEventListener('click', () => exportFullBundleTar());
el.exportPhysioCsvBtn.addEventListener('click', () => exportPhysioCsvFile());
el.exportEventsCsvBtn.addEventListener('click', () => exportEventsCsvFile());
el.exportJsonlBtn.addEventListener('click', () => exportJsonlFile());

function refreshStatus() {
  chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (res) => {
    if (!res?.ok) return;
    const st = res.state;
    if (st.isRecording) {
      el.recBadge.style.display = 'inline-flex';
      el.recBadge.className = 'badge recording';
      el.startRecBtn.disabled = true;
      el.stopRecBtn.disabled = false;
    } else {
      el.recBadge.style.display = 'none';
      el.startRecBtn.disabled = false;
      el.stopRecBtn.disabled = true;
    }
    const c = st.counts || {};
    el.countsText.textContent = `${c.physio_ticks || 0} physio ticks | ${c.computer_events || 0} events | ${c.screenshots || 0} screenshots`;
  });
}

// Listen for remote commands from the Popup UI or Background Service Worker
let screenStream = null;
let screenVideo = null;
const screenCanvas = document.createElement('canvas');

async function startWholeScreenShare() {
  try {
    if (screenStream) {
      screenStream.getTracks().forEach((t) => t.stop());
      screenStream = null;
    }
    screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        frameRate: { ideal: 2, max: 5 },
      },
      audio: false,
    });
    screenVideo = document.createElement('video');
    screenVideo.muted = true;
    screenVideo.playsInline = true;
    screenVideo.srcObject = screenStream;
    await screenVideo.play();

    el.screenBadge.textContent = 'Screenshots: Whole Desktop';
    el.screenBadge.className = 'badge connected';
    el.shareScreenBtn.textContent = 'Stop Whole-Screen Share';

    const [videoTrack] = screenStream.getVideoTracks();
    if (videoTrack) {
      videoTrack.addEventListener('ended', () => {
        screenStream = null;
        screenVideo = null;
        el.screenBadge.textContent = 'Screenshots: Chrome Tab';
        el.screenBadge.className = 'badge';
        el.shareScreenBtn.textContent = 'Share Whole Screen (IDE / Finder / Desktop)';
        chrome.runtime.sendMessage({ type: 'DESKTOP_STREAM_STATUS', active: false }).catch(() => {});
      });
    }
    chrome.runtime.sendMessage({ type: 'DESKTOP_STREAM_STATUS', active: true }).catch(() => {});
  } catch (err) {
    showError(err?.message || 'Screen share cancelled.');
  }
}

function grabDesktopFrameDataUrl(quality = 0.65) {
  if (!screenStream || !screenVideo || screenVideo.readyState < 2) {
    return '';
  }
  const vw = screenVideo.videoWidth || 1440;
  const vh = screenVideo.videoHeight || 900;
  const scale = vw > 1600 ? 1600 / vw : 1.0;
  screenCanvas.width = Math.round(vw * scale);
  screenCanvas.height = Math.round(vh * scale);
  const ctx = screenCanvas.getContext('2d');
  ctx.drawImage(screenVideo, 0, 0, screenCanvas.width, screenCanvas.height);
  return screenCanvas.toDataURL('image/jpeg', quality);
}

if (el.shareScreenBtn) {
  el.shareScreenBtn.addEventListener('click', () => {
    if (screenStream) {
      screenStream.getTracks().forEach((t) => t.stop());
      screenStream = null;
      screenVideo = null;
      el.screenBadge.textContent = 'Screenshots: Chrome Tab';
      el.screenBadge.className = 'badge';
      el.shareScreenBtn.textContent = 'Share Whole Screen (IDE / Finder / Desktop)';
      chrome.runtime.sendMessage({ type: 'DESKTOP_STREAM_STATUS', active: false }).catch(() => {});
    } else {
      startWholeScreenShare();
    }
  });
}

// 60-Second Resting Baseline Calibration Runner
let baselineInterval = null;
function start60sBaseline() {
  if (baselineInterval) return;
  engine.resetFnirsBaseline();
  chrome.runtime.sendMessage({ type: 'START_RECORDING' });
  chrome.runtime.sendMessage({ type: 'ADD_MANUAL_TAG', note: 'baseline_60s_start' });

  let remaining = 60;
  if (el.baseline60Btn) {
    el.baseline60Btn.disabled = true;
    el.baseline60Btn.textContent = `Baseline: ${remaining}s...`;
  }
  baselineInterval = setInterval(() => {
    remaining -= 1;
    if (remaining > 0) {
      if (el.baseline60Btn) el.baseline60Btn.textContent = `Baseline: ${remaining}s...`;
    } else {
      clearInterval(baselineInterval);
      baselineInterval = null;
      chrome.runtime.sendMessage({ type: 'ADD_MANUAL_TAG', note: 'baseline_60s_end' });
      if (el.baseline60Btn) {
        el.baseline60Btn.disabled = false;
        el.baseline60Btn.textContent = 'Run 60s Baseline';
      }
    }
  }, 1000);
}

if (el.baseline60Btn) {
  el.baseline60Btn.addEventListener('click', start60sBaseline);
}

// Poll macOS Companion Daemon (http://127.0.0.1:8765/poll) for OS-wide IDE/Finder/Music telemetry
async function pollMacOsCompanion() {
  try {
    const resp = await fetch('http://127.0.0.1:8765/poll', { cache: 'no-store' });
    if (!resp.ok) throw new Error('status ' + resp.status);
    const data = await resp.json();
    if (data && data.ok) {
      const appName = data.frontApp?.appName || 'macOS';
      const musicTxt =
        data.music?.state === 'playing' && data.music?.track
          ? ` • 🎵 ${data.music.track.slice(0, 18)}`
          : '';
      if (el.osBadge) {
        el.osBadge.textContent = `OS: ${appName}${musicTxt}`;
        el.osBadge.className = 'badge connected';
      }
      chrome.runtime.sendMessage({
        type: 'OS_COMPANION_UPDATE',
        payload: data,
      }).catch(() => {});
    }
  } catch {
    if (el.osBadge) {
      el.osBadge.textContent = 'OS Bridge: Browser-Only';
      el.osBadge.className = 'badge';
    }
  }
}
setInterval(pollMacOsCompanion, 500);

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || !msg.type) return false;
  if (msg.type === 'CAPTURE_DESKTOP_FRAME') {
    const dataUrl = grabDesktopFrameDataUrl((msg.quality || 60) / 100);
    sendResponse({ ok: !!dataUrl, dataUrl });
    return false;
  }
  if (msg.type === 'BRIDGE_START_BASELINE_60S') {
    start60sBaseline();
    sendResponse({ ok: true });
    return false;
  }
  if (msg.type === 'BRIDGE_SIMULATE') {
    handleStartSimulation().then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg.type === 'BRIDGE_DISCONNECT') {
    handleDisconnect().then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg.type === 'BRIDGE_RESET_FNIRS') {
    engine.resetFnirsBaseline();
    sendResponse({ ok: true });
    return false;
  }
  return false;
});

setInterval(refreshStatus, 1000);
refreshStatus();

// Auto-start simulation if requested via query param (?simulate=1)
if (new URLSearchParams(window.location.search).get('simulate') === '1') {
  handleStartSimulation();
}
