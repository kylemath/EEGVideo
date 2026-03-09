export default function RecordControls({ mode, onModeChange, museConnected }) {
  return (
    <div className="section">
      <div className="section-title">Recording</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
        <button
          onClick={() => onModeChange('play')}
          disabled={!museConnected}
          style={{
            padding: '8px 16px',
            background: mode === 'play' ? '#238636' : '#21262d',
            color: '#fff',
            border: '1px solid #30363d',
            borderRadius: '6px',
            cursor: museConnected ? 'pointer' : 'not-allowed',
            opacity: museConnected ? 1 : 0.6,
          }}
        >
          Play
        </button>
        <button
          onClick={() => onModeChange('record')}
          disabled={!museConnected}
          style={{
            padding: '8px 16px',
            background: mode === 'record' ? '#da3633' : '#21262d',
            color: '#fff',
            border: '1px solid #30363d',
            borderRadius: '6px',
            cursor: museConnected ? 'pointer' : 'not-allowed',
            opacity: museConnected ? 1 : 0.6,
          }}
        >
          Record
        </button>
        <span style={{ color: '#8b949e', fontSize: '0.9rem' }}>
          {mode === 'play' && 'Live stream — check signal before recording'}
          {mode === 'record' && 'Recording EEG + video markers'}
        </span>
      </div>
    </div>
  );
}
