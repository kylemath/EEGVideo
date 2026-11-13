/**
 * Popup Controller — Muse S Athena Sync Logger
 */
import {
  exportFullBundleTar,
  exportPhysioCsvFile,
  exportEventsCsvFile,
  exportJsonlFile,
} from './storage/exporter.js';

const ui = {
  bleBadge: document.getElementById('bleBadge'),
  recBadge: document.getElementById('recBadge'),
  openBridgeBtn: document.getElementById('openBridgeBtn'),
  simBtn: document.getElementById('simBtn'),
  zeroFnirsBtn: document.getElementById('zeroFnirsBtn'),
  recordToggleBtn: document.getElementById('recordToggleBtn'),
  batterySpan: document.getElementById('batterySpan'),
  pHr: document.getElementById('pHr'),
  pHrv: document.getElementById('pHrv'),
  pStill: document.getElementById('pStill'),
  pHbo2: document.getElementById('pHbo2'),
  pHhb: document.getElementById('pHhb'),
  pHbt: document.getElementById('pHbt'),
  pFocus: document.getElementById('pFocus'),
  pCalm: document.getElementById('pCalm'),
  pFaa: document.getElementById('pFaa'),
  barDelta: document.getElementById('barDelta'),
  barTheta: document.getElementById('barTheta'),
  barAlpha: document.getElementById('barAlpha'),
  barBeta: document.getElementById('barBeta'),
  barGamma: document.getElementById('barGamma'),
  valDelta: document.getElementById('valDelta'),
  valTheta: document.getElementById('valTheta'),
  valAlpha: document.getElementById('valAlpha'),
  valBeta: document.getElementById('valBeta'),
  valGamma: document.getElementById('valGamma'),
  pTP9: document.getElementById('pTP9'),
  pAF7: document.getElementById('pAF7'),
  pAF8: document.getElementById('pAF8'),
  pTP10: document.getElementById('pTP10'),
  pTags: document.getElementById('pTags'),
  tagInput: document.getElementById('tagInput'),
  tagBtn: document.getElementById('tagBtn'),
  cfgInterval: document.getElementById('cfgInterval'),
  cfgClickShot: document.getElementById('cfgClickShot'),
  cfgNavShot: document.getElementById('cfgNavShot'),
  cfgKeyText: document.getElementById('cfgKeyText'),
  cfgRawSensors: document.getElementById('cfgRawSensors'),
  pCounts: document.getElementById('pCounts'),
  expTarBtn: document.getElementById('expTarBtn'),
  expPhysioBtn: document.getElementById('expPhysioBtn'),
  expEventsBtn: document.getElementById('expEventsBtn'),
  expJsonlBtn: document.getElementById('expJsonlBtn'),
  clearBtn: document.getElementById('clearBtn'),
};

let currentIsRecording = false;
let configInitialized = false;

function setBar(barEl, valEl, relValue) {
  const pct = Math.min(100, Math.max(0, Math.round((relValue || 0) * 100)));
  barEl.style.width = `${pct}%`;
  valEl.textContent = `${pct}%`;
}

function setElectrodePill(el, label, sd) {
  el.textContent = `${label}: ${sd ? sd.toFixed(1) : '--'}`;
  if (sd >= 1.0 && sd <= 35.0) {
    el.className = 'electrode-pill good';
  } else if (sd > 35.0) {
    el.className = 'electrode-pill noisy';
  } else {
    el.className = 'electrode-pill';
  }
}

