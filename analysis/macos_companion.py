#!/usr/bin/env python3
"""
macOS Whole-Computer Telemetry Companion for Muse S Athena Chrome Extension
===========================================================================
Tracks OS-wide computer activity across ALL macOS applications (Antigravity IDE,
Finder, Music, Terminal, Preview, Chrome, etc.) without requiring invasive
accessibility keyloggers, and serves a real-time JSON stream on http://127.0.0.1:8765
for automatic synchronization with the Muse S Athena physiological stream.

Captures at 4 Hz (250 ms):
  1. Active macOS Application Name & Bundle ID (`lsappinfo front`)
  2. OS-wide Hardware Event Counters via macOS CoreGraphics (`ctypes`):
     - Left & Right Mouse Clicks (with global cursor X, Y coordinates)
     - Keyboard Keydown Cadence & WPM bursts across any IDE/app
     - Scroll Wheel bursts
     - Global Mouse Cursor Kinematics (distance px & velocity px/s)
     - System HID Idle Time (seconds since last input)
  3. Apple Music / Spotify Now-Playing Telemetry (`track`, `artist`, `album`, `playing`)
  4. Discrete OS Events queue (`app_switch`, `os_click`, `os_key_burst`, `os_scroll`, `music_change`)

Usage:
  python3 /Users/fulkanjou/EEGVideo/analysis/macos_companion.py
"""

from __future__ import annotations

import ctypes
import json
import math
import re
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Dict, List, Optional

# Load macOS CoreGraphics / ApplicationServices for zero-permission hardware event counters
cg = ctypes.cdll.LoadLibrary(
    "/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices"
)


class CGPoint(ctypes.Structure):
    _fields_ = [("x", ctypes.c_double), ("y", ctypes.c_double)]


cg.CGEventSourceCounterForEventType.argtypes = [ctypes.c_int32, ctypes.c_uint32]
cg.CGEventSourceCounterForEventType.restype = ctypes.c_uint32

cg.CGEventSourceSecondsSinceLastEventType.argtypes = [ctypes.c_int32, ctypes.c_uint32]
cg.CGEventSourceSecondsSinceLastEventType.restype = ctypes.c_double

cg.CGEventCreate.argtypes = [ctypes.c_void_p]
cg.CGEventCreate.restype = ctypes.c_void_p

cg.CGEventGetLocation.argtypes = [ctypes.c_void_p]
cg.CGEventGetLocation.restype = CGPoint

cg.CFRelease.argtypes = [ctypes.c_void_p]

# CoreGraphics Event Type Constants
K_CG_LEFT_MOUSE_DOWN = 1
K_CG_RIGHT_MOUSE_DOWN = 3
K_CG_MOUSE_MOVED = 5
K_CG_KEY_DOWN = 10
K_CG_SCROLL_WHEEL = 22
K_CG_ANY_INPUT = 0xFFFFFFFF


def get_cursor_position() -> Tuple[int, int]:
    ev = cg.CGEventCreate(None)
    if not ev:
        return (0, 0)
    pt = cg.CGEventGetLocation(ev)
    cg.CFRelease(ev)
    return (int(round(pt.x)), int(round(pt.y)))


def get_frontmost_app() -> Dict[str, object]:
    """
    Use `lsappinfo metainfo` to read `bringForwardOrder`, which lists the true Z-order
    of visible user applications (e.g., Antigravity, Antigravity IDE, KyTunes, Finder,
    Google Chrome, Claude) without being occluded by UserNotificationCenter.
    """
    try:
        meta = subprocess.check_output(
            ["lsappinfo", "metainfo"], stderr=subprocess.DEVNULL, timeout=0.4
        ).decode("utf-8", errors="ignore")
        m_line = re.search(r"bringForwardOrder\s*=\s*(.+)", meta)
        if m_line:
            pairs = re.findall(r'"([^"]+)"\s+(ASN:0x[0-9a-fA-F]+-0x[0-9a-fA-F]+:)', m_line.group(1))
            for app_name, asn in pairs:
                if app_name not in ("UserNotificationCenter", "ControlCenter", "WindowServer"):
                    info = subprocess.check_output(
                        ["lsappinfo", "info", "-only", "bundleid", asn],
                        stderr=subprocess.DEVNULL,
                        timeout=0.4,
                    ).decode("utf-8", errors="ignore")
                    bm = re.search(r'"CFBundleIdentifier"\s*=\s*"([^"]+)"', info)
                    bundle_id = bm.group(1) if bm else app_name
                    visible_stack = [p[0] for p in pairs[:6]]
                    return {
                        "appName": app_name,
                        "bundleId": bundle_id,
                        "visibleStack": visible_stack,
                    }
    except Exception:
        pass
    return {"appName": "macOS", "bundleId": "", "visibleStack": []}


