/**
 * Real-Time Physiological Signal Processing Engine for Muse S Athena (MS-03).
 *
 * Computes synchronized continuous physiological features from:
 * 1. 256 Hz 4-channel EEG (TP9, AF7, AF8, TP10):
 *    - Relative & absolute band powers: Delta (1-4 Hz), Theta (4-8 Hz),
 *      Alpha (8-13 Hz), Beta (13-30 Hz), Gamma (30-45 Hz)
 *    - Focus / Engagement Index: Beta_rel / (Alpha_rel + Theta_rel)
 *    - Calm / Relaxation Index: Alpha_rel / Theta_rel
 *    - Frontal Alpha Asymmetry (FAA): ln(Alpha_AF8) - ln(Alpha_AF7)
 *    - Per-electrode Signal Quality (stdDev µV & artifact detection)
 *
 * 2. 64 Hz Dual-Wavelength Optical Sensors (730 nm & 850 nm fNIRS + PPG):
 *    - Oxyhemoglobin (ΔHbO2, µM), Deoxyhemoglobin (ΔHHb, µM), Total Hemoglobin (ΔHbT = ΔHbO2 + ΔHHb, µM)
 *      via the Modified Beer-Lambert Law (MBLL) across Left, Right, and Bilateral prefrontal optodes
 *    - Heart Rate (BPM) and Heart Rate Variability (RMSSD, ms) from cardiac-band PPG
 *
 * 3. 52 Hz 6-Axis IMU (Accelerometer + Gyroscope):
 *    - Head Angular Velocity RMS (deg/s) and Head Stillness Score (0-100%)
 */

const EEG_FS = 256;
const EEG_FFT_SIZE = 512; // 2.0-second sliding window (0.5 Hz bin resolution)
const OPTICS_FS = 64;
const PPG_WINDOW_SAMPLES = 512; // 8.0-second window at 64 Hz for PPG peak & spectral HR

// Precompute 512-point Hanning window and energy correction factor
const HANNING_512 = new Float64Array(EEG_FFT_SIZE);
let HANNING_NORM = 0;
for (let i = 0; i < EEG_FFT_SIZE; i++) {
  const w = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (EEG_FFT_SIZE - 1)));
  HANNING_512[i] = w;
  HANNING_NORM += w * w;
}

/**
 * In-place Radix-2 Cooley-Tukey FFT.
 * @param {Float64Array} re - Real part (length must be power of 2)
 * @param {Float64Array} im - Imaginary part (same length)
 */
export function fftInPlace(re, im) {
  const n = re.length;
  let j = 0;
  for (let i = 0; i < n; i++) {
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
    let m = n >> 1;
    while (m >= 1 && j >= m) {
      j -= m;
      m >>= 1;
    }
    j += m;
  }

  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const angle = (-2 * Math.PI) / len;
    const wStepRe = Math.cos(angle);
    const wStepIm = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let wRe = 1.0;
      let wIm = 0.0;
      for (let k = 0; k < half; k++) {
        const evenIdx = i + k;
        const oddIdx = i + k + half;
        const tRe = wRe * re[oddIdx] - wIm * im[oddIdx];
        const tIm = wRe * im[oddIdx] + wIm * re[oddIdx];
        re[oddIdx] = re[evenIdx] - tRe;
        im[oddIdx] = im[evenIdx] - tIm;
        re[evenIdx] += tRe;
        im[evenIdx] += tIm;
        const nextWRe = wRe * wStepRe - wIm * wStepIm;
        wIm = wRe * wStepIm + wIm * wStepRe;
        wRe = nextWRe;
      }
    }
  }
}

/**
 * Compute single-sided Power Spectral Density (PSD) for a 512-sample EEG buffer.
 * @param {number[]} samples - Array of length >= 512
 * @returns {Float64Array} PSD array of length 257 (0 Hz to 128 Hz in 0.5 Hz steps)
 */
export function computePsd512(samples) {
  const re = new Float64Array(EEG_FFT_SIZE);
  const im = new Float64Array(EEG_FFT_SIZE);
  const start = samples.length - EEG_FFT_SIZE;

  // Compute mean for DC removal
  let mean = 0;
  for (let i = 0; i < EEG_FFT_SIZE; i++) {
    mean += samples[start + i];
  }
  mean /= EEG_FFT_SIZE;

  for (let i = 0; i < EEG_FFT_SIZE; i++) {
    re[i] = (samples[start + i] - mean) * HANNING_512[i];
    im[i] = 0;
  }

  fftInPlace(re, im);

  const numBins = (EEG_FFT_SIZE >> 1) + 1;
  const psd = new Float64Array(numBins);
  const scale = 2.0 / (EEG_FS * HANNING_NORM);
  for (let k = 0; k < numBins; k++) {
    psd[k] = (re[k] * re[k] + im[k] * im[k]) * scale;
  }
  return psd;
}

