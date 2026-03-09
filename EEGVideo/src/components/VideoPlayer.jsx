import { useRef, useState, useCallback } from 'react';
import { onVideoFrame, getFirstFrameTiming } from '../utils/videoTiming.js';
import {
  createCombinedFileHeader,
  formatCombinedEegRow,
  formatCombinedMarkerRow,
} from '../utils/dataFormat.js';
import { zipSamples } from 'muse-js';
import { FRAME_MARKER_INTERVAL, AUDIO_MARKER_INTERVAL } from '../config/constants.js';

export default function VideoPlayer({ mode, museClient, videoUrl, onVideoUrlChange, importedMarkers = [] }) {
  const videoRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [recording, setRecording] = useState(false);
  const eegDataRef = useRef([]);
  const markersRef = useRef([]);
  const startTimeRef = useRef(null);
  const lastFrameRef = useRef(0);
  const audioSampleCountRef = useRef(0);
  const cleanupRef = useRef(null);

  const startRecording = useCallback(() => {
    if (!museClient?.eegReadings || !videoRef.current) return;
    const video = videoRef.current;
    startTimeRef.current = performance.now() / 1000;
    eegDataRef.current = [];
    markersRef.current = [];

    const addMarker = (type, mediaTime, desc) => {
      const perfTime = performance.now() / 1000;
      const timestamp = perfTime - startTimeRef.current;
      markersRef.current.push({
        timestamp,
        type: 'marker',
        markerType: type,
        mediaTime,
        performanceTime: perfTime,
        description: desc,
      });
    };

    importedMarkers.forEach((m) => {
      addMarker('semantic', m.time, m.label || m.type || '');
    });
    addMarker('button_press', 0, '');

    const eegStream = zipSamples(museClient.eegReadings);
    const eegSub = eegStream.subscribe((s) => {
      if (!s?.data) return;
      const t = (performance.now() / 1000) - startTimeRef.current;
      const ch = [s.data[0], s.data[1], s.data[2], s.data[3]].map((v) => (Number.isNaN(v) ? 0 : v));
      eegDataRef.current.push({
        timestamp: t,
        type: 'eeg',
        uncorrectedTime: t,
        correctedTime: t,
        channelValues: ch,
      });
    });

    const frameCleanup = onVideoFrame(video, (now, metadata) => {
      const frame = metadata.presentedFrames ?? Math.floor(video.currentTime * 30);
      if (frame % FRAME_MARKER_INTERVAL === 0 && frame !== lastFrameRef.current) {
        lastFrameRef.current = frame;
        addMarker('frame', video.currentTime, `frame_${frame}`);
      }
    });

    video.play().then(() => {
      getFirstFrameTiming(video).then(({ mediaTime }) => {
        addMarker('video_start', mediaTime, '');
      });
    });

    const stopRecording = () => {
      video.pause();
      eegSub.unsubscribe();
      frameCleanup?.();

      const startTime = new Date().toISOString();
      const header = createCombinedFileHeader(startTime);

      const allRows = [...eegDataRef.current, ...markersRef.current].sort((a, b) => a.timestamp - b.timestamp);

      const body = allRows
        .map((r) => {
          if (r.type === 'eeg') {
            return formatCombinedEegRow(r.timestamp, r.uncorrectedTime, r.correctedTime, r.channelValues);
          }
          return formatCombinedMarkerRow(r.timestamp, r.markerType, r.mediaTime, r.performanceTime, r.description);
        })
        .join('');

      const content = header + body;
      const blob = new Blob([content], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `eeg_markers_${Date.now()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      setRecording(false);
    };

    cleanupRef.current = stopRecording;
    setRecording(true);
  }, [museClient]);

  const handlePlay = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !videoUrl) return;

    if (mode === 'record' && museClient) {
      startRecording();
      return;
    }

    await video.play();
    setPlaying(true);
  }, [mode, museClient, videoUrl, startRecording]);

  const handlePause = useCallback(() => {
    videoRef.current?.pause();
    setPlaying(false);
    if (recording && cleanupRef.current) {
      cleanupRef.current();
    }
  }, [recording]);

  return (
    <div className="section">
      <div className="section-title">Video</div>
      <div style={{ marginBottom: '12px' }}>
        <input
          type="text"
          placeholder="Video URL or path (e.g. /sample.mp4)"
          value={videoUrl}
          onChange={(e) => onVideoUrlChange(e.target.value)}
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
            controls
            onPause={() => setPlaying(false)}
            onPlay={() => setPlaying(true)}
            style={{
              width: '100%',
              maxHeight: '400px',
              borderRadius: '8px',
              background: '#000',
            }}
          />
          <div style={{ marginTop: '12px', display: 'flex', gap: '8px' }}>
            <button
              onClick={playing || recording ? handlePause : handlePlay}
              disabled={mode === 'record' && !museClient}
              style={{
                padding: '8px 20px',
                background: recording ? '#da3633' : '#238636',
                color: '#fff',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontWeight: 500,
              }}
            >
              {recording ? 'Stop Recording' : playing ? 'Pause' : 'Start'}
            </button>
            {recording && (
              <span style={{ color: '#f85149', alignSelf: 'center' }}>Recording...</span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
