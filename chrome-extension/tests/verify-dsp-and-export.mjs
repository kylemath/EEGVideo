/**
 * Automated Verification Suite for Muse S Athena Chrome Extension DSP & Export Pipeline.
 */
import assert from 'node:assert/strict';
import {
  unpackLE,
  athenaEegToMicrovolts,
  ATHENA_EEG_MIDPOINT,
} from '../src/ble/museAthenaDecoder.js';
import {
  PhysiologyEngine,
  solveMbllHemoglobin,
} from '../src/dsp/physiologyEngine.js';
import {
  formatPhysioTicksCsv,
  formatComputerEventsCsv,
  buildTarArchive,
} from '../src/storage/sessionDb.js';

console.log('1. Testing Muse S Athena decoder primitives...');
assert.equal(athenaEegToMicrovolts(ATHENA_EEG_MIDPOINT), 0);
const testBytes = new Uint8Array([0xff, 0x3f, 0x00, 0x00]); // 14-bit 16383 followed by 0
const unpacked = unpackLE(testBytes, 0, 2, 14);
assert.equal(unpacked[0], 16383);
assert.equal(unpacked[1], 0);
console.log('   ✓ Athena 14-bit LSB-first unpacking & µV scaling verified.');

console.log('2. Testing Modified Beer-Lambert Law (MBLL) HbO2, HHb, HbT solver...');
const base730 = 250000;
const base850 = 250000;
// Simulate increased oxyhemoglobin (850nm absorbed more strongly -> I_850 drops)
const hemo = solveMbllHemoglobin(base730 * 1.0005, base850 * 0.997, base730, base850);
assert.ok(hemo.hbO2 > 0, `Expected positive ΔHbO2, got ${hemo.hbO2}`);
assert.ok(hemo.hhb < 0, `Expected negative ΔHHb, got ${hemo.hhb}`);
assert.ok(
  Math.abs(hemo.hbt - (hemo.hbO2 + hemo.hhb)) < 1e-3,
  `Expected ΔHbT == ΔHbO2 + ΔHHb, got ${hemo.hbt} vs ${hemo.hbO2 + hemo.hhb}`
);
console.log(`   ✓ MBLL verified: ΔHbO2=${hemo.hbO2} µM, ΔHHb=${hemo.hhb} µM, ΔHbT=${hemo.hbt} µM`);

console.log('3. Testing PhysiologyEngine EEG spectral bands, Focus, Calm, and FAA...');
const engine = new PhysiologyEngine();
// Push 2 seconds (512 samples at 256 Hz) of 10 Hz Alpha-dominant signal with AF8 > AF7
const ch0 = [];
const ch1 = []; // AF7
const ch2 = []; // AF8
const ch3 = [];
for (let i = 0; i < 512; i++) {
  const t = i / 256;
  ch0.push(10 * Math.sin(2 * Math.PI * 10 * t));
  ch1.push(8 * Math.sin(2 * Math.PI * 10 * t));
  ch2.push(14 * Math.sin(2 * Math.PI * 10 * t));
  ch3.push(10 * Math.sin(2 * Math.PI * 10 * t));
}
engine.pushEeg([ch0, ch1, ch2, ch3]);

let snap = engine.computeSnapshot();
assert.equal(snap.eegReady, true);
assert.ok(snap.alphaRel > 0.85, `Expected dominant alphaRel > 0.85, got ${snap.alphaRel}`);
assert.ok(snap.frontalAlphaAsymmetry > 0.5, `Expected positive FAA, got ${snap.frontalAlphaAsymmetry}`);
console.log(
  `   ✓ 10 Hz Alpha test passed: alphaRel=${snap.alphaRel}, calmIndex=${snap.calmIndex}, FAA=${snap.frontalAlphaAsymmetry}`
);

