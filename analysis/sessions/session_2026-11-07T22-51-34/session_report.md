# Muse S Athena — Multimodal Brain, fNIRS & Computer-Use Session Report

**Session Directory:** `session_2026-11-07T22-51-34`  
**Total Duration:** 14.12 minutes (847.0 seconds)  
**Physiological State Samples:** 868 ticks  
**Computer-Use Events Logged:** 219 events (20 clicks, 37 navigations, 16 scroll bursts, 47 mouse kinematic windows)  
**Synchronized Screenshots Captured:** 121 JPEG frames  

---

## 1. Key Empirical Findings

1. **Heightened Prefrontal Oxygenation and EEG Beta Engagement During Scientific Literature Review:**
   - Across website domains, omnibus Kruskal-Wallis tests revealed highly significant modulation of **EEG Focus Index** ($H = 318.44, p = 6.96e-65$), **Prefrontal Oxyhemoglobin ($\Delta\text{HbO}_2$)** ($H = 512.39, p = 1.74e-106$), and **Cardiovascular Heart Rate** ($H = 205.72, p = 7.05e-41$).
   - While reading scientific literature (**PubMed** and **Google Scholar**, $n = 48$ ticks), the **EEG Focus Index** ($\beta / [\alpha + \theta]$) more than doubled compared to **Gmail** ($n = 471$ ticks): $\text{mean} = 1.019 \pm 0.399$ vs. $0.385 \pm 0.324$ (Welch's $t = 10.65, p = 7.81e-15$, Mann-Whitney $U = 20345, p = 6.62e-20$, Cohen's $d = 1.74$).
   - This Focus surge was driven by a $2.6\times$ increase in **Relative Beta Power (13–30 Hz)** during scientific reading ($24.2\% \pm 7.5\%$) compared to email triage ($9.2\% \pm 7.7\%$, Cohen's $d = 1.98$), accompanied by elevated **Prefrontal Oxyhemoglobin ($\Delta\text{HbO}_2$)** ($+16.99 \pm 0.59\ \mu\text{M}$ on PubMed/Scholar vs. $+6.65 \pm 6.04\ \mu\text{M}$ on Gmail, $p = 8.63e-25$).

2. **Attentional Cardiac Deceleration During Focused Reading vs. Social Media Arousal:**
   - Focused scientific reading on **PubMed** and **Google Scholar** elicited classical **attentional bradycardia** (parasympathetic cardiac deceleration during sustained visual intake), with Heart Rate averaging $68.7 \pm 2.4\text{ BPM}$ (median $68.6\text{ BPM}$) compared to $82.0 \pm 18.7\text{ BPM}$ on **Gmail** ($p = 4.28e-11$, Cohen's $d = -0.99$) and $77.0 \pm 11.5\text{ BPM}$ (median $69.8\text{ BPM}$) on **Facebook / LinkedIn** ($p = 5.07e-07$, Cohen's $d = 0.99$).

3. **Forehead vs. Temporal Electrode Contact on Muse S Athena:**
   - The forehead dry sensors (**AF7** median SD $= 44.9\ \mu\text{V}$, **AF8** median SD $= 59.4\ \mu\text{V}$, alongside the 730/850 nm forehead optical fNIRS & PPG array) maintained substantially cleaner skin contact than the over-ear temporal sensors (**TP9** median SD $= 356.8\ \mu\text{V}$, **TP10** median SD $= 408.9\ \mu\text{V}$). Automatic channel gating in `PhysiologyEngine` isolated the clean forehead channels for spectral estimation.

---

## 2. Website Domain Physiological Summary Table

| Website Domain | Category | Duration (Ticks) | Events (Clicks) | EEG Focus ($\beta/[\alpha+\theta]$) | EEG Calm ($\alpha/\theta$) | Rel $\beta$ / $\alpha$ / $\theta$ (%) | Prefrontal $\Delta\text{HbO}_2$ ($\mu\text{M}$) | Median HR (BPM) | Median HRV (ms) |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| **PubMed** | Scientific Literature | 24s (25) | 13 (1) | **1.078** ± 0.430 | 0.572 ± 0.348 | 24.4 / 8.0 / 15.3 | +17.41 ± 0.53 | 66.8 (IQR 1.2) | 108.3 |
| **Google Scholar** | Scientific Literature | 22s (23) | 5 (0) | **0.954** ± 0.361 | 0.753 ± 0.465 | 24.0 / 10.6 / 16.4 | +16.55 ± 0.20 | 69.8 (IQR 1.3) | 93.2 |
| **Akamai Univ** | Learning / Coursework | 37s (38) | 6 (0) | **0.929** ± 0.384 | 0.735 ± 0.367 | 24.2 / 11.0 / 17.1 | +16.64 ± 0.39 | 69.8 (IQR 1.9) | 127.0 |
| **LinkedIn** | Social / Professional | 51s (52) | 20 (2) | **0.919** ± 0.301 | 0.653 ± 0.244 | 24.8 / 10.7 / 17.3 | +17.11 ± 0.26 | 69.2 (IQR 1.4) | 110.6 |
| **Facebook** | Social / Professional | 54s (55) | 21 (1) | **0.851** ± 0.357 | 0.567 ± 0.269 | 21.7 / 9.4 / 18.0 | +17.16 ± 0.40 | 80.0 (IQR 19.6) | 123.8 |
| **Google Search** | Web Search | 143s (147) | 82 (16) | **0.768** ± 0.304 | 0.620 ± 0.287 | 20.6 / 10.2 / 17.8 | +16.25 ± 1.04 | 76.8 (IQR 10.6) | 107.8 |
| **Antigravity** | AI / Agentic Coding | 42s (43) | 14 (0) | **0.566** ± 0.241 | 0.639 ± 0.366 | 8.0 / 5.4 / 10.0 | +5.82 ± 0.71 | 65.1 (IQR 0.0) | 111.1 |
| **Gmail** | Email / Triage | 460s (471) | 54 (0) | **0.385** ± 0.324 | 0.437 ± 0.296 | 9.2 / 7.1 / 18.0 | +6.65 ± 6.04 | 76.8 (IQR 15.5) | 111.5 |

---

## 3. Figure Captions

- **Figure 1 (`figures/fig1_session_timeline.png`):** Synchronized 14.1-minute multimodal time series across computer use and Muse S Athena physiology ($N = 868$ physiological ticks, $N = 219$ computer-use events). **(A)** Active browser domain strip and discrete computer interaction raster (mouse clicks, page navigations, scroll bursts). **(B)** Prefrontal cortex optical hemodynamics ($\Delta\text{HbO}_2$, $\Delta\text{HHb}$, and $\Delta\text{HbT}$ in $\mu\text{M}$) computed from dual-wavelength 730 nm and 850 nm fNIRS via the Modified Beer-Lambert Law. **(C)** Continuous EEG spectral Focus Index ($\beta_{rel} / [\alpha_{rel} + \theta_{rel}]$) and Calm Index ($\alpha_{rel} / \theta_{rel}$). **(D)** Cardiovascular Heart Rate (BPM from 64 Hz PPG) and Head Stillness score (% from 52 Hz IMU).
- **Figure 2 (`figures/fig2_domain_physiology.png`):** Physiological profiles stratified by website domain (ordered by mean EEG Focus Index). **(A)** Mean $\pm$ SEM prefrontal oxyhemoglobin change ($\Delta\text{HbO}_2$, $\mu\text{M}$). **(B)** Mean $\pm$ SEM EEG Focus Index ($\beta / [\alpha + \theta]$). **(C)** Relative EEG spectral band power distribution for Theta (4–8 Hz), Alpha (8–13 Hz), and Beta (13–30 Hz) as a percentage of 1–45 Hz broadband power. **(D)** Heart Rate (BPM) median and interquartile distributions by domain.
- **Figure 3 (`figures/fig3_event_locked_and_coupling.png`):** Event-locked peri-action physiological dynamics ($[-10\text{ s}, +15\text{ s}]$ relative to action onset, baseline-corrected to $[-5, 0]\text{ s}$, mean $\pm$ SEM ribbon) for Mouse Clicks ($n = 20$), Page Navigations ($n = 37$), and Scroll Bursts ($n = 16$). **(A)** Peri-action change in EEG Focus Index. **(B)** Peri-action change in prefrontal $\Delta\text{HbO}_2$ ($\mu\text{M}$). **(C)** Peri-action change in Heart Rate (BPM). **(D)** Cross-modal Spearman rank correlation matrix ($\rho$) across EEG, fNIRS, PPG, and IMU measures ($N = 868$).
- **Figure 4 (`figures/fig4_brain_body_state_space.png`):** Joint brain–body state space and electrode contact diagnostics. **(A)** Bivariate state space of Prefrontal $\Delta\text{HbO}_2$ ($\mu\text{M}$) vs. EEG Focus Index colored by cognitive activity category. **(B)** Relative Alpha (8–13 Hz) vs. Relative Beta (13–30 Hz) spectral state space. **(C)** 1-second sliding window amplitude standard deviation ($\mu\text{V}$) across forehead (AF7, AF8) and temporal (TP9, TP10) dry electrodes.
