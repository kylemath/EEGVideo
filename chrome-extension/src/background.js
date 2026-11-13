/**
 * Background Service Worker — Muse S Athena & Computer-Use Synchronization Engine
 *
 * Coordinates:
 * - Physiological state updates (4 Hz) and optional raw 256 Hz EEG / 64 Hz Optics from the BLE Bridge
 * - Computer-use telemetry from content scripts (mouse clicks, keyboard bursts, scroll, mouse kinematics)
 * - Browser tab switches & URL navigations
 * - Event-driven & periodic JPEG screenshots (`chrome.tabs.captureVisibleTab`)
 * - IndexedDB persistence of synchronized streams
 */
import {
  addPhysioTick,
  addComputerEvent,
  addScreenshot,
  addRawSampleChunk,
  getStoreCounts,
  clearAllSessionData,
} from './storage/sessionDb.js';

const DEFAULT_CONFIG = {
  screenshotIntervalSec: 10,
  screenshotOnClick: true,
  screenshotOnNavigation: true,
  screenshotQuality: 60,
  captureKeyText: false,
  recordRawSensors: false,
  athenaPreset: 'p1035',
};

let state = {
  isRecording: false,
  sessionId: `session_${Date.now()}`,
  sessionStartTime: Date.now(),
  bleStatus: {
    connected: false,
    deviceName: null,
    isAthena: true,
    preset: 'p1035',
    simulated: false,
  },
  latestPhysio: null,
  activeTabInfo: {
    tabId: null,
    url: '',
    domain: '',
    title: '',
  },
  chromeTabInfo: {
    tabId: null,
    url: '',
    domain: '',
    title: '',
  },
  osContext: {
    connected: false,
    frontApp: 'Chrome',
    bundleId: '',
    isChromeFrontmost: true,
    music: null,
  },
  desktopStreamActive: false,
  latestScreenshotId: '',
  screenshotCounter: 0,
  lastScreenshotTimeMs: 0,
  config: { ...DEFAULT_CONFIG },
};

// Rolling 10-second window of computer interactions for continuous correlation
let recentInteractions = []; // { t, type, count, scrollPx }
let periodicScreenshotTimer = null;

// Restore persisted state on service worker startup
chrome.storage.local.get(['savedState', 'savedConfig'], (res) => {
  if (res.savedConfig) {
    state.config = { ...DEFAULT_CONFIG, ...res.savedConfig };
  }
  if (res.savedState) {
    state.isRecording = !!res.savedState.isRecording;
    state.sessionId = res.savedState.sessionId || state.sessionId;
    state.sessionStartTime = res.savedState.sessionStartTime || state.sessionStartTime;
    state.screenshotCounter = res.savedState.screenshotCounter || 0;
  }
  syncPeriodicScreenshotTimer();
  updateBadge();
});

function persistState() {
  chrome.storage.local.set({
    savedState: {
      isRecording: state.isRecording,
      sessionId: state.sessionId,
      sessionStartTime: state.sessionStartTime,
      screenshotCounter: state.screenshotCounter,
    },
    savedConfig: state.config,
  });
}

function updateBadge() {
  if (state.isRecording) {
    chrome.action.setBadgeText({ text: 'REC' });
    chrome.action.setBadgeBackgroundColor({ color: '#dc2626' });
  } else if (state.bleStatus.connected) {
    const hr = state.latestPhysio?.heartRateBpm;
    const text = hr && hr > 0 ? String(Math.round(hr)) : 'ON';
    chrome.action.setBadgeText({ text });
    chrome.action.setBadgeBackgroundColor({ color: '#16a34a' });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

function pruneAndSummarizeRecentInteractions(now) {
  const cutoff = now - 10000;
  while (recentInteractions.length > 0 && recentInteractions[0].t < cutoff) {
    recentInteractions.shift();
  }
  let clicks = 0;
  let keys = 0;
  let scrollPx = 0;
  for (const item of recentInteractions) {
    if (item.type === 'click') clicks += 1;
    else if (item.type === 'key_burst') keys += item.count || 1;
    else if (item.type === 'scroll') scrollPx += Math.abs(item.scrollPx || 0);
  }
  return {
    recentClicks10s: clicks,
    recentKeys10s: keys,
    recentScrollPx10s: scrollPx,
  };
}

async function refreshActiveTabInfo() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab && tab.url && !tab.url.startsWith('chrome-extension://')) {
      let domain = 'local';
      try {
        domain = new URL(tab.url).hostname || 'local';
      } catch {
        // Ignore invalid URL
      }
      state.chromeTabInfo = {
        tabId: tab.id,
        url: tab.url,
        domain,
        title: tab.title || '',
      };
      if (!state.osContext.connected || state.osContext.isChromeFrontmost) {
        state.activeTabInfo = { ...state.chromeTabInfo };
      }
    }
  } catch {
    // Ignore tab query errors
  }
}