/**
 * Integrate PSD between [fLow, fHigh] Hz (with 0.5 Hz bin spacing).
 */
function integrateBand(psd, fLow, fHigh) {
  const df = EEG_FS / EEG_FFT_SIZE; // 0.5 Hz
  const kStart = Math.max(1, Math.ceil(fLow / df));
  const kEnd = Math.min(psd.length - 1, Math.floor(fHigh / df));
  let sum = 0;
  for (let k = kStart; k <= kEnd; k++) {
    sum += psd[k] * df;
  }
  return sum;
}

/**
 * Modified Beer-Lambert Law (MBLL) constants for 730 nm and 850 nm.
 *
 * Molar extinction coefficients ε in cm^-1 * M^-1 (Cope / Matcher / Prahl):
 *   λ1 = 730 nm: ε_HbO2 = 390.0,  ε_HHb = 1102.2
 *   λ2 = 850 nm: ε_HbO2 = 1058.0, ε_HHb = 691.3
 *
 * Effective pathlength L = d * DPF = 1.5 cm * 6.0 = 9.0 cm.
 * Output converted from Molar (M) to micromolar (µM) via 1e6 factor.
 */
const EPS_HBO2_730 = 390.0;
const EPS_HHB_730 = 1102.2;
const EPS_HBO2_850 = 1058.0;
const EPS_HHB_850 = 691.3;
const MBLL_DET = EPS_HBO2_730 * EPS_HHB_850 - EPS_HBO2_850 * EPS_HHB_730;
const EFFECTIVE_PATHLENGTH_CM = 9.0; // d (1.5 cm) * DPF (6.0)

/**
 * Solve Modified Beer-Lambert Law for ΔHbO2, ΔHHb, and ΔHbT (in µM)
 * given baseline intensities (I0_730, I0_850) and current low-pass intensities (I_730, I_850).
 *
 * @param {number} i730 - Current intensity at 730 nm
 * @param {number} i850 - Current intensity at 850 nm
 * @param {number} i0_730 - Baseline intensity at 730 nm
 * @param {number} i0_850 - Baseline intensity at 850 nm
 * @returns {{ hbO2: number, hhb: number, hbt: number, od730: number, od850: number }}
 */
export function solveMbllHemoglobin(i730, i850, i0_730, i0_850) {
  if (
    !i730 || !i850 || !i0_730 || !i0_850 ||
    i730 <= 0 || i850 <= 0 || i0_730 <= 0 || i0_850 <= 0
  ) {
    return { hbO2: 0, hhb: 0, hbt: 0, od730: 0, od850: 0 };
  }

  // Optical density change ΔOD = -ln(I / I0)
  const od730 = -Math.log(i730 / i0_730);
  const od850 = -Math.log(i850 / i0_850);

  // Invert 2x2 extinction matrix and convert M -> µM (1e6 / L)
  const scale = 1e6 / (EFFECTIVE_PATHLENGTH_CM * MBLL_DET);
  const hbO2 = scale * (EPS_HHB_850 * od730 - EPS_HHB_730 * od850);
  const hhb = scale * (-EPS_HBO2_850 * od730 + EPS_HBO2_730 * od850);
  const hbt = hbO2 + hhb;

  return {
    hbO2: Number(hbO2.toFixed(4)),
    hhb: Number(hhb.toFixed(4)),
    hbt: Number(hbt.toFixed(4)),
    od730: Number(od730.toFixed(5)),
    od850: Number(od850.toFixed(5)),
  };
}

function stdDev(arr) {
  if (!arr || arr.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < arr.length; i++) sum += arr[i];
  const mean = sum / arr.length;
  let sq = 0;
  for (let i = 0; i < arr.length; i++) {
    const d = arr[i] - mean;
    sq += d * d;
  }
  return Math.sqrt(sq / arr.length);
}

