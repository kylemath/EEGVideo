/**
 * Content Script — Computer-Use Telemetry Collector
 *
 * Captures mouse clicks (with DOM target selector & metadata), keyboard bursts
 * (WPM, inter-key interval, backspace ratio, and optional key text), scroll depth/velocity,
 * and mouse kinematics, forwarding them to the background service worker for synchronization
 * with the continuous Muse S Athena physiological stream and screenshot capture.
 */
(() => {
  if (window.__museAthenaContentScriptInstalled) return;
  window.__museAthenaContentScriptInstalled = true;

  function isSensitiveInput(el) {
    if (!el || !el.tagName) return false;
    const type = (el.getAttribute?.('type') || '').toLowerCase();
    const auto = (el.getAttribute?.('autocomplete') || '').toLowerCase();
    const name = (el.getAttribute?.('name') || '').toLowerCase();
    return (
      type === 'password' ||
      auto.includes('password') ||
      auto.includes('cc-') ||
      name.includes('password') ||
      name.includes('cvv')
    );
  }

  function buildSelectorPath(el) {
    if (!el || el.nodeType !== 1) return '';
    const parts = [];
    let curr = el;
    let depth = 0;
    while (curr && curr.nodeType === 1 && depth < 4) {
      let part = curr.tagName.toLowerCase();
      if (curr.id) {
        part += `#${curr.id.slice(0, 32)}`;
        parts.unshift(part);
        break;
      }
      if (curr.className && typeof curr.className === 'string') {
        const cls = curr.className
          .trim()
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 2)
          .join('.');
        if (cls) part += `.${cls.slice(0, 40)}`;
      }
      parts.unshift(part);
      curr = curr.parentElement;
      depth += 1;
    }
    return parts.join(' > ');
  }

  function getElementTextPreview(el) {
    if (!el || isSensitiveInput(el)) return '';
    const aria = el.getAttribute?.('aria-label') || el.getAttribute?.('title') || '';
    if (aria) return aria.trim().slice(0, 80);
    const text = (el.innerText || el.textContent || el.value || '').trim().replace(/\s+/g, ' ');
    return text.slice(0, 80);
  }

  function sendInteractionEvent(payload) {
    try {
      chrome.runtime.sendMessage({
        type: 'COMPUTER_USE_EVENT',
        payload: {
          timestamp: Date.now(),
          url: window.location.href,
          domain: window.location.hostname || 'local',
          pageTitle: document.title || '',
          ...payload,
        },
      });
    } catch {
      // Extension context invalidated or background waking up
    }
  }

  // 1. Mouse Click Listener
  window.addEventListener(
    'mousedown',
    (ev) => {
      const target = ev.target;
      const vw = Math.max(1, window.innerWidth || 1);
      const vh = Math.max(1, window.innerHeight || 1);
      sendInteractionEvent({
        eventType: 'click',
        x: Math.round(ev.clientX),
        y: Math.round(ev.clientY),
        normX: Number((ev.clientX / vw).toFixed(4)),
        normY: Number((ev.clientY / vh).toFixed(4)),
        button: ev.button,
        tagName: target?.tagName?.toLowerCase() || '',
        selector: buildSelectorPath(target),
        elementText: getElementTextPreview(target),
        requestScreenshot: true,
      });
    },
    { capture: true, passive: true }
  );

  // 2. Keyboard Burst & Cadence Listener
  let keyBurst = {
    startTime: 0,
    lastKeyTime: 0,
    keyCount: 0,
    backspaceCount: 0,
    ikis: [],
    chars: [],
    selector: '',
    tagName: '',
    sensitive: false,
  };
  let keyFlushTimer = null;

  function flushKeyBurst() {
    if (keyBurst.keyCount === 0) return;
    const durationMs = Math.max(250, keyBurst.lastKeyTime - keyBurst.startTime);
    const wpm = Number((((keyBurst.keyCount / 5) * 60000) / durationMs).toFixed(1));
    const meanIki =
      keyBurst.ikis.length > 0
        ? Math.round(keyBurst.ikis.reduce((a, b) => a + b, 0) / keyBurst.ikis.length)
        : 0;

    sendInteractionEvent({
      eventType: 'key_burst',
      keyCount: keyBurst.keyCount,
      backspaceCount: keyBurst.backspaceCount,
      wpm,
      ikiMs: meanIki,
      rawKeyText: keyBurst.sensitive ? '[masked-sensitive]' : keyBurst.chars.join(''),
      selector: keyBurst.selector,
      tagName: keyBurst.tagName,
    });

    keyBurst = {
      startTime: 0,
      lastKeyTime: 0,
      keyCount: 0,
      backspaceCount: 0,
      ikis: [],
      chars: [],
      selector: '',
      tagName: '',
      sensitive: false,
    };
  }

  window.addEventListener(
    'keydown',
    (ev) => {
      const now = Date.now();
      const target = ev.target;
      const sensitive = isSensitiveInput(target);

      if (keyBurst.keyCount === 0) {
        keyBurst.startTime = now;
        keyBurst.selector = buildSelectorPath(target);
        keyBurst.tagName = target?.tagName?.toLowerCase() || '';
        keyBurst.sensitive = sensitive;
      } else {
        const iki = now - keyBurst.lastKeyTime;
        if (iki > 0 && iki < 3000) {
          keyBurst.ikis.push(iki);
        }
        if (sensitive) keyBurst.sensitive = true;
      }

      keyBurst.lastKeyTime = now;
      keyBurst.keyCount += 1;
      if (ev.key === 'Backspace' || ev.key === 'Delete') {
        keyBurst.backspaceCount += 1;
      }

      if (!keyBurst.sensitive && keyBurst.chars.length < 120) {
        if (ev.key.length === 1) {
          keyBurst.chars.push(ev.key);
        } else if (ev.key === 'Enter') {
          keyBurst.chars.push('⏎');
        } else if (ev.key === 'Backspace') {
          keyBurst.chars.push('⌫');
        }
      }

      if (keyFlushTimer) clearTimeout(keyFlushTimer);
      if (keyBurst.keyCount >= 30 || ev.key === 'Enter') {
        flushKeyBurst();
      } else {
        keyFlushTimer = setTimeout(flushKeyBurst, 1500);
      }
    },
    { capture: true, passive: true }
  );

  // 3. Scroll Depth & Velocity Listener
  let scrollAccumDeltaY = 0;
  let lastScrollY = window.scrollY || 0;
  let scrollFlushTimer = null;

  window.addEventListener(
    'scroll',
    () => {
      const currentY = window.scrollY || 0;
      scrollAccumDeltaY += currentY - lastScrollY;
      lastScrollY = currentY;

      if (!scrollFlushTimer) {
        scrollFlushTimer = setTimeout(() => {
          scrollFlushTimer = null;
          const docHeight = Math.max(
            document.documentElement?.scrollHeight || 1,
            document.body?.scrollHeight || 1
          );
          const viewHeight = window.innerHeight || 1;
          const maxScroll = Math.max(1, docHeight - viewHeight);
          const depthPct = Number(Math.min(100, Math.max(0, (currentY / maxScroll) * 100)).toFixed(1));

          if (Math.abs(scrollAccumDeltaY) >= 15) {
            sendInteractionEvent({
              eventType: 'scroll',
              scrollDeltaY: Math.round(scrollAccumDeltaY),
              scrollDepthPct: depthPct,
            });
          }
          scrollAccumDeltaY = 0;
        }, 800);
      }
    },
    { capture: true, passive: true }
  );

  // 4. Mouse Kinematics (Distance & Velocity summarized every 2 seconds while moving)
  let lastMouseX = null;
  let lastMouseY = null;
  let mouseDistAccum = 0;
  let mouseWindowStart = 0;
  let mouseFlushTimer = null;

  window.addEventListener(
    'mousemove',
    (ev) => {
      const now = Date.now();
      if (lastMouseX !== null && lastMouseY !== null) {
        const dx = ev.clientX - lastMouseX;
        const dy = ev.clientY - lastMouseY;
        mouseDistAccum += Math.sqrt(dx * dx + dy * dy);
      } else {
        mouseWindowStart = now;
      }
      lastMouseX = ev.clientX;
      lastMouseY = ev.clientY;

      if (!mouseFlushTimer) {
        mouseFlushTimer = setTimeout(() => {
          mouseFlushTimer = null;
          const elapsedS = Math.max(0.2, (Date.now() - mouseWindowStart) / 1000);
          if (mouseDistAccum >= 60) {
            sendInteractionEvent({
              eventType: 'mouse_kinematics',
              x: Math.round(lastMouseX || 0),
              y: Math.round(lastMouseY || 0),
              mouseDistancePx: Math.round(mouseDistAccum),
              mouseVelocityPxS: Math.round(mouseDistAccum / elapsedS),
            });
          }
          mouseDistAccum = 0;
          lastMouseX = null;
          lastMouseY = null;
        }, 2000);
      }
    },
    { capture: true, passive: true }
  );
})();