def get_now_playing_music() -> Dict[str, str]:
    """
    Check if Apple Music (or Spotify) is currently playing a track without launching it.
    """
    script = """
    if application "Music" is running then
      tell application "Music"
        if player state is playing then
          return "PLAYING||" & (name of current track) & "||" & (artist of current track) & "||" & (album of current track)
        else
          return "PAUSED||||||"
        end if
      end tell
    end if
    return "STOPPED||||||"
    """
    try:
        out = (
            subprocess.check_output(
                ["osascript", "-e", script], stderr=subprocess.DEVNULL, timeout=0.6
            )
            .decode("utf-8", errors="ignore")
            .strip()
        )
        parts = out.split("||")
        if len(parts) >= 4:
            return {
                "state": parts[0].lower(),
                "track": parts[1],
                "artist": parts[2],
                "album": parts[3],
            }
    except Exception:
        pass
    return {"state": "stopped", "track": "", "artist": "", "album": ""}


class MacOSTelemetryState:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.current_app = {"appName": "Unknown", "bundleId": ""}
        self.music = {"state": "stopped", "track": "", "artist": "", "album": ""}
        self.cursor_x = 0
        self.cursor_y = 0
        self.idle_seconds = 0.0

        # Hardware counters
        self.last_left_click = cg.CGEventSourceCounterForEventType(0, K_CG_LEFT_MOUSE_DOWN)
        self.last_right_click = cg.CGEventSourceCounterForEventType(0, K_CG_RIGHT_MOUSE_DOWN)
        self.last_key_down = cg.CGEventSourceCounterForEventType(0, K_CG_KEY_DOWN)
        self.last_scroll = cg.CGEventSourceCounterForEventType(0, K_CG_SCROLL_WHEEL)

        # Rolling 10-second OS-wide totals
        self.recent_os_samples: List[Dict[str, float]] = []

        # Key burst tracker for non-browser apps (Antigravity IDE, Finder, Terminal, etc.)
        self.key_burst_count = 0
        self.key_burst_start = 0.0
        self.key_burst_last = 0.0
        self.key_burst_app = ""

        # Scroll burst tracker for non-browser apps
        self.scroll_burst_count = 0
        self.scroll_burst_last = 0.0
        self.scroll_burst_app = ""

        # Mouse distance tracker
        self.mouse_dist_accum = 0.0
        self.mouse_window_start = time.time()

        # Outgoing discrete OS events queue (drained by BLE Bridge / Background worker)
        self.pending_events: List[Dict[str, object]] = []
        self.last_music_Polling = 0.0

    def is_chrome_frontmost(self) -> bool:
        b = (self.current_app.get("bundleId") or "").lower()
        n = (self.current_app.get("appName") or "").lower()
        return "chrome" in b or "chrome" in n

    def poll_once(self) -> None:
        now = time.time()
        now_ms = int(now * 1000)

        app = get_frontmost_app()
        cx, cy = get_cursor_position()

        left_c = cg.CGEventSourceCounterForEventType(0, K_CG_LEFT_MOUSE_DOWN)
        right_c = cg.CGEventSourceCounterForEventType(0, K_CG_RIGHT_MOUSE_DOWN)
        key_c = cg.CGEventSourceCounterForEventType(0, K_CG_KEY_DOWN)
        scroll_c = cg.CGEventSourceCounterForEventType(0, K_CG_SCROLL_WHEEL)

        d_left = max(0, int(left_c - self.last_left_click))
        d_right = max(0, int(right_c - self.last_right_click))
        d_clicks = d_left + d_right
        d_keys = max(0, int(key_c - self.last_key_down))
        d_scroll = max(0, int(scroll_c - self.last_scroll))

        self.last_left_click = left_c
        self.last_right_click = right_c
        self.last_key_down = key_c
        self.last_scroll = scroll_c

        step_dist = math.hypot(cx - self.cursor_x, cy - self.cursor_y) if self.cursor_x != 0 else 0.0
        self.cursor_x = cx
        self.cursor_y = cy

        # Idle time across key/mouse events
        idle_s = min(
            cg.CGEventSourceSecondsSinceLastEventType(0, K_CG_LEFT_MOUSE_DOWN),
            cg.CGEventSourceSecondsSinceLastEventType(0, K_CG_KEY_DOWN),
            cg.CGEventSourceSecondsSinceLastEventType(0, K_CG_MOUSE_MOVED),
            cg.CGEventSourceSecondsSinceLastEventType(0, K_CG_SCROLL_WHEEL),
        )

        # Poll Apple Music every 2.5s
        if now - self.last_music_Polling >= 2.5:
            self.last_music_Polling = now
            new_music = get_now_playing_music()
            with self.lock:
                if (
                    new_music["state"] == "playing"
                    and new_music["track"]
                    and new_music["track"] != self.music.get("track")
                ):
                    self.pending_events.append({
                        "timestamp": now_ms,
                        "eventType": "music_change",
                        "domain": "app://Music",
                        "url": f"music://{new_music['artist']}/{new_music['track']}",
                        "pageTitle": f"🎵 {new_music['track']} — {new_music['artist']}",
                        "note": f"Playing: {new_music['track']} by {new_music['artist']} ({new_music['album']})",
                    })
                self.music = new_music

        with self.lock:
            self.idle_seconds = round(float(idle_s), 2)

            # 1. Detect macOS Application Switch
            prev_app = self.current_app.get("appName")
            self.current_app = app
            curr_app_name = app.get("appName") or "macOS"
            if prev_app and prev_app != "Unknown" and curr_app_name != prev_app:
                self.pending_events.append({
                    "timestamp": now_ms,
                    "eventType": "app_switch",
                    "domain": f"app://{curr_app_name}",
                    "url": f"macos://{app.get('bundleId') or curr_app_name}",
                    "pageTitle": f"{curr_app_name} (from {prev_app})",
                    "requestScreenshot": True,
                })

            # 2. Record OS-wide rolling 10s sample
            self.recent_os_samples.append({
                "t": now,
                "clicks": d_clicks,
                "keys": d_keys,
                "scroll": d_scroll,
                "dist": step_dist,
            })
            cutoff = now - 10.0
            while self.recent_os_samples and self.recent_os_samples[0]["t"] < cutoff:
                self.recent_os_samples.pop(0)

            # 3. Emit non-Chrome OS events (when user is in Antigravity IDE, Finder, Music, etc.)
            if not self.is_chrome_frontmost():
                if d_clicks > 0:
                    self.pending_events.append({
                        "timestamp": now_ms,
                        "eventType": "click",
                        "domain": f"app://{curr_app_name}",
                        "url": f"macos://{app.get('bundleId') or curr_app_name}",
                        "pageTitle": curr_app_name,
                        "x": cx,
                        "y": cy,
                        "tagName": "macos_window",
                        "selector": f"{curr_app_name} ({app.get('bundleId')})",
                        "elementText": f"OS Click ({d_clicks}) in {curr_app_name}",
                        "requestScreenshot": True,
                    })

                if d_keys > 0:
                    if self.key_burst_count == 0:
                        self.key_burst_start = now
                        self.key_burst_app = curr_app_name
                    self.key_burst_count += d_keys
                    self.key_burst_last = now

                if self.key_burst_count > 0 and (
                    now - self.key_burst_last >= 1.5 or self.key_burst_count >= 35
                ):
                    dur_s = max(0.35, self.key_burst_last - self.key_burst_start)
                    wpm = round(((self.key_burst_count / 5.0) * 60.0) / dur_s, 1)
                    iki_ms = int(round((dur_s * 1000.0) / max(1, self.key_burst_count)))
                    self.pending_events.append({
                        "timestamp": now_ms,
                        "eventType": "key_burst",
                        "domain": f"app://{self.key_burst_app}",
                        "url": f"macos://{self.key_burst_app}",
                        "pageTitle": self.key_burst_app,
                        "keyCount": self.key_burst_count,
                        "wpm": wpm,
                        "ikiMs": iki_ms,
                        "rawKeyText": "[os-cadence-only]",
                        "selector": f"app://{self.key_burst_app}",
                        "tagName": "macos_app",
                    })
                    self.key_burst_count = 0

                if d_scroll > 0:
                    self.scroll_burst_count += d_scroll
                    self.scroll_burst_last = now
                    self.scroll_burst_app = curr_app_name

                if self.scroll_burst_count >= 5 and (now - self.scroll_burst_last >= 0.8):
                    self.pending_events.append({
                        "timestamp": now_ms,
                        "eventType": "scroll",
                        "domain": f"app://{self.scroll_burst_app}",
                        "url": f"macos://{self.scroll_burst_app}",
                        "pageTitle": self.scroll_burst_app,
                        "scrollDeltaY": self.scroll_burst_count * 12,
                    })
                    self.scroll_burst_count = 0

            # Trim queue if not yet drained
            if len(self.pending_events) > 250:
                self.pending_events = self.pending_events[-250:]

    def get_snapshot_and_drain_events(self) -> Dict[str, object]:
        with self.lock:
            events = list(self.pending_events)
            self.pending_events.clear()
            clicks_10s = sum(s["clicks"] for s in self.recent_os_samples)
            keys_10s = sum(s["keys"] for s in self.recent_os_samples)
            scroll_10s = sum(s["scroll"] for s in self.recent_os_samples)
            dist_10s = round(sum(s["dist"] for s in self.recent_os_samples), 1)
            return {
                "ok": True,
                "timestamp": int(time.time() * 1000),
                "frontApp": self.current_app,
                "isChromeFrontmost": self.is_chrome_frontmost(),
                "cursor": {"x": self.cursor_x, "y": self.cursor_y},
                "idleSeconds": self.idle_seconds,
                "osCounts10s": {
                    "clicks": int(clicks_10s),
                    "keys": int(keys_10s),
                    "scrolls": int(scroll_10s),
                    "mouseDistPx": dist_10s,
                },
                "music": self.music,
                "events": events,
            }


