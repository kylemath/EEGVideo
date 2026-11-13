# Whitesides Paper Blueprint & 30-Day Deep $N=1$ Experimental Plan

> **Methodology:** George M. Whitesides' *"Writing a Paper"* (*Adv. Mater.* **2004**, *16*, 1375–1377) — Outline-first, Figure-storyboard-driven experimental design.
> **Companion Skills:** `whitesides-paper-architect`, `clean-scientific-figures`, `mathewson-academic-writing`

---

## 1. Working Titles & Target Venues

- **Title Option A (Neuroscience & Physiology Focus):** *Continuous Multimodal Neuroimaging of Naturalistic Computer Use: A 30-Day Deep $N=1$ Study of Prefrontal Hemodynamics, EEG Spectral Dynamics, and Autonomic State*
- **Title Option B (Methods & Human-Computer Interaction Focus):** *Synchronizing Wearable EEG, Prefrontal fNIRS, and Cardiac Autonomics with Fine-Grained Computer Interaction: An Intensive Longitudinal $N=1$ Study*
- **Title Option C (Cognitive & Affective Dynamics Focus):** *From Sympathetic Alarm to Executive Flow: Mapping the Brain and Body Across One Month of Real-World Digital Work*
- **Primary Target Journals:** *Psychophysiology*, *Behavior Research Methods*, *NeuroImage*, or *Nature Human Behaviour*

---

## 2. Central Thesis & Core Contributions

1. **The Bottleneck:** Human cognitive and affective neuroscience has historically been split between tightly controlled, ecologically artificial laboratory tasks and coarse ambulatory wearables that lack millisecond-level ground-truth context about what the user is actually seeing, clicking, reading, or typing.
2. **The Instrument & Paradigm:** We developed a zero-dependency browser-native synchronization architecture that pairs the multiplexed **Muse S Athena (MS-03)** headband (256 Hz 4-channel EEG, 64 Hz dual-wavelength 730/850 nm prefrontal fNIRS, 64 Hz cardiac PPG, and 52 Hz 6-axis IMU) directly with agentic-style computer-use telemetry (DOM element selectors, mouse kinematics, typing cadence/error bursts, tab switches, and event-triggered + periodic visual screenshots) across a 30-day intensive longitudinal $N=1$ study.
3. **The Empirical Discovery:** Even in its inaugural 14.1-minute capture (`session_2026-11-07T22-51-34`), the system resolved a textbook two-stage neurophysiological transition from acute sympathetic alarm ($65.1 \rightarrow 132.4\text{ BPM}$ upon opening an unexpected threatening email) into parasympathetically regulated executive investigation ($66.8–71.1\text{ BPM}$, $+16.73\ \mu\text{M}$ prefrontal $\Delta\text{HbO}_2$, and a $2.8\times$ surge in relative EEG Beta power across scientific and investigative domains). Scaling this protocol across 30 days establishes a high-density within-subject atlas of naturalistic digital cognition.

---

## 3. Hierarchical Manuscript Outline (Whitesides Structure)

### Abstract (5-Sentence Blueprint)
- **S1 (Context):** Naturalistic computer work engages rapid shifts between resting triage, acute affective arousal, and sustained executive focus, yet capturing the coupled neural, hemodynamic, and autonomic substrates of these states outside the laboratory remains a major methodological challenge.
- **S2 (Gap):** Existing wearable studies rarely synchronize continuous prefrontal hemodynamics (fNIRS), electroencephalography (EEG), and heart rate variability (PPG) with fine-grained, DOM-level human–computer interaction logs and visual screen context.
- **S3 (Approach):** Here we introduce a browser-native Web Bluetooth acquisition and analysis suite for the Muse S Athena headband and deploy it in a 30-day deep-phenotyping $N=1$ study comprising $K$ hours of synchronized 256 Hz EEG, 64 Hz 730/850 nm Modified Beer-Lambert Law fNIRS ($\Delta\text{HbO}_2, \Delta\text{HHb}, \Delta\text{HbT}$), cardiac PPG, head stillness, and continuous interaction/screenshot telemetry.
- **S4 (Results):** Across naturalistic work domains and targeted experimental blocks, we demonstrate: (1) distinct joint brain–body signatures separating scientific reading and coding from email triage and social media; (2) millisecond-resolved peri-action trajectories around mouse clicks, page navigations, and typing bursts; and (3) a striking autonomic-to-prefrontal hand-off during real-world threat appraisal where acute sympathetic tachycardia ($132.4\text{ BPM}$) transitions into attentional bradycardia ($66.8–71.1\text{ BPM}$) and sustained prefrontal oxygenation ($+16.7\ \mu\text{M}$ $\Delta\text{HbO}_2$).
- **S5 (Impact):** These findings establish intensive longitudinal $N=1$ neuro-behavioral logging as a powerful paradigm for ecological cognitive neuroscience and physiologically aware computing.

