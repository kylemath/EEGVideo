# EEGVideo — EEG-Video Sync with Muse 2

MVP for syncing Muse 2 EEG recording to video playback with precise timing markers.

## Requirements

- Node 18+ (use `nvm use 18` if needed)
- Chrome or Edge (Web Bluetooth)
- Muse 2 headband (2018)
- Serve over **HTTPS or localhost** (Web Bluetooth blocked on `file://`)

## Setup

```bash
cd EEGVideo
npm install
npm run dev
```

Open http://localhost:5173

## Usage

1. **Record tab**
   - Connect Muse (Connect Muse button)
   - Check signal quality on the head diagram
   - Load a video URL (e.g. `/sample.mp4` if you add one to `public/`)
   - Switch to Record mode, then Start to record EEG + video markers
   - Stop to download EEG CSV and markers CSV

2. **Video Tagging tab**
   - Load a video
   - Use 0.5x, 1x, 2x speeds; step frame-by-frame
   - Add manual markers; run scene detection
   - Export markers, then Import to Record to include in recordings

## File formats

- **EEG data**: `uncorrected_time,corrected_time,TP9,AF7,AF8,TP10`
- **Markers**: `type,media_time,performance_time,description`

## Muse connection

Subscribe to `eegReadings` **before** `start()` to avoid missing samples. PPG is disabled for Muse 2 compatibility.

**Telemetry UUID error (273e000b):** If you see "No Characteristics matching UUID 273e000b", the app automatically falls back to a minimal connection (Control + EEG only). You can also try connecting the headset to the official Muse app by Interaxon first, then disconnecting and retrying—this sometimes initializes the device.
