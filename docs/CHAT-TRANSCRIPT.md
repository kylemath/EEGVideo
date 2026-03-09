# EEGVideo — Chat Transcript

Summary of the development session for the EEGVideo MVP.

---

## 1. Initial Request

**User:** Create a fresh EEGVideo folder with an MVP that includes:
- .mp4 video playback in browser
- Muse connection button
- Live data stream for checking data before starting video
- Signal quality visualization at each channel on the head (like kylemath/eegedu)
- Video timing: button press, first frame, audio start accounted for
- EEG recorded before and during video, with markers (video start, every Nth frame, Nth audio sample)
- Secondary tab: video at different speeds, frame-by-frame, timing markers, scene changes
- Two modes: Play (live stream) and Record (buffer + save)
- Data files with headers, uncorrected/corrected times, incremental crash-resistant save
- React + RxJS pipes, minimal UX
- Multi-agent execution

---

## 2. Plan Created

A detailed plan was created covering:
- Project structure (Vite + React)
- Muse connection (subscribe before start)
- Signal quality (head diagram, std dev)
- Video timing (requestVideoFrameCallback)
- Data/marker file formats
- RxJS pipe architecture

---

## 3. Implementation

### M1: Foundation
- Created EEGVideo/ with package.json, vite.config.js, index.html
- config/constants.js
- streams/museStream.js, eegPipes.js, recordingStream.js
- App.jsx, main.jsx, index.css, App.css

### M2: Visualization
- MuseConnect.jsx
- SignalQualityHead.jsx (SVG head, TP9/AF7/AF8/TP10)
- LiveEEGChart.jsx
- RecordControls.jsx

### M3: Video & Recording
- VideoPlayer.jsx (requestVideoFrameCallback, markers)
- utils/videoTiming.js, dataFormat.js
- Recording with EEG + marker file download

### M4: Tagging Tab
- VideoTaggingTab.jsx (speeds, frame-step, scene detection, export/import)

---

## 4. PWA/Workbox Errors (Different Project)

**User:** Reported 404 for main.tsx, manifest.webmanifest syntax error, pwa-entry-point.

**Response:** Those errors are from a different project (PWA with Workbox, p5.js). EEGVideo uses main.jsx and has no manifest. Suggested clearing service worker cache and hard refresh.

---

## 5. Muse Telemetry UUID Error

**User:** `No Characteristics matching UUID 273e000b-4c4d-454d-96be-f03bac821358 found in Service with UUID 0000fe8d-0000-1000-8000-00805f9b34fb`

**Cause:** Some Muse devices/firmware don't expose the telemetry characteristic. muse-js requires it and fails.

**Fix implemented:**
- Created `museMinimal.js` — minimal client connecting only to Control + 4 EEG characteristics
- Updated `museStream.js` to try muse-js first, then fall back to minimal client on telemetry UUID error
- Minimal client uses same EEG decoding, same `eegReadings` and `start()` API

**Additional tip:** Connect headset to official Muse app by Interaxon first, then retry.

---

## 6. Project Move

**User:** Moved EEGVideo to ../EEGVideo. Requested to save the plan file and chat transcript there.

**Action:** Created EEGVideo-MVP-Plan.md and CHAT-TRANSCRIPT.md in /Users/kylemathewson/EEGVideo/

---

## Key Technical Decisions

- **muse-js zipSamples** for per-sample format (compatible with both full and minimal client)
- **eegWithQuality()** — custom pipe using std dev over 64-sample batches (eeg-pipes format didn't match muse-js)
- **requestVideoFrameCallback** for frame-accurate timing (with timeupdate fallback)
- **Node 18+** required (see .nvmrc)
- **Minimal Muse client** for devices missing telemetry characteristic