### Section 1: Introduction
- **1.1 From Group Snapshots to Deep $N=1$ Naturalistic Neuroscience:** Contrast brief, cross-sectional laboratory ERP/fNIRS paradigms against dense single-subject longitudinal phenotyping (*MyConnectome*, *Midnight Scan Club*).
- **1.2 The Missing Link — Fine-Grained Digital Telemetry:** Why physiological streams without micro-behavioral context (URL/domain, DOM target, typing speed/backspaces, scroll velocity, and visual screenshots) cannot disambiguate cognitive load from motor or affective confounds.
- **1.3 Multimodal Forehead Sensing on the Muse S Athena:** How combining 256 Hz dry EEG (`AF7`, `AF8`, `TP9`, `TP10`), 64 Hz dual-wavelength NIR spectroscopy (730 nm & 850 nm for $\Delta\text{HbO}_2 / \Delta\text{HHb} / \Delta\text{HbT}$ and cardiac PPG), and 52 Hz IMU in a single lightweight headband enables simultaneous electrical, metabolic, cardiovascular, and motor tracking.
- **1.4 Study Overview ("Here we..."):** Present our open-source Chrome Manifest V3 logger, automated signal-processing and figure pipeline, and the 30-day $N=1$ experimental matrix.

### Section 2: Methods & System Architecture
- **2.1 Hardware & Multiplexed BLE Protocol (`273e0013`):** 14-bit LSB-first EEG unpacking (`256 Hz`), 20-bit optical unpacking (`64 Hz`, preset `p1035`/`p1033`), and 16-bit IMU (`52 Hz`).
- **2.2 Real-Time Physiological Signal Processing Engine:**
  - *EEG Spectral Estimation & Automated Contact Gating:* 512-point Hanning FFT, relative band powers ($\delta, \theta, \alpha, \beta, \gamma$), Focus Index ($\beta / [\alpha + \theta]$), Calm Index ($\alpha / \theta$), Frontal Alpha Asymmetry ($\ln P_{\alpha,\text{AF8}} - \ln P_{\alpha,\text{AF7}}$), and forehead vs. temporal SD gating.
  - *Modified Beer-Lambert Law (MBLL) Prefrontal Hemodynamics:* Low-pass hemodynamic separation ($< 0.4\text{ Hz}$), optical density $\Delta\text{OD}(\lambda) = -\ln(I(\lambda)/I_0(\lambda))$, and $2\times 2$ extinction inversion at 730 nm and 850 nm for left, right, and bilateral $\Delta\text{HbO}_2$, $\Delta\text{HHb}$, and $\Delta\text{HbT}$ ($\mu\text{M}$).
  - *Cardiac PPG & IMU Extraction:* Bandpass cardiac filtering ($0.7–3.5\text{ Hz}$), adaptive systolic peak detection, median IBI Heart Rate (BPM), RMSSD Heart Rate Variability (ms), and RMS head angular velocity stillness score ($0–100\%$).
- **2.3 Computer-Use Telemetry & Visual Screenshot Synchronization:** DOM selector path extraction, privacy-preserving typing cadence/WPM/IKI/backspace burst logging, scroll depth, mouse kinematics, and event-triggered + periodic JPEG screenshots stored in IndexedDB and exported as POSIX `.tar` bundles.
- **2.4 30-Day Intensive Longitudinal $N=1$ Protocol:** Daily naturalistic work logging combined with four structured within-subject experimental manipulations.

