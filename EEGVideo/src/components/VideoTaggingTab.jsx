import { useRef, useState, useCallback, useEffect } from 'react';
import { onVideoFrame } from '../utils/videoTiming.js';
import { createVideoSceneDetector } from '../utils/sceneDetection.js';

const SPEEDS = [0.5, 1, 2];

export default function VideoTaggingTab({ onImportMarkers }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [videoUrl, setVideoUrl] = useState('');
  const [markers, setMarkers] = useState([]);
  const [speed, setSpeed] = useState(1);
  const [playing, setPlaying] = useState(false);

  const addMarker = useCallback((type, label = '') => {
    const video = videoRef.current;
    if (!video) return;
    setMarkers((prev) => [
      ...prev,
      { time: video.currentTime, type, label, id: Date.now() },
    ]);
  }, []);

  const stepFrame = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.pause();
    const fps = 30;
    video.currentTime = Math.min(video.duration, video.currentTime + 1 / fps);
  }, []);

  const stepBackFrame = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.pause();
    const fps = 30;
    video.currentTime = Math.max(0, video.currentTime - 1 / fps);
  }, []);

  const handleExport = useCallback(() => {
    const data = JSON.stringify(markers, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `markers_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [markers]);

  const handleImport = useCallback(() => {
    onImportMarkers?.(markers);
  }, [markers, onImportMarkers]);

  const handleSceneDetect = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const ctx = canvas.getContext('2d');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const detector = createVideoSceneDetector(canvas, 40);
    const newMarkers = [];

    const checkFrame = () => {
      if (video.paused || video.ended) return;
      ctx.drawImage(video, 0, 0);
      const id = ctx.getImageData(0, 0, canvas.width, canvas.height);
      if (detector(id)) {
        newMarkers.push({ time: video.currentTime, type: 'scene', label: 'auto', id: Date.now() + Math.random() });
      }
      requestAnimationFrame(checkFrame);
    };

    video.play();
    checkFrame();
    const stop = () => {
      video.pause();
      setMarkers((prev) => [...prev, ...newMarkers]);
    };
    video.addEventListener('ended', stop, { once: true });
    setTimeout(stop, 10000);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = speed;
  }, [speed]);

  return (
    <div className="section">
      <div className="section-title">Video Tagging</div>
      <p style={{ color: '#8b949e', fontSize: '0.9rem', marginBottom: '16px' }}>
        Add markers, change playback speed, step frame-by-frame. Export markers to import in the Record tab.
      </p>

      <div style={{ marginBottom: '12px' }}>
        <input
          type="text"
          placeholder="Video URL (e.g. /sample.mp4)"
          value={videoUrl}
          onChange={(e) => setVideoUrl(e.target.value)}
          style={{
            width: '100%',
            padding: '8px 12px',
            background: '#161b22',
            border: '1px solid #30363d',
            borderRadius: '6px',
            color: '#e6edf3',
          }}
        />
      </div>

      {videoUrl && (
        <>
          <video
            ref={videoRef}
            src={videoUrl}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            style={{
              width: '100%',
              maxHeight: '360px',
              borderRadius: '8px',
              background: '#000',
            }}
          />
          <canvas ref={canvasRef} style={{ display: 'none' }} />

          <div style={{ display: 'flex', gap: '8px', marginTop: '12px', flexWrap: 'wrap' }}>
            <button
              onClick={() => (playing ? videoRef.current?.pause() : videoRef.current?.play())}
              style={btnStyle}
            >
              {playing ? 'Pause' : 'Play'}
            </button>
            {SPEEDS.map((s) => (
              <button
                key={s}
                onClick={() => setSpeed(s)}
                style={{ ...btnStyle, background: speed === s ? '#238636' : '#21262d' }}
              >
                {s}x
              </button>
            ))}
            <button onClick={stepBackFrame} style={btnStyle}>
              −1 frame
            </button>
            <button onClick={stepFrame} style={btnStyle}>
              +1 frame
            </button>
            <button onClick={() => addMarker('manual', '')} style={btnStyle}>
              Add marker
            </button>
            <button onClick={handleSceneDetect} style={btnStyle}>
              Detect scenes
            </button>
            <button onClick={handleExport} style={btnStyle}>
              Export markers
            </button>
            <button onClick={handleImport} style={btnStyle}>
              Import to Record
            </button>
          </div>

          <div style={{ marginTop: '20px' }}>
            <div className="section-title">Markers ({markers.length})</div>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, maxHeight: '200px', overflow: 'auto' }}>
              {markers.map((m) => (
                <li
                  key={m.id}
                  style={{
                    padding: '6px 8px',
                    background: '#161b22',
                    marginBottom: '4px',
                    borderRadius: '4px',
                    fontSize: '0.9rem',
                  }}
                >
                  {m.type} @ {m.time.toFixed(2)}s {m.label && `(${m.label})`}
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}

const btnStyle = {
  padding: '8px 14px',
  background: '#21262d',
  color: '#fff',
  border: '1px solid #30363d',
  borderRadius: '6px',
  cursor: 'pointer',
  fontSize: '0.9rem',
};