/**
 * Capture a JPEG screenshot of the whole desktop (if Share Whole Screen is active in BLE Bridge)
 * or the currently visible Chrome tab (rate-limited to max 1 per 800 ms).
 */
async function captureScreenshotIfAllowed(trigger, force = false) {
  const now = Date.now();
  if (!force && now - state.lastScreenshotTimeMs < 850) {
    return state.latestScreenshotId || '';
  }

  const quality = Math.min(95, Math.max(15, Number(state.config.screenshotQuality) || 60));
  let dataUrl = '';
  let shotUrl = state.activeTabInfo.url || '';
  let shotDomain = state.activeTabInfo.domain || 'desktop';
  let shotTitle = state.activeTabInfo.title || '';

  // 1. Try Whole-Desktop Screen Capture via BLE Bridge first (captures Antigravity IDE, Finder, Music, etc.)
  if (state.desktopStreamActive) {
    try {
      const resp = await chrome.runtime.sendMessage({
        type: 'CAPTURE_DESKTOP_FRAME',
        quality,
      });
      if (resp && resp.ok && resp.dataUrl) {
        dataUrl = resp.dataUrl;
      }
    } catch {
      // Fallback to tab capture
    }
  }

  // 2. Fallback to Chrome visible tab capture if Whole-Desktop capture is not active
  if (!dataUrl) {
    try {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (
        tab &&
        tab.url &&
        !tab.url.startsWith('chrome://') &&
        !tab.url.startsWith('chrome-extension://') &&
        !tab.url.startsWith('devtools://')
      ) {
        dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
          format: 'jpeg',
          quality,
        });
        if (!state.osContext.connected || state.osContext.isChromeFrontmost) {
          shotUrl = tab.url;
          try {
            shotDomain = new URL(tab.url).hostname || 'local';
          } catch {
            shotDomain = 'local';
          }
          shotTitle = tab.title || '';
        }
      }
    } catch {
      return '';
    }
  }

  if (!dataUrl) return '';

  state.lastScreenshotTimeMs = now;
  state.screenshotCounter += 1;
  const screenshotId = `shot_${String(state.screenshotCounter).padStart(5, '0')}.jpg`;
  state.latestScreenshotId = screenshotId;

  await addScreenshot({
    screenshotId,
    sessionId: state.sessionId,
    timestamp: now,
    sessionTimeMs: now - state.sessionStartTime,
    trigger,
    url: shotUrl,
    domain: shotDomain,
    pageTitle: shotTitle,
    dataUrl,
    physio: state.latestPhysio || null,
  });

  persistState();
  return screenshotId;
}

function syncPeriodicScreenshotTimer() {
  if (periodicScreenshotTimer) {
    clearInterval(periodicScreenshotTimer);
    periodicScreenshotTimer = null;
  }
  const sec = Number(state.config.screenshotIntervalSec) || 0;
  if (state.isRecording && sec > 0) {
    periodicScreenshotTimer = setInterval(async () => {
      if (!state.isRecording) return;
      const shotId = await captureScreenshotIfAllowed('periodic');
      if (shotId) {
        const now = Date.now();
        await addComputerEvent({
          timestamp: now,
          sessionTimeMs: now - state.sessionStartTime,
          sessionId: state.sessionId,
          eventType: 'periodic_screenshot',
          url: state.activeTabInfo.url,
          domain: state.activeTabInfo.domain,
          pageTitle: state.activeTabInfo.title,
          screenshotId: shotId,
          physio: state.latestPhysio || {},
        });
      }
    }, sec * 1000);
  }
}