### Section 3: Results (Organized Around the 8-Figure Storyboard)
- **3.1 Validation of Multimodal Signal Quality and Forehead Contact Stability (Figure 1):** Characterization of `AF7`/`AF8` vs. `TP9`/`TP10` amplitude SD, optical PPG SNR, and synchronization precision across sessions.
- **3.2 Taxonomic Mapping of Digital Work Domains in Brain–Body State Space (Figure 2):** Omnibus and pairwise contrasts across Scientific Literature, Agentic Coding, Writing, Search, Email Triage, and Social Media.
- **3.3 Event-Locked Peri-Action Neural and Hemodynamic Trajectories (Figure 3):** Time-locked $[-10\text{ s}, +15\text{ s}]$ dynamics surrounding mouse clicks, page navigations, and scroll bursts, plus the 10-variable cross-modal Spearman coupling matrix.
- **3.4 Autonomic-to-Prefrontal Hand-Off During Real-World Threat and Investigative Problem Solving (Figure 4):** Detailed analysis of the four-phase acute email shock ($132.4\text{ BPM}$) $\rightarrow$ appraisal $\rightarrow$ multi-site executive investigation ($+16.73\ \mu\text{M}$ $\Delta\text{HbO}_2$, $22.2\%$ Beta, $71.1\text{ BPM}$ attentional bradycardia) and replication across high-arousal events.
- **3.5 Typing Kinematics, Cognitive Friction, and Frontal Hemodynamic Lateralization (Figure 5):** Relationship between typing WPM, inter-key interval jitter, backspace error bursts, and bilateral/lateralized prefrontal $\Delta\text{HbO}_2$ & EEG theta/beta ratios.
- **3.6 Physiological Cost of Context Switching and Interruption Recovery Half-Life (Figure 6):** Impact of rapid tab-switching vs. uninterrupted deep-work blocks on EEG Focus, vagal HRV, and post-interruption recovery time $\tau_{\text{recovery}}$.
- **3.7 Circadian and Time-on-Task Depletion Dynamics Across 30 Days (Figure 7):** Morning vs. afternoon vs. evening trajectories and cumulative session fatigue signatures.
- **3.8 Out-of-Session Predictive Decoding of Cognitive State from Multimodal Features (Figure 8):** Cross-validated classification/regression of task category and self-tagged flow/fatigue using EEG + fNIRS + PPG + IMU fusion.

### Section 4: Discussion
- **4.1 Autonomic–Central Coupling in Ecological Cognition:** How sympathetic orienting and parasympathetic attentional bradycardia interact with prefrontal metabolic demand ($\Delta\text{HbO}_2$) and beta oscillations.
- **4.2 Methodological Lessons for Wearable Dry-Electrode & Optical Neuroimaging:** Why forehead-centric EEG (`AF7`/`AF8`) + fNIRS/PPG (`730/850 nm`) provides the highest-reliability signal on soft headbands during natural head movement.
- **4.3 Toward Physiologically Closed-Loop Agentic Computing:** How coding and research environments can adapt UI complexity, notification gating, or agent autonomy based on real-time user Focus, $\Delta\text{HbO}_2$, and autonomic arousal.

---

## 4. Proposed 8-Figure Storyboard & Status Matrix

