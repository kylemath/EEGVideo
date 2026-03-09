import { useMemo } from 'react';
import { EEG_CHANNELS } from '../config/constants.js';

/**
 * Electrode positions for Muse 2 (TP9, AF7, AF8, TP10).
 * Approximate 10-20 positions on a top-down head view.
 * cx, cy as percentage of SVG viewBox (0-100).
 */
const ELECTRODE_POSITIONS = {
  TP9: { cx: 15, cy: 55, label: 'TP9' },
  AF7: { cx: 35, cy: 25, label: 'AF7' },
  AF8: { cx: 65, cy: 25, label: 'AF8' },
  TP10: { cx: 85, cy: 55, label: 'TP10' },
};

function qualityToColor(quality) {
  if (!quality) return '#6e7681';
  const { stdDev, isGood } = quality;
  if (isGood) return '#3fb950';
  if (stdDev < 1.5) return '#8b949e';
  return '#f85149';
}

export default function SignalQualityHead({ quality }) {
  const electrodes = useMemo(() => {
    return EEG_CHANNELS.map((ch) => ({
      ...ELECTRODE_POSITIONS[ch],
      channel: ch,
      fill: qualityToColor(quality?.[ch]),
    }));
  }, [quality]);

  return (
    <div className="section">
      <div className="section-title">Signal Quality</div>
      <svg
        viewBox="0 0 100 80"
        style={{ width: '200px', height: '160px' }}
        aria-label="EEG electrode quality"
      >
        <ellipse
          cx="50"
          cy="45"
          rx="42"
          ry="38"
          fill="none"
          stroke="#30363d"
          strokeWidth="2"
        />
        <ellipse
          cx="50"
          cy="38"
          rx="28"
          ry="22"
          fill="none"
          stroke="#30363d"
          strokeWidth="1"
          opacity="0.6"
        />
        {electrodes.map(({ cx, cy, channel, fill, label }) => (
          <g key={channel}>
            <circle
              cx={cx}
              cy={cy}
              r="8"
              fill={fill}
              stroke="#21262d"
              strokeWidth="1"
            />
            <text
              x={cx}
              y={cy + 4}
              textAnchor="middle"
              fontSize="6"
              fill="#8b949e"
            >
              {label}
            </text>
          </g>
        ))}
      </svg>
      <div style={{ display: 'flex', gap: '16px', marginTop: '8px', fontSize: '0.85rem' }}>
        <span style={{ color: '#3fb950' }}>Good</span>
        <span style={{ color: '#8b949e' }}>Low</span>
        <span style={{ color: '#f85149' }}>Noise</span>
      </div>
    </div>
  );
}