// Track tab activation & URL navigation changes
chrome.tabs.onActivated.addListener(async () => {
  await refreshActiveTabInfo();
  if (!state.isRecording) return;

  let shotId = '';
  if (state.config.screenshotOnNavigation) {
    shotId = await captureScreenshotIfAllowed('tab_switch');
  }
  const now = Date.now();
  await addComputerEvent({
    timestamp: now,
    sessionTimeMs: now - state.sessionStartTime,
    sessionId: state.sessionId,
    eventType: 'tab_switch',
    url: state.activeTabInfo.url,
    domain: state.activeTabInfo.domain,
    pageTitle: state.activeTabInfo.title,
    screenshotId: shotId || state.latestScreenshotId,
    physio: state.latestPhysio || {},
  });
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.active && tab.url && !tab.url.startsWith('chrome-extension://')) {
    await refreshActiveTabInfo();
    if (!state.isRecording) return;

    let shotId = '';
    if (state.config.screenshotOnNavigation) {
      shotId = await captureScreenshotIfAllowed('navigation');
    }
    const now = Date.now();
    await addComputerEvent({
      timestamp: now,
      sessionTimeMs: now - state.sessionStartTime,
      sessionId: state.sessionId,
      eventType: 'navigation',
      url: state.activeTabInfo.url,
      domain: state.activeTabInfo.domain,
      pageTitle: state.activeTabInfo.title,
      screenshotId: shotId || state.latestScreenshotId,
      physio: state.latestPhysio || {},
    });
  }
});

