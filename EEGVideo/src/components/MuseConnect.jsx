import { useCallback, useState } from 'react';
import {
  connectMuse,
  disconnectMuse,
  startMuseStreaming,
  getMuseClient,
} from '../streams/museStream.js';
import { eegWithQuality } from '../streams/eegPipes.js';

export default function MuseConnect({ onStreamReady, onQualityUpdate }) {
  const [status, setStatus] = useState('disconnected');
  const [error, setError] = useState(null);
  const [qualitySub, setQualitySub] = useState(null);

  const handleConnect = useCallback(async () => {
    setError(null);
    setStatus('connecting');
    try {
      await connectMuse();
      const client = getMuseClient();
      if (!client || !client.eegReadings) {
        throw new Error('Muse client not ready');
      }

      const qualityStream = eegWithQuality()(client.eegReadings);
      const sub = qualityStream.subscribe({
        next: (batch) => {
          if (batch?.signalQuality) {
            onQualityUpdate?.(batch.signalQuality);
          }
        },
        error: (err) => {
          setError(err?.message || 'Stream error');
        },
      });
      setQualitySub(sub);

      await startMuseStreaming();
      setStatus('connected');
      onStreamReady?.(client);
    } catch (err) {
      setError(err?.message || 'Connection failed');
      setStatus('disconnected');
    }
  }, [onStreamReady, onQualityUpdate]);

  const handleDisconnect = useCallback(async () => {
    if (qualitySub?.unsubscribe) qualitySub.unsubscribe();
    setQualitySub(null);
    await disconnectMuse();
    setStatus('disconnected');
    onStreamReady?.(null);
    onQualityUpdate?.(null);
  }, [qualitySub, onStreamReady, onQualityUpdate]);

  const isConnected = status === 'connected';

  return (
    <div className="section">
      <div className="section-title">Muse Connection</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
        <button
          onClick={isConnected ? handleDisconnect : handleConnect}
          disabled={status === 'connecting'}
          style={{
            padding: '8px 16px',
            background: isConnected ? '#f85149' : '#238636',
            color: '#fff',
            border: 'none',
            borderRadius: '6px',
            cursor: status === 'connecting' ? 'wait' : 'pointer',
            fontWeight: 500,
          }}
        >
          {status === 'connecting' && 'Connecting...'}
          {status === 'disconnected' && !error && 'Connect Muse'}
          {status === 'connected' && 'Disconnect'}
          {error && status === 'disconnected' && 'Retry'}
        </button>
        <span
          style={{
            color:
              status === 'connected'
                ? '#3fb950'
                : status === 'connecting'
                ? '#d29922'
                : '#8b949e',
            fontSize: '0.9rem',
          }}
        >
          {status === 'connecting' && 'Connecting...'}
          {status === 'connected' && 'Connected'}
          {status === 'disconnected' && (error || 'Disconnected')}
        </span>
        {error && (
          <span style={{ color: '#f85149', fontSize: '0.85rem' }}>{error}</span>
        )}
      </div>
      <p style={{ margin: '8px 0 0', fontSize: '0.85rem', color: '#8b949e' }}>
        Serve over HTTPS or localhost. Web Bluetooth required (Chrome, Edge).
      </p>
    </div>
  );
}
