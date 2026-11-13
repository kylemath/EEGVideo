# Muse S Athena — Brain, fNIRS & Computer-Use Sync Chrome Extension

An experimental Manifest V3 Chrome Extension that connects directly to the **Muse S Athena (MS-03)** (and Classic Muse headbands) via Web Bluetooth and synchronizes a continuous multi-modal physiological log with agentic-coding-style computer-use telemetry (clicks + DOM selectors, keyboard bursts/WPM/IKI, scroll depth, mouse kinematics, URL/tab transitions, and event-driven + periodic JPEG screenshots).

---

## Quick Start (Zero Build Step Required)

1. Open Google Chrome and navigate to `chrome://extensions`.
2. Toggle **Developer mode** ON (top-right corner).
3. Click **Load unpacked** and select the `/Users/fulkanjou/EEGVideo/chrome-extension` folder.
4. Pin the **Muse S Athena — Brain & Computer-Use Sync Logger** icon in your Chrome toolbar.
5. Click the extension toolbar icon and click **Connect Muse** (or **Simulate** to test immediately without hardware):
   - Clicking **Connect Muse** opens a lightweight, pinned **BLE Bridge** tab (`ble-bridge.html`) that maintains the persistent Web Bluetooth GATT connection across all tabs as you browse.
   - Select your **Muse S Athena** from Chrome's Bluetooth chooser dialog.
6. Click **Start Rec** in the Popup (or BLE Bridge) and use your computer normally.
7. Click **Download Bundle (.tar)** at any time to export the synchronized CSVs, JSONL stream, JPEG screenshots folder, and starter Python correlation script (`analyze_session.py`).

---

## Real-Time Physiological Measures Computed

| Modality | Sensor Source | Exported Columns & Physiological Measures |
|---|---|---|
| **EEG Band Powers** | 4-ch 256 Hz (`TP9, AF7, AF8, TP10`), 2.0s Hanning FFT | Relative (`delta_rel`, `theta_rel`, `alpha_rel`, `beta_rel`, `gamma_rel`) & Absolute ($\mu\text{V}^2$) band powers + session z-scores (`alpha_z`, `focus_z`) |
| **Cognitive & Affective Indices** | 256 Hz EEG | **Focus Index** ($\frac{\beta_{rel}}{\alpha_{rel} + \theta_{rel}}$), **Calm Index** ($\frac{\alpha_{rel}}{\theta_{rel}}$), **Frontal Alpha Asymmetry (FAA)** ($\ln P_{\alpha,\text{AF8}} - \ln P_{\alpha,\text{AF7}}$) |
| **Prefrontal Hemodynamics (fNIRS)** | 64 Hz Dual-Wavelength Optics (730 nm & 850 nm) | **Oxyhemoglobin ($\Delta\text{HbO}_2$, $\mu\text{M}$)**, **Deoxyhemoglobin ($\Delta\text{HHb}$, $\mu\text{M}$)**, and **Total Hemoglobin ($\Delta\text{HbT} = \Delta\text{HbO}_2 + \Delta\text{HbT}_{\text{deoxy}}$, $\mu\text{M}$)** via the Modified Beer-Lambert Law (`hbo2_uM`, `hhb_uM`, `hbt_uM`, plus left/right hemisphere channels) |
| **Cardiovascular (PPG)** | 64 Hz Optical Cardiac Band (0.7–3.5 Hz) | **Heart Rate (`heart_rate_bpm`)**, **Heart Rate Variability (`hrv_rmssd_ms`)**, and `hr_confidence` |
| **Head Motion & Quality** | 52 Hz 6-Axis IMU + EEG StdDev | **Head Angular Velocity (`head_angular_vel_deg_s`)**, **Stillness Score (`stillness_score_pct`)**, per-electrode standard deviation (`sd_tp9_uV`..`sd_tp10_uV`), and automated `state_tags` |

---

## Exported Dataset Bundle Structure

Clicking **Download Bundle (.tar)** exports a single uncompressed `.tar` archive containing:

- `physiology_timeseries.csv` — Continuous 4 Hz (250 ms) physiological state ticks aligned with active URL/domain, recent 10-second click/key/scroll density, and current screenshot ID.
- `computer_use_events.csv` — Every mouse click (with CSS selector path, tag, element text, and coordinates), keyboard burst (WPM, mean inter-key interval, backspace count, and optional key text), scroll event, mouse kinematics window, tab/URL transition, and manual tag, **pre-joined with the instantaneous physiological state vector and screenshot filename**.
- `session_bundle.jsonl` — Unified newline-delimited JSON stream (`physio_tick`, `computer_event`, `screenshot_meta`).
- `raw_eeg_optics.csv` — High-frequency raw 256 Hz EEG and 64 Hz Optical samples (when *Save Raw 256 Hz EEG & 64 Hz Optics Stream* is checked).
- `screenshots/shot_00001.jpg ...` — Event-driven (click, navigation, manual tag) and periodic JPEG screenshots.
- `analyze_session.py` — Starter Python script (`pandas` / `numpy`) to summarize and correlate computer-use moments with physiological states.
