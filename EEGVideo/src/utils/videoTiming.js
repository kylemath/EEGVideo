/**
 * Video timing utilities using requestVideoFrameCallback when available.
 * Fallback to timeupdate for Safari.
 */

export function hasRequestVideoFrameCallback() {
  return typeof HTMLVideoElement !== 'undefined' && 'requestVideoFrameCallback' in HTMLVideoElement.prototype;
}

/**
 * Register a callback for each video frame.
 * @param {HTMLVideoElement} video
 * @param {(now: number, metadata: { mediaTime: number, presentedFrames: number }) => void} callback
 * @returns {() => void} Cleanup function
 */
export function onVideoFrame(video, callback) {
  if (!video) return () => {};

  if (hasRequestVideoFrameCallback()) {
    let handle = 0;
    const loop = (now, metadata) => {
      callback(now, metadata);
      handle = video.requestVideoFrameCallback(loop);
    };
    handle = video.requestVideoFrameCallback(loop);
    return () => {
      if (handle && video.cancelVideoFrameCallback) {
        video.cancelVideoFrameCallback(handle);
      }
    };
  }

  const onTimeUpdate = () => {
    callback(performance.now(), {
      mediaTime: video.currentTime,
      presentedFrames: Math.floor(video.currentTime * (video.getVideoPlaybackQuality?.()?.totalVideoFrames || 30)),
    });
  };
  video.addEventListener('timeupdate', onTimeUpdate);
  return () => video.removeEventListener('timeupdate', onTimeUpdate);
}

/**
 * Get the first frame display time (when video actually starts showing).
 * @param {HTMLVideoElement} video
 * @returns {Promise<{ mediaTime: number, performanceTime: number }>}
 */
export function getFirstFrameTiming(video) {
  return new Promise((resolve) => {
    if (!video) {
      resolve({ mediaTime: 0, performanceTime: performance.now() });
      return;
    }

    if (hasRequestVideoFrameCallback()) {
      const handle = video.requestVideoFrameCallback((now, metadata) => {
        if (video.cancelVideoFrameCallback) video.cancelVideoFrameCallback(handle);
        resolve({ mediaTime: metadata.mediaTime ?? video.currentTime, performanceTime: now });
      });
    } else {
      const onCanPlay = () => {
        video.removeEventListener('canplay', onCanPlay);
        resolve({ mediaTime: video.currentTime, performanceTime: performance.now() });
      };
      video.addEventListener('canplay', onCanPlay);
      if (video.readyState >= 2) onCanPlay();
    }
  });
}
