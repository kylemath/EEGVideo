/**
 * Scene change detection helpers for video and audio.
 */

/**
 * Compute frame difference (mean absolute difference) between two ImageData.
 * @param {ImageData} a
 * @param {ImageData} b
 * @returns {number}
 */
export function frameDifference(a, b) {
  if (!a || !b || a.data.length !== b.data.length) return 0;
  let sum = 0;
  const step = 4;
  for (let i = 0; i < a.data.length; i += step) {
    sum += Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]);
  }
  return sum / (a.data.length / step);
}

/**
 * Detect scene changes from canvas frame captures.
 * @param {HTMLCanvasElement} canvas
 * @param {number} threshold - Above this diff, consider a scene change
 * @returns {(current: ImageData) => boolean}
 */
export function createVideoSceneDetector(canvas, threshold = 50) {
  let prev = null;
  return (current) => {
    if (!prev) {
      prev = current;
      return false;
    }
    const diff = frameDifference(prev, current);
    prev = current;
    return diff > threshold;
  };
}

/**
 * Compute RMS of audio samples.
 * @param {Float32Array} samples
 * @returns {number}
 */
export function audioRms(samples) {
  if (!samples || samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i] * samples[i];
  }
  return Math.sqrt(sum / samples.length);
}