STATE = MacOSTelemetryState()


def polling_loop() -> None:
    while True:
        try:
            STATE.poll_once()
        except Exception:
            pass
        time.sleep(0.25)


class CompanionHandler(BaseHTTPRequestHandler):
    def log_message(self, format: str, *args: object) -> None:
        return  # Keep terminal quiet

    def _send_json(self, data: Dict[str, object], status: int = 200) -> None:
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:
        self._send_json({"ok": True})

    def do_GET(self) -> None:
        if self.path.startswith("/poll") or self.path.startswith("/status"):
            self._send_json(STATE.get_snapshot_and_drain_events())
        else:
            self._send_json({"ok": True, "service": "Muse S Athena macOS Companion"})


def main() -> None:
    t = threading.Thread(target=polling_loop, daemon=True)
    t.start()
    host = "127.0.0.1"
    port = 8765
    server = HTTPServer((host, port), CompanionHandler)
    print(f"[macOS Companion] Running OS-wide telemetry bridge on http://{host}:{port}/poll")
    print("  - Tracking frontmost macOS app (Antigravity IDE, Finder, Music, Chrome, etc.)")
    print("  - Tracking OS-wide CoreGraphics clicks, typing cadence/WPM, scrolls & cursor velocity")
    print("  - Tracking Apple Music now-playing track & artist")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[macOS Companion] Stopped.")


if __name__ == "__main__":
    main()