// Now push 512 samples of 20 Hz Beta-dominant signal
const betaCh = [];
for (let i = 0; i < 512; i++) {
  const t = i / 256;
  betaCh.push(12 * Math.sin(2 * Math.PI * 20 * t) + 2 * Math.sin(2 * Math.PI * 10 * t));
}
engine.pushEeg([betaCh, betaCh, betaCh, betaCh]);
snap = engine.computeSnapshot();
assert.ok(snap.betaRel > 0.80, `Expected dominant betaRel > 0.80, got ${snap.betaRel}`);
assert.ok(snap.focusIndex > 4.0, `Expected high focusIndex > 4.0, got ${snap.focusIndex}`);
console.log(`   ✓ 20 Hz Beta test passed: betaRel=${snap.betaRel}, focusIndex=${snap.focusIndex}`);

console.log('4. Testing 64 Hz Optical PPG Heart Rate & HRV + fNIRS stream...');
const startMs = Date.now() - 12000;
const totalOpticsSamples = 64 * 10; // 10 seconds at 64 Hz, simulated 72 BPM (1.2 Hz)
for (let i = 0; i < totalOpticsSamples; i += 4) {
  const chs = [[], [], [], []];
  for (let s = 0; s < 4; s++) {
    const idx = i + s;
    const t = idx / 64;
    const pulse = Math.sin(2 * Math.PI * 1.2 * t);
    const hemoShift = idx > 150 ? 0.0025 : 0; // Step oxygenation increase after baseline
    const i730 = 250000 * Math.exp(-(0.0015 * pulse - 0.0005 * hemoShift));
    const i850 = 250000 * Math.exp(-(0.0025 * pulse + hemoShift));
    chs[0].push(i730);
    chs[1].push(i730);
    chs[2].push(i850);
    chs[3].push(i850);
  }
  engine.pushOptics({
    timestamp: startMs + ((i + 4) * 1000) / 64,
    channelNames: ['LI_730', 'RI_730', 'LI_850', 'RI_850'],
    channels: chs,
  });
}
snap = engine.computeSnapshot();
assert.equal(snap.opticsReady, true);
assert.ok(
  snap.heartRateBpm >= 68 && snap.heartRateBpm <= 76,
  `Expected HR near 72 BPM, got ${snap.heartRateBpm}`
);
assert.ok(snap.hbO2 > 0.2, `Expected positive ΔHbO2 after step, got ${snap.hbO2}`);
console.log(
  `   ✓ 64 Hz PPG & fNIRS verified: HR=${snap.heartRateBpm} BPM, HRV=${snap.hrvRmssdMs} ms, ΔHbO2=${snap.hbO2} µM, ΔHbT=${snap.hbt} µM`
);

console.log('5. Testing CSV & TAR archive exporters...');
const csvPhysio = formatPhysioTicksCsv([
  {
    timestamp: Date.now(),
    sessionTimeMs: 1000,
    sessionId: 'session_test',
    physio: snap,
    activeDomain: 'github.com',
    activeUrl: 'https://github.com/kylemath/EEGVideo',
    activeTitle: 'EEGVideo',
    recentClicks10s: 3,
    recentKeys10s: 18,
    recentScrollPx10s: 420,
    latestScreenshotId: 'shot_00001.jpg',
  },
]);
assert.ok(csvPhysio.includes('hbo2_uM,hhb_uM,hbt_uM'));
assert.ok(csvPhysio.includes('shot_00001.jpg'));

const csvEvents = formatComputerEventsCsv([
  {
    timestamp: Date.now(),
    sessionTimeMs: 1200,
    sessionId: 'session_test',
    eventType: 'click',
    domain: 'github.com',
    url: 'https://github.com/kylemath/EEGVideo',
    pageTitle: 'EEGVideo',
    x: 410,
    y: 220,
    normX: 0.32,
    normY: 0.25,
    tagName: 'button',
    selector: 'div.header > button#run',
    elementText: 'Run Analysis',
    screenshotId: 'shot_00001.jpg',
    physio: snap,
  },
]);
assert.ok(csvEvents.includes('div.header > button#run'));

const tarBytes = buildTarArchive([
  { name: 'physiology_timeseries.csv', bytes: csvPhysio },
  { name: 'computer_use_events.csv', bytes: csvEvents },
]);
assert.ok(tarBytes.byteLength >= 2048 && tarBytes.byteLength % 512 === 0);
console.log(`   ✓ CSV & POSIX TAR bundle builder verified (${tarBytes.byteLength} bytes).`);
console.log('\nALL TESTS PASSED!');