// Handle messages from BLE Bridge, Content Scripts, and Popup
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return false;

  switch (msg.type) {
    case 'GET_STATUS': {
      getStoreCounts()
        .then((counts) => {
          sendResponse({
            ok: true,
            state: {
              isRecording: state.isRecording,
              sessionId: state.sessionId,
              sessionStartTime: state.sessionStartTime,
              bleStatus: state.bleStatus,
              latestPhysio: state.latestPhysio,
              activeTabInfo: state.activeTabInfo,
              osContext: state.osContext,
              desktopStreamActive: state.desktopStreamActive,
              latestScreenshotId: state.latestScreenshotId,
              config: state.config,
              counts,
            },
          });
        })
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;
    }

    case 'DESKTOP_STREAM_STATUS': {
      state.desktopStreamActive = !!msg.active;
      sendResponse({ ok: true });
      return false;
    }

    case 'OS_COMPANION_UPDATE': {
      const data = msg.payload || {};
      const appName = data.frontApp?.appName || 'macOS';
      const bundleId = data.frontApp?.bundleId || '';
      const isChrome = !!data.isChromeFrontmost;
      const music = data.music || null;
      const musicSuffix =
        music && music.state === 'playing' && music.track
          ? ` [🎵 ${music.track} — ${music.artist}]`
          : '';

      state.osContext = {
        connected: true,
        frontApp: appName,
        bundleId,
        isChromeFrontmost: isChrome,
        music,
      };

      if (!isChrome) {
        state.activeTabInfo = {
          tabId: null,
          domain: `app://${appName}`,
          url: `macos://${bundleId || appName}`,
          title: `${appName}${musicSuffix}`,
        };
      } else {
        state.activeTabInfo = {
          ...state.chromeTabInfo,
          title: `${state.chromeTabInfo.title || ''}${musicSuffix}`,
        };
      }

      // Process any discrete OS events (app_switch, click in Antigravity/Finder, key_burst, scroll, music_change)
      const osEvents = data.events || [];
      if (osEvents.length > 0) {
        (async () => {
          for (const ev of osEvents) {
            const now = ev.timestamp || Date.now();
            recentInteractions.push({
              t: now,
              type: ev.eventType === 'app_switch' ? 'navigation' : ev.eventType,
              count: ev.keyCount || 1,
              scrollPx: ev.scrollDeltaY || 0,
            });

            if (!state.isRecording) continue;

            let shotId = '';
            if (
              (ev.eventType === 'click' && state.config.screenshotOnClick) ||
              (ev.eventType === 'app_switch' && state.config.screenshotOnNavigation)
            ) {
              shotId = await captureScreenshotIfAllowed(ev.eventType);
            }

            await addComputerEvent({
              timestamp: now,
              sessionTimeMs: now - state.sessionStartTime,
              sessionId: state.sessionId,
              eventType: ev.eventType,
              url: ev.url || state.activeTabInfo.url,
              domain: ev.domain || state.activeTabInfo.domain,
              pageTitle: `${ev.pageTitle || appName}${musicSuffix}`,
              x: ev.x,
              y: ev.y,
              tagName: ev.tagName,
              selector: ev.selector,
              elementText: ev.elementText,
              keyCount: ev.keyCount,
              wpm: ev.wpm,
              ikiMs: ev.ikiMs,
              keyText: ev.rawKeyText || '',
              scrollDeltaY: ev.scrollDeltaY,
              note: ev.note || '',
              screenshotId: shotId || state.latestScreenshotId,
              physio: state.latestPhysio || {},
            });
          }
        })();
      }
      sendResponse({ ok: true });
      return false;
    }

    case 'BLE_STATUS_UPDATE': {
      state.bleStatus = { ...state.bleStatus, ...msg.payload };
      updateBadge();
      sendResponse({ ok: true });
      return false;
    }

    case 'PHYSIO_TICK': {
      const snap = msg.payload;
      state.latestPhysio = snap;
      updateBadge();

      if (state.isRecording && snap) {
        const now = snap.timestamp || Date.now();
        const recent = pruneAndSummarizeRecentInteractions(now);
        addPhysioTick({
          timestamp: now,
          sessionTimeMs: now - state.sessionStartTime,
          sessionId: state.sessionId,
          physio: snap,
          activeUrl: state.activeTabInfo.url,
          activeDomain: state.activeTabInfo.domain,
          activeTitle: state.activeTabInfo.title,
          recentClicks10s: recent.recentClicks10s,
          recentKeys10s: recent.recentKeys10s,
          recentScrollPx10s: recent.recentScrollPx10s,
          latestScreenshotId: state.latestScreenshotId,
        }).catch(() => {});
      }
      sendResponse({ ok: true });
      return false;
    }

    case 'RAW_SENSOR_CHUNK': {
      if (state.isRecording && state.config.recordRawSensors && msg.payload) {
        addRawSampleChunk({
          sessionId: state.sessionId,
          ...msg.payload,
        }).catch(() => {});
      }
      sendResponse({ ok: true });
      return false;
    }

    case 'COMPUTER_USE_EVENT': {
      const ev = msg.payload || {};
      const now = ev.timestamp || Date.now();

      if (ev.url && !ev.url.startsWith('chrome-extension://')) {
        state.activeTabInfo = {
          tabId: sender?.tab?.id ?? state.activeTabInfo.tabId,
          url: ev.url,
          domain: ev.domain || state.activeTabInfo.domain,
          title: ev.pageTitle || state.activeTabInfo.title,
        };
      }

      recentInteractions.push({
        t: now,
        type: ev.eventType,
        count: ev.keyCount || 1,
        scrollPx: ev.scrollDeltaY || 0,
      });

      if (!state.isRecording) {
        sendResponse({ ok: true, recorded: false });
        return false;
      }

      (async () => {
        let shotId = '';
        if (ev.eventType === 'click' && state.config.screenshotOnClick) {
          shotId = await captureScreenshotIfAllowed('click');
        }

        const keyText =
          ev.eventType === 'key_burst'
            ? state.config.captureKeyText
              ? ev.rawKeyText || ''
              : '[cadence-only]'
            : '';

        await addComputerEvent({
          timestamp: now,
          sessionTimeMs: now - state.sessionStartTime,
          sessionId: state.sessionId,
          eventType: ev.eventType,
          url: ev.url || state.activeTabInfo.url,
          domain: ev.domain || state.activeTabInfo.domain,
          pageTitle: ev.pageTitle || state.activeTabInfo.title,
          x: ev.x,
          y: ev.y,
          normX: ev.normX,
          normY: ev.normY,
          tagName: ev.tagName,
          selector: ev.selector,
          elementText: ev.elementText,
          keyCount: ev.keyCount,
          wpm: ev.wpm,
          ikiMs: ev.ikiMs,
          backspaceCount: ev.backspaceCount,
          keyText,
          scrollDeltaY: ev.scrollDeltaY,
          scrollDepthPct: ev.scrollDepthPct,
          mouseDistancePx: ev.mouseDistancePx,
          mouseVelocityPxS: ev.mouseVelocityPxS,
          screenshotId: shotId || state.latestScreenshotId,
          physio: state.latestPhysio || {},
        });
        sendResponse({ ok: true, recorded: true });
      })();
      return true;
    }

    case 'START_RECORDING': {
      (async () => {
        await refreshActiveTabInfo();
        state.isRecording = true;
        if (msg.newSession || !state.sessionStartTime) {
          state.sessionId = `session_${Date.now()}`;
          state.sessionStartTime = Date.now();
        }
        persistState();
        syncPeriodicScreenshotTimer();
        updateBadge();

        const shotId = await captureScreenshotIfAllowed('session_start', true);
        const now = Date.now();
        await addComputerEvent({
          timestamp: now,
          sessionTimeMs: 0,
          sessionId: state.sessionId,
          eventType: 'session_start',
          url: state.activeTabInfo.url,
          domain: state.activeTabInfo.domain,
          pageTitle: state.activeTabInfo.title,
          screenshotId: shotId,
          physio: state.latestPhysio || {},
        });
        sendResponse({ ok: true, sessionId: state.sessionId });
      })();
      return true;
    }

    case 'STOP_RECORDING': {
      state.isRecording = false;
      persistState();
      syncPeriodicScreenshotTimer();
      updateBadge();
      sendResponse({ ok: true });
      return false;
    }

    case 'UPDATE_CONFIG': {
      state.config = { ...state.config, ...(msg.payload || {}) };
      persistState();
      syncPeriodicScreenshotTimer();
      sendResponse({ ok: true, config: state.config });
      return false;
    }

    case 'ADD_MANUAL_TAG': {
      (async () => {
        await refreshActiveTabInfo();
        const now = Date.now();
        const shotId = await captureScreenshotIfAllowed('manual_tag', true);
        await addComputerEvent({
          timestamp: now,
          sessionTimeMs: now - state.sessionStartTime,
          sessionId: state.sessionId,
          eventType: 'manual_tag',
          url: state.activeTabInfo.url,
          domain: state.activeTabInfo.domain,
          pageTitle: state.activeTabInfo.title,
          note: msg.note || 'Tagged moment',
          screenshotId: shotId,
          physio: state.latestPhysio || {},
        });
        sendResponse({ ok: true, screenshotId: shotId });
      })();
      return true;
    }

    case 'CLEAR_SESSION_DATA': {
      (async () => {
        await clearAllSessionData();
        state.sessionId = `session_${Date.now()}`;
        state.sessionStartTime = Date.now();
        state.screenshotCounter = 0;
        state.latestScreenshotId = '';
        persistState();
        sendResponse({ ok: true });
      })();
      return true;
    }

    case 'OPEN_BLE_BRIDGE': {
      (async () => {
        const bridgeUrl = chrome.runtime.getURL('ble-bridge.html');
        const existingTabs = await chrome.tabs.query({ url: `${bridgeUrl}*` });
        if (existingTabs && existingTabs.length > 0) {
          const t = existingTabs[0];
          await chrome.tabs.update(t.id, { active: true });
          if (t.windowId) {
            await chrome.windows.update(t.windowId, { focused: true });
          }
          sendResponse({ ok: true, tabId: t.id });
        } else {
          const targetUrl = msg.autoSimulate ? `${bridgeUrl}?simulate=1` : bridgeUrl;
          const created = await chrome.tabs.create({ url: targetUrl, pinned: true });
          sendResponse({ ok: true, tabId: created.id });
        }
      })();
      return true;
    }
  }
  return false;
});