| Figure | Title & Panels (`A–D`) | Current Status | Data Source / Experiment |
|---|---|---|---|
| **Figure 1** | **Multimodal Session Architecture & Synchronized Time Series**<br>`A`: Browser domain & action raster; `B`: Prefrontal $\Delta\text{HbO}_2, \Delta\text{HHb}, \Delta\text{HbT}$; `C`: EEG Focus & Calm; `D`: Heart Rate & Stillness | **Rendered (Pilot v1)**<br>[`fig1_session_timeline.png`](file:///Users/fulkanjou/EEGVideo/analysis/sessions/session_2026-11-07T22-51-34/figures/fig1_session_timeline.png) | Session 1 (`N = 868` ticks, `14.1 min`) |
| **Figure 2** | **Physiological Profiles Across Naturalistic Website Domains**<br>`A`: Mean $\Delta\text{HbO}_2$ by domain; `B`: EEG Focus by domain; `C`: Relative $\theta/\alpha/\beta$ profile; `D`: Heart Rate boxplot by domain | **Rendered (Pilot v1)**<br>[`fig2_domain_physiology.png`](file:///Users/fulkanjou/EEGVideo/analysis/sessions/session_2026-11-07T22-51-34/figures/fig2_domain_physiology.png) | Session 1 + expands automatically across all 30-day sessions |
| **Figure 3** | **Event-Locked Peri-Action Dynamics & Cross-Modal Coupling**<br>`A`: Peri-event Focus $[-10, +15\text{s}]$; `B`: Peri-event $\Delta\text{HbO}_2$; `C`: Peri-event HR; `D`: 10-variable Spearman matrix | **Rendered (Pilot v1)**<br>[`fig3_event_locked_and_coupling.png`](file:///Users/fulkanjou/EEGVideo/analysis/sessions/session_2026-11-07T22-51-34/figures/fig3_event_locked_and_coupling.png) | Session 1 (`20` clicks, `37` navs, `16` scrolls) $\rightarrow$ scales to $>10,000$ events |
| **Figure 4** | **Autonomic-to-Prefrontal Hand-Off: Acute Email Shock to Executive Investigation**<br>`A`: Standardized 4-phase trajectory (`P1–P4`); `B`: HR by phase; `C`: $\Delta\text{HbO}_2$ by phase; `D`: EEG Focus by phase | **Rendered (Pilot v1)**<br>[`fig5_threat_to_investigation_phases.png`](file:///Users/fulkanjou/EEGVideo/analysis/sessions/session_2026-11-07T22-51-34/figures/fig5_threat_to_investigation_phases.png) | Session 1 serendipitous capture + future tagged high-arousal events |
| **Figure 5** | **Joint Brain–Body State Space & Forehead vs. Temporal Electrode Reliability**<br>`A`: Focus vs. $\Delta\text{HbO}_2$; `B`: Alpha vs. Beta state space; `C`: Electrode SD (`AF7/AF8` vs. `TP9/TP10`) | **Rendered (Pilot v1)**<br>[`fig4_brain_body_state_space.png`](file:///Users/fulkanjou/EEGVideo/analysis/sessions/session_2026-11-07T22-51-34/figures/fig4_brain_body_state_space.png) | Session 1 + longitudinal electrode contact tracking |
| **Figure 6** | **Keyboard Kinematics, Typing Friction, and Prefrontal Hemodynamic Lateralization**<br>`A`: WPM vs. Focus & $\Delta\text{HbO}_2$; `B`: Backspace error bursts vs. Frontal Theta; `C`: Left vs. Right $\Delta\text{HbO}_2$ during prose writing vs. coding; `D`: Peri-burst trajectories | **Planned — Experiment 1** | **Targeted Protocol 1:** Enable `Keyou/Cadence` logging during 30-min blocks of academic writing, Python/JS coding, and email replies |
| **Figure 7** | **Cognitive Cost of Context Switching & Interruption Recovery Half-Life**<br>`A`: Tab-switch rate vs. Focus & HRV; `B`: Deep work (30m single-tab) vs. Fragmented work (2m multi-tab); `C`: Post-notification recovery curve ($\tau_{\text{recovery}}$); `D`: Cumulative $\Delta\text{HbT}$ load | **Planned — Experiment 2** | **Targeted Protocol 2:** Paired 45-min uninterrupted Deep Work sessions vs. high-switching triage sessions + manual `"interruption"` tags |
| **Figure 8** | **30-Day Longitudinal Circadian Dynamics & Out-of-Session State Decoding**<br>`A`: Circadian phase (Morning/Afternoon/Night) across 30 days; `B`: Time-on-task depletion (0–90m); `C`: Cross-session decoder ROC/confusion matrix (EEG vs. fNIRS vs. Fusion); `D`: Feature importance | **Planned — Experiments 3 & 4** | **Targeted Protocol 3 & 4:** Morning, afternoon, and evening sessions across 30 days + manual state tags (`"flow"`, `"fatigued"`, `"stressed"`, `"calm"`) |

---

## 5. Targeted 30-Day $N=1$ Experimental Schedule (To Fill Figures 6–8 & Power Figures 1–5)

1. **Daily Baseline & Calibration Habit (60 seconds at start of each session):**
   - Put on the Muse S Athena, check that `AF7` and `AF8` are green in the BLE Bridge tab, click **Zero fNIRS**, and sit quietly looking at a blank tab for 60 seconds after clicking **Start Rec** (tagging `"baseline_eyes_open"`). This gives every single session across the 30 days a standardized within-session zero point for $\Delta\text{HbO}_2$, $\Delta\text{HHb}$, Heart Rate, and EEG band powers.
2. **Targeted Experiment 1 — Typing Production vs. Passive Consumption (Fills Figure 6):**
   - Complete at least 8–10 sessions containing sustained keyboard production (writing LaTeX/Markdown prose, coding, or composing long emails). Even with `Log Key Text` off (privacy-safe cadence mode), the extension logs `typing_wpm`, `mean_iki_ms`, and `backspace_count` on every typing burst!
3. **Targeted Experiment 2 — Monotasking Deep Work vs. Rapid Context Switching (Fills Figure 7):**
   - Log at least 6 sessions of **Uninterrupted Single-Task Deep Work** (30–45 minutes on a single paper/codebase with zero email/social tabs) and 6 sessions of **High-Switch Triage** (checking email, grading, social media, multiple search tabs), using the popup's **Tag** box (`"deep_work"`, `"interruption"`, `"flow_state"`).
4. **Targeted Experiment 3 — Circadian & Time-on-Task Sampling (Fills Figure 8):**
   - Record sessions across three circadian windows over the month: **Morning (08:00–11:30)**, **Afternoon (13:00–17:00)**, and **Evening (19:00–23:00)**, including at least 5 long sessions ($\ge 60\text{ minutes}$) to capture time-on-task prefrontal oxygenation saturation and EEG theta/alpha fatigue drift.