function renderState(state) {
  currentIsRecording = !!state.isRecording;

  if (state.bleStatus?.connected) {
    ui.bleBadge.textContent = state.bleStatus.simulated ? 'Simulated' : 'Connected';
    ui.bleBadge.className = 'badge connected';
  } else {
    ui.bleBadge.textContent = 'Offline';
    ui.bleBadge.className = 'badge';
  }

  if (state.isRecording) {
    ui.recBadge.style.display = 'inline-flex';
    ui.recBadge.className = 'badge recording';
    ui.recordToggleBtn.textContent = 'Stop Rec';
    ui.recordToggleBtn.className = 'stop-btn';
  } else {
    ui.recBadge.style.display = 'none';
    ui.recordToggleBtn.textContent = 'Start Rec';
    ui.recordToggleBtn.className = 'record-btn';
  }

  const p = state.latestPhysio;
  if (p) {
    ui.batterySpan.textContent = p.batteryLevel != null ? `Batt: ${p.batteryLevel}%` : '';
    ui.pHr.textContent = p.heartRateBpm > 0 ? p.heartRateBpm.toFixed(0) : '--';
    ui.pHrv.textContent = p.hrvRmssdMs > 0 ? p.hrvRmssdMs.toFixed(0) : '--';
    ui.pStill.textContent = `${p.stillnessScore ?? 100}`;

    const fmtSigned = (v) => ((v || 0) >= 0 ? `+${(v || 0).toFixed(2)}` : (v || 0).toFixed(2));
    ui.pHbo2.textContent = fmtSigned(p.hbO2);
    ui.pHhb.textContent = fmtSigned(p.hhb);
    ui.pHbt.textContent = fmtSigned(p.hbt);

    ui.pFocus.textContent = p.eegReady ? p.focusIndex.toFixed(2) : '--';
    ui.pCalm.textContent = p.eegReady ? p.calmIndex.toFixed(2) : '--';
    ui.pFaa.textContent = p.eegReady ? fmtSigned(p.frontalAlphaAsymmetry) : '--';

    setBar(ui.barDelta, ui.valDelta, p.deltaRel);
    setBar(ui.barTheta, ui.valTheta, p.thetaRel);
    setBar(ui.barAlpha, ui.valAlpha, p.alphaRel);
    setBar(ui.barBeta, ui.valBeta, p.betaRel);
    setBar(ui.barGamma, ui.valGamma, p.gammaRel);

    const sq = p.signalQuality || {};
    setElectrodePill(ui.pTP9, 'TP9', sq.TP9);
    setElectrodePill(ui.pAF7, 'AF7', sq.AF7);
    setElectrodePill(ui.pAF8, 'AF8', sq.AF8);
    setElectrodePill(ui.pTP10, 'TP10', sq.TP10);

    ui.pTags.innerHTML = '';
    for (const tag of p.stateTags || []) {
      const span = document.createElement('span');
      span.className = 'state-tag';
      span.textContent = tag;
      ui.pTags.appendChild(span);
    }
  }

  const c = state.counts || {};
  ui.pCounts.textContent = `${c.physio_ticks || 0} ticks • ${c.computer_events || 0} events • ${c.screenshots || 0} shots`;

  if (!configInitialized && state.config) {
    configInitialized = true;
    ui.cfgInterval.value = String(state.config.screenshotIntervalSec ?? 10);
    ui.cfgClickShot.checked = !!state.config.screenshotOnClick;
    ui.cfgNavShot.checked = !!state.config.screenshotOnNavigation;
    ui.cfgKeyText.checked = !!state.config.captureKeyText;
    ui.cfgRawSensors.checked = !!state.config.recordRawSensors;
  }
}

function pollStatus() {
  chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (res) => {
    if (res?.ok && res.state) {
      renderState(res.state);
    }
  });
}

function pushConfigChange() {
  const payload = {
    screenshotIntervalSec: Number(ui.cfgInterval.value) || 0,
    screenshotOnClick: ui.cfgClickShot.checked,
    screenshotOnNavigation: ui.cfgNavShot.checked,
    captureKeyText: ui.cfgKeyText.checked,
    recordRawSensors: ui.cfgRawSensors.checked,
  };
  chrome.runtime.sendMessage({ type: 'UPDATE_CONFIG', payload });
}

ui.cfgInterval.addEventListener('change', pushConfigChange);
ui.cfgClickShot.addEventListener('change', pushConfigChange);
ui.cfgNavShot.addEventListener('change', pushConfigChange);
ui.cfgKeyText.addEventListener('change', pushConfigChange);
ui.cfgRawSensors.addEventListener('change', pushConfigChange);

ui.openBridgeBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'OPEN_BLE_BRIDGE', autoSimulate: false });
});

ui.simBtn.addEventListener('click', () => {
  // Send simulate message to existing bridge tab if open, or open bridge tab with ?simulate=1
  chrome.runtime.sendMessage({ type: 'BRIDGE_SIMULATE' }, (res) => {
    if (chrome.runtime.lastError || !res?.ok) {
      chrome.runtime.sendMessage({ type: 'OPEN_BLE_BRIDGE', autoSimulate: true });
    }
  });
});

ui.zeroFnirsBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'BRIDGE_RESET_FNIRS' });
});

ui.recordToggleBtn.addEventListener('click', () => {
  const type = currentIsRecording ? 'STOP_RECORDING' : 'START_RECORDING';
  chrome.runtime.sendMessage({ type }, () => pollStatus());
});

function submitManualTag() {
  const note = ui.tagInput.value.trim();
  if (!note) return;
  chrome.runtime.sendMessage({ type: 'ADD_MANUAL_TAG', note }, () => {
    ui.tagInput.value = '';
    pollStatus();
  });
}

ui.tagBtn.addEventListener('click', submitManualTag);
ui.tagInput.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter') submitManualTag();
});

ui.expTarBtn.addEventListener('click', () => exportFullBundleTar());
ui.expPhysioBtn.addEventListener('click', () => exportPhysioCsvFile());
ui.expEventsBtn.addEventListener('click', () => exportEventsCsvFile());
ui.expJsonlBtn.addEventListener('click', () => exportJsonlFile());

ui.clearBtn.addEventListener('click', () => {
  if (confirm('Clear all recorded physiological ticks, computer-use events, and screenshots?')) {
    chrome.runtime.sendMessage({ type: 'CLEAR_SESSION_DATA' }, () => pollStatus());
  }
});

setInterval(pollStatus, 400);
pollStatus();