function median(arr) {
  if (!arr || arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 !== 0 ? sorted[mid] : 0.5 * (sorted[mid - 1] + sorted[mid]);
}

/**
 * Stateful Physiology Engine that ingests streaming EEG, Optics, and Motion packets
 * and produces continuous synchronized physiological state snapshots.
 */
export class PhysiologyEngine {
  constructor() {
    // 4 EEG channel circular/sliding buffers: TP9, AF7, AF8, TP10
    this.eegBuffers = [[], [], [], []];
    this.maxEegBuffer = 1024; // 4 seconds at 256 Hz

    // Optics state for MBLL (fNIRS) and PPG (Heart Rate / HRV)
    this.opticsBaseline = {
      left730: null,
      right730: null,
      left850: null,
      right850: null,
      calibrationSamples: 0,
      accumL730: 0,
      accumR730: 0,
      accumL850: 0,
      accumR850: 0,
    };
    this.opticsLowPass = {
      left730: null,
      right730: null,
      left850: null,
      right850: null,
    };

    // PPG cardiac buffer (64 Hz composite 850nm + 730nm intensity)
    this.ppgBuffer = []; // { tMs, raw }
    this.ppgFilteredBuffer = []; // { tMs, val }
    this.lastPeakTimeMs = 0;
    this.ibiHistoryMs = []; // Rolling inter-beat intervals (ms)
    this.opticsSampleIndex = 0;

    // Motion buffers
    this.gyroBuffer = [];
    this.accelBuffer = [];
    this.batteryLevel = null;

    // Session rolling stats for z-score normalization & state tagging
    this.rollingStats = {
      focus: { n: 0, mean: 0, m2: 0 },
      alphaRel: { n: 0, mean: 0, m2: 0 },
      hr: { n: 0, mean: 0, m2: 0 },
    };

    this.latestSnapshot = this.createEmptySnapshot();
  }

  createEmptySnapshot() {
    return {
      timestamp: Date.now(),
      eegReady: false,
      opticsReady: false,
      // Relative EEG band powers (0..1, sum = 1)
      deltaRel: 0,
      thetaRel: 0,
      alphaRel: 0,
      betaRel: 0,
      gammaRel: 0,
      // Absolute EEG band powers (µV^2)
      deltaAbs: 0,
      thetaAbs: 0,
      alphaAbs: 0,
      betaAbs: 0,
      gammaAbs: 0,
      // Normalized session z-scores
      alphaZ: 0,
      focusZ: 0,
      // Cognitive & Affective EEG indices
      focusIndex: 0,
      calmIndex: 0,
      frontalAlphaAsymmetry: 0,
      // fNIRS Hemodynamics (Modified Beer-Lambert Law, in µM)
      hbO2: 0,
      hhb: 0,
      hbt: 0,
      leftHbO2: 0,
      rightHbO2: 0,
      leftHHb: 0,
      rightHHb: 0,
      leftHbT: 0,
      rightHbT: 0,
      // Cardiovascular (PPG)
      heartRateBpm: 0,
      hrvRmssdMs: 0,
      hrConfidence: 0,
      ppgWave: 0,
      // Head Motion & Stillness (IMU)
      headAngularVelocityDegS: 0,
      stillnessScore: 100,
      // Signal Quality & Battery
      signalQuality: { TP9: 0, AF7: 0, AF8: 0, TP10: 0, goodCount: 0, eegArtifact: false },
      batteryLevel: null,
      // Interpretable state tags for instant correlation
      stateTags: [],
    };
  }

  updateWelford(stat, x) {
    if (!Number.isFinite(x)) return 0;
    stat.n += 1;
    const delta = x - stat.mean;
    stat.mean += delta / stat.n;
    const delta2 = x - stat.mean;
    stat.m2 += delta * delta2;
    if (stat.n < 10) return 0;
    const std = Math.sqrt(stat.m2 / (stat.n - 1));
    return std > 1e-6 ? (x - stat.mean) / std : 0;
  }

  /**
   * Reset fNIRS optical baseline (re-zeros ΔHbO2, ΔHHb, ΔHbT to current state).
   */
  resetFnirsBaseline() {
    this.opticsBaseline = {
      left730: this.opticsLowPass.left730,
      right730: this.opticsLowPass.right730,
      left850: this.opticsLowPass.left850,
      right850: this.opticsLowPass.right850,
      calibrationSamples: this.opticsLowPass.left730 ? 128 : 0,
      accumL730: 0,
      accumR730: 0,
      accumL850: 0,
      accumR850: 0,
    };
  }

  /**
   * Ingest 4-channel EEG samples: [[TP9...], [AF7...], [AF8...], [TP10...]]
   */
  pushEeg(samplesByChannel) {
    if (!samplesByChannel || samplesByChannel.length < 4) return;
    for (let ch = 0; ch < 4; ch++) {
      const incoming = samplesByChannel[ch];
      if (!incoming || !incoming.length) continue;
      const buf = this.eegBuffers[ch];
      buf.push(...incoming);
      if (buf.length > this.maxEegBuffer) {
        buf.splice(0, buf.length - this.maxEegBuffer);
      }
    }
  }

  /**
   * Ingest optical subpacket (64 Hz):
   * 4ch: ['LI_730', 'RI_730', 'LI_850', 'RI_850']
   * 8ch: ['LO_730', 'RO_730', 'LO_850', 'RO_850', 'LI_730', 'RI_730', 'LI_850', 'RI_850']
   */
  pushOptics({ timestamp, channelNames, channels }) {
    if (!channels || channels.length < 4) return;
    const nSamples = channels[0]?.length || 0;
    if (nSamples === 0) return;

    // Identify indices for Left/Right 730nm and 850nm
    let idxL730 = 0;
    let idxR730 = 1;
    let idxL850 = 2;
    let idxR850 = 3;
    if (channelNames && channelNames.length >= 8) {
      // Use inner forehead optodes (or average inner+outer)
      idxL730 = channelNames.indexOf('LI_730');
      idxR730 = channelNames.indexOf('RI_730');
      idxL850 = channelNames.indexOf('LI_850');
      idxR850 = channelNames.indexOf('RI_850');
    }

    // EMA low-pass coefficient for hemodynamic signal (~0.4 Hz cutoff at 64 Hz: alpha ≈ 0.038)
    const alphaHemo = 0.04;

    for (let s = 0; s < nSamples; s++) {
      const l730 = channels[idxL730]?.[s] ?? 0;
      const r730 = channels[idxR730]?.[s] ?? 0;
      const l850 = channels[idxL850]?.[s] ?? 0;
      const r850 = channels[idxR850]?.[s] ?? 0;

      if (l730 <= 0 || r730 <= 0 || l850 <= 0 || r850 <= 0) continue;

      if (this.opticsLowPass.left730 === null) {
        this.opticsLowPass.left730 = l730;
        this.opticsLowPass.right730 = r730;
        this.opticsLowPass.left850 = l850;
        this.opticsLowPass.right850 = r850;
      } else {
        this.opticsLowPass.left730 += alphaHemo * (l730 - this.opticsLowPass.left730);
        this.opticsLowPass.right730 += alphaHemo * (r730 - this.opticsLowPass.right730);
        this.opticsLowPass.left850 += alphaHemo * (l850 - this.opticsLowPass.left850);
        this.opticsLowPass.right850 += alphaHemo * (r850 - this.opticsLowPass.right850);
      }

      // Accumulate initial 2 seconds (128 samples) for fNIRS baseline I0
      const base = this.opticsBaseline;
      if (base.calibrationSamples < 128) {
        base.accumL730 += l730;
        base.accumR730 += r730;
        base.accumL850 += l850;
        base.accumR850 += r850;
        base.calibrationSamples += 1;
        base.left730 = base.accumL730 / base.calibrationSamples;
        base.right730 = base.accumR730 / base.calibrationSamples;
        base.left850 = base.accumL850 / base.calibrationSamples;
        base.right850 = base.accumR850 / base.calibrationSamples;
      }

      // PPG cardiac signal: use negative log intensity of mean 850nm + 730nm
      // (systolic blood volume pulse increases absorption -> decreases raw intensity -> positive peak in -ln(I))
      const meanIntensity = 0.25 * (l850 + r850 + l730 + r730);
      const ppgRaw = -Math.log(meanIntensity);
      const sampleTimeMs =
        (timestamp || Date.now()) - ((nSamples - 1 - s) * 1000) / OPTICS_FS;

      this.opticsSampleIndex += 1;
      this.ppgBuffer.push({ tMs: sampleTimeMs, raw: ppgRaw, idx: this.opticsSampleIndex });
      if (this.ppgBuffer.length > PPG_WINDOW_SAMPLES) {
        this.ppgBuffer.shift();
      }

      // Bandpass filter PPG: subtract 64-sample (1.0s) moving average, then smooth over 8 samples (0.125s)
      const len = this.ppgBuffer.length;
      if (len >= 64) {
        let sumSlow = 0;
        for (let k = len - 64; k < len; k++) sumSlow += this.ppgBuffer[k].raw;
        const detrended = ppgRaw - sumSlow / 64;

        this.ppgFilteredBuffer.push({ tMs: sampleTimeMs, detrended, val: detrended });
        if (this.ppgFilteredBuffer.length > PPG_WINDOW_SAMPLES) {
          this.ppgFilteredBuffer.shift();
        }

        const fLen = this.ppgFilteredBuffer.length;
        const smoothWindow = Math.min(8, fLen);
        let sumSmooth = 0;
        for (let k = fLen - smoothWindow; k < fLen; k++) {
          sumSmooth += this.ppgFilteredBuffer[k].detrended;
        }
        this.ppgFilteredBuffer[fLen - 1].val = sumSmooth / smoothWindow;

        // Real-time systolic peak check on 3-point window [fLen-3, fLen-2, fLen-1]
        if (fLen >= 64) {
          const prev = this.ppgFilteredBuffer[fLen - 3].val;
          const curr = this.ppgFilteredBuffer[fLen - 2].val;
          const next = this.ppgFilteredBuffer[fLen - 1].val;
          const currTime = this.ppgFilteredBuffer[fLen - 2].tMs;

          if (curr > prev && curr >= next) {
            // Compute local RMS of last 128 samples for adaptive peak threshold
            const lookback = Math.min(128, fLen);
            let sq = 0;
            for (let k = fLen - lookback; k < fLen; k++) {
              const v = this.ppgFilteredBuffer[k].val;
              sq += v * v;
            }
            const rms = Math.sqrt(sq / lookback);
            if (curr > 0.45 * rms && rms > 1e-6) {
              const ibi = currTime - this.lastPeakTimeMs;
              // Valid human heart rate range: 330 ms (181 BPM) to 1500 ms (40 BPM)
              if (this.lastPeakTimeMs > 0 && ibi >= 330 && ibi <= 1500) {
                this.ibiHistoryMs.push(ibi);
                if (this.ibiHistoryMs.length > 24) {
                  this.ibiHistoryMs.shift();
                }
              }
              if (ibi >= 330 || this.lastPeakTimeMs === 0) {
                this.lastPeakTimeMs = currTime;
              }
            }
          }
        }
      }
    }
  }

  /**
   * Ingest 6-axis IMU motion samples.
   */
  pushMotion({ accel, gyro }) {
    if (gyro && gyro.length) {
      for (const g of gyro) {
        const mag = Math.sqrt(g.x * g.x + g.y * g.y + g.z * g.z);
        this.gyroBuffer.push(mag);
      }
      if (this.gyroBuffer.length > 104) {
        this.gyroBuffer.splice(0, this.gyroBuffer.length - 104);
      }
    }
    if (accel && accel.length) {
      for (const a of accel) {
        const mag = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
        this.accelBuffer.push(mag);
      }
      if (this.accelBuffer.length > 104) {
        this.accelBuffer.splice(0, this.accelBuffer.length - 104);
      }
    }
  }

  pushTelemetry({ batteryLevel }) {
    if (batteryLevel != null) {
      this.batteryLevel = batteryLevel;
    }
  }

  /**
   * Compute full synchronized physiological snapshot.
   * Call at 2–4 Hz (e.g. every 250 ms).
   */
  computeSnapshot() {
    const now = Date.now();
    const snap = this.createEmptySnapshot();
    snap.timestamp = now;
    snap.batteryLevel = this.batteryLevel;

    // 1. Signal Quality & EEG Spectral Features
    const chNames = ['TP9', 'AF7', 'AF8', 'TP10'];
    let goodCount = 0;
    let usableCount = 0;

    for (let ch = 0; ch < 4; ch++) {
      const buf = this.eegBuffers[ch];
      const recent256 = buf.slice(-256);
      const sd = recent256.length >= 32 ? stdDev(recent256) : 0;
      snap.signalQuality[chNames[ch]] = Number(sd.toFixed(2));
      if (sd >= 1.0 && sd <= 35.0) {
        goodCount += 1;
      }
      if (sd >= 0.5 && sd <= 85.0) {
        usableCount += 1;
      }
    }
    const artifactDetected = usableCount === 0;
    snap.signalQuality.goodCount = goodCount;
    snap.signalQuality.eegArtifact = artifactDetected;

    const minEegLen = Math.min(...this.eegBuffers.map((b) => b.length));
    if (minEegLen >= EEG_FFT_SIZE) {
      snap.eegReady = true;
      const psds = [0, 1, 2, 3].map((ch) => computePsd512(this.eegBuffers[ch]));

      const bandsPerCh = psds.map((psd) => {
        const delta = integrateBand(psd, 1.0, 4.0);
        const theta = integrateBand(psd, 4.0, 8.0);
        const alpha = integrateBand(psd, 8.0, 13.0);
        const beta = integrateBand(psd, 13.0, 30.0);
        const gamma = integrateBand(psd, 30.0, 45.0);
        const total = Math.max(1e-9, delta + theta + alpha + beta + gamma);
        return {
          delta,
          theta,
          alpha,
          beta,
          gamma,
          total,
          deltaRel: delta / total,
          thetaRel: theta / total,
          alphaRel: alpha / total,
          betaRel: beta / total,
          gammaRel: gamma / total,
        };
      });

      // Average across clean channels (or all 4 if none meet strict criterion)
      const activeIndices = [0, 1, 2, 3].filter((ch) => {
        const sd = snap.signalQuality[chNames[ch]];
        return sd >= 0.5 && sd <= 75.0;
      });
      const useIdx = activeIndices.length > 0 ? activeIndices : [0, 1, 2, 3];

      const avg = (key) =>
        useIdx.reduce((acc, idx) => acc + bandsPerCh[idx][key], 0) / useIdx.length;

      snap.deltaAbs = Number(avg('delta').toFixed(3));
      snap.thetaAbs = Number(avg('theta').toFixed(3));
      snap.alphaAbs = Number(avg('alpha').toFixed(3));
      snap.betaAbs = Number(avg('beta').toFixed(3));
      snap.gammaAbs = Number(avg('gamma').toFixed(3));

      snap.deltaRel = Number(avg('deltaRel').toFixed(4));
      snap.thetaRel = Number(avg('thetaRel').toFixed(4));
      snap.alphaRel = Number(avg('alphaRel').toFixed(4));
      snap.betaRel = Number(avg('betaRel').toFixed(4));
      snap.gammaRel = Number(avg('gammaRel').toFixed(4));

      // Focus Index: Beta_rel / (Alpha_rel + Theta_rel)
      const focusDenom = Math.max(0.01, snap.alphaRel + snap.thetaRel);
      snap.focusIndex = Number((snap.betaRel / focusDenom).toFixed(4));

      // Calm Index: Alpha_rel / Theta_rel
      snap.calmIndex = Number((snap.alphaRel / Math.max(0.01, snap.thetaRel)).toFixed(4));

      // Frontal Alpha Asymmetry: ln(Alpha_AF8) - ln(Alpha_AF7)
      const alphaAF7 = Math.max(1e-6, bandsPerCh[1].alpha);
      const alphaAF8 = Math.max(1e-6, bandsPerCh[2].alpha);
      snap.frontalAlphaAsymmetry = Number(Math.log(alphaAF8 / alphaAF7).toFixed(4));

      if (!artifactDetected) {
        snap.alphaZ = Number(this.updateWelford(this.rollingStats.alphaRel, snap.alphaRel).toFixed(3));
        snap.focusZ = Number(this.updateWelford(this.rollingStats.focus, snap.focusIndex).toFixed(3));
      }
    }

    // 2. Optical Hemodynamics (Modified Beer-Lambert Law: ΔHbO2, ΔHHb, ΔHbT)
    if (this.opticsBaseline.calibrationSamples > 0 && this.opticsLowPass.left730 !== null) {
      snap.opticsReady = true;
      const leftHemo = solveMbllHemoglobin(
        this.opticsLowPass.left730,
        this.opticsLowPass.left850,
        this.opticsBaseline.left730,
        this.opticsBaseline.left850
      );
      const rightHemo = solveMbllHemoglobin(
        this.opticsLowPass.right730,
        this.opticsLowPass.right850,
        this.opticsBaseline.right730,
        this.opticsBaseline.right850
      );

      snap.leftHbO2 = leftHemo.hbO2;
      snap.leftHHb = leftHemo.hhb;
      snap.leftHbT = leftHemo.hbt;

      snap.rightHbO2 = rightHemo.hbO2;
      snap.rightHHb = rightHemo.hhb;
      snap.rightHbT = rightHemo.hbt;

      snap.hbO2 = Number((0.5 * (leftHemo.hbO2 + rightHemo.hbO2)).toFixed(4));
      snap.hhb = Number((0.5 * (leftHemo.hhb + rightHemo.hhb)).toFixed(4));
      snap.hbt = Number((0.5 * (leftHemo.hbt + rightHemo.hbt)).toFixed(4));
    }

    // 3. Cardiovascular Metrics (Heart Rate BPM & HRV RMSSD from 64 Hz PPG)
    if (this.ppgFilteredBuffer.length > 0) {
      const latestPpg = this.ppgFilteredBuffer[this.ppgFilteredBuffer.length - 1].val;
      snap.ppgWave = Number((latestPpg * 1000).toFixed(3));
    }

    if (this.ibiHistoryMs.length >= 3) {
      // Filter IBIs within 25% of median IBI for clean HR & RMSSD
      const medIbi = median(this.ibiHistoryMs);
      const cleanIbis = this.ibiHistoryMs.filter(
        (ibi) => Math.abs(ibi - medIbi) <= 0.28 * medIbi
      );
      const activeIbis = cleanIbis.length >= 2 ? cleanIbis : this.ibiHistoryMs;
      const finalMedIbi = median(activeIbis);

      if (finalMedIbi > 0) {
        snap.heartRateBpm = Number((60000 / finalMedIbi).toFixed(1));
      }

      // Compute RMSSD across successive clean IBIs
      if (activeIbis.length >= 3) {
        let sumSqDiff = 0;
        let countDiff = 0;
        for (let i = 1; i < activeIbis.length; i++) {
          const diff = activeIbis[i] - activeIbis[i - 1];
          if (Math.abs(diff) < 250) {
            sumSqDiff += diff * diff;
            countDiff += 1;
          }
        }
        if (countDiff >= 2) {
          snap.hrvRmssdMs = Number(Math.sqrt(sumSqDiff / countDiff).toFixed(1));
        }
      }
      snap.hrConfidence = Number(Math.min(1.0, activeIbis.length / 10).toFixed(2));
      this.updateWelford(this.rollingStats.hr, snap.heartRateBpm);
    }

    // 4. Head Motion & Stillness (IMU)
    if (this.gyroBuffer.length > 0) {
      let sq = 0;
      for (const g of this.gyroBuffer) sq += g * g;
      const rmsGyro = Math.sqrt(sq / this.gyroBuffer.length);
      snap.headAngularVelocityDegS = Number(rmsGyro.toFixed(2));
      // 0 deg/s -> 100% stillness; >= 25 deg/s -> 0% stillness
      const stillness = Math.max(0, Math.min(100, 100 - rmsGyro * 4));
      snap.stillnessScore = Math.round(stillness);
    }

    // 5. Automated Physiological State Tags
    const tags = [];
    if (snap.eegReady && !snap.signalQuality.eegArtifact) {
      if (snap.focusZ > 0.75 || snap.focusIndex > 0.75) {
        tags.push('high_focus');
      }
      if (snap.alphaZ > 0.75 || snap.alphaRel > 0.34) {
        tags.push('high_alpha_calm');
      }
      if (snap.thetaRel > 0.30 && snap.hbO2 > 0.15) {
        tags.push('deep_cognitive_load');
      }
      if (snap.frontalAlphaAsymmetry > 0.15) {
        tags.push('approach_valence');
      } else if (snap.frontalAlphaAsymmetry < -0.15) {
        tags.push('withdrawal_strain');
      }
    }
    if (snap.opticsReady) {
      if (snap.hbO2 > 0.25 && snap.hbO2 > snap.hhb) {
        tags.push('prefrontal_oxygenation_surge');
      }
      if (
        this.rollingStats.hr.n > 15 &&
        snap.heartRateBpm > this.rollingStats.hr.mean + 6
      ) {
        tags.push('elevated_hr');
      }
      if (snap.hrvRmssdMs >= 45) {
        tags.push('high_vagal_hrv');
      }
    }
    if (snap.stillnessScore < 65) {
      tags.push('head_movement');
    }
    if (snap.signalQuality.eegArtifact) {
      tags.push('eeg_artifact');
    }
    snap.stateTags = tags;

    this.latestSnapshot = snap;
    return snap;
  }
}
