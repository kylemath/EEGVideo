import { useEffect, useRef, useState } from 'react';
import { zipSamples } from 'muse-js';
import { EEG_SAMPLE_RATE, EEG_CHANNELS } from '../config/constants.js';

const CHART_COLORS = ['#3fb950', '#58a6ff', '#d29922', '#f778ba'];
const WINDOW_SAMPLES = EEG_SAMPLE_RATE * 2;

export default function LiveEEGChart({ museClient }) {
  const canvasRef = useRef(null);
  const [buffers, setBuffers] = useState(() =>
    EEG_CHANNELS.map(() => [])
  );
  const subscriptionRef = useRef(null);

  useEffect(() => {
    if (!museClient?.eegReadings) return;

    const buffersRef = { current: EEG_CHANNELS.map(() => []) };
    let rafId = null;

    const stream = zipSamples(museClient.eegReadings);
    const sub = stream.subscribe((sample) => {
      if (!sample?.data) return;
      for (let ch = 0; ch < 4; ch++) {
        const v = sample.data[ch];
        const val = Number.isNaN(v) ? 0 : v;
        const buf = buffersRef.current[ch];
        buf.push(val);
        if (buf.length > WINDOW_SAMPLES) buf.shift();
      }
      if (!rafId) {
        rafId = requestAnimationFrame(() => {
          setBuffers(buffersRef.current.map((b) => [...b]));
          rafId = null;
        });
      }
    });

    subscriptionRef.current = sub;
    return () => {
      sub?.unsubscribe();
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [museClient]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || buffers.every((b) => b.length === 0)) return;

    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;
    const nCh = buffers.length;
    const chHeight = h / nCh;
    const maxLen = Math.max(...buffers.map((b) => b.length), 1);

    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, w, h);

    buffers.forEach((buf, ch) => {
      if (buf.length < 2) return;
      const y0 = ch * chHeight + chHeight / 2;
      const scale = Math.min(50, chHeight / 4);
      ctx.strokeStyle = CHART_COLORS[ch] ?? '#8b949e';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      buf.forEach((v, i) => {
        const x = (i / maxLen) * w;
        const y = y0 - v * scale;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    });
  }, [buffers]);

  if (!museClient) {
    return (
      <div className="section">
        <div className="section-title">Live EEG</div>
        <div
          style={{
            padding: '40px',
            background: '#161b22',
            borderRadius: '8px',
            color: '#8b949e',
            textAlign: 'center',
          }}
        >
          Connect Muse to see live EEG
        </div>
      </div>
    );
  }

  return (
    <div className="section">
      <div className="section-title">Live EEG</div>
      <canvas
        ref={canvasRef}
        style={{
          width: '100%',
          height: '200px',
          background: '#0d1117',
          borderRadius: '8px',
        }}
      />
    </div>
  );
}
