import { useState } from 'react';
import MuseConnect from './components/MuseConnect.jsx';
import SignalQualityHead from './components/SignalQualityHead.jsx';
import LiveEEGChart from './components/LiveEEGChart.jsx';
import VideoPlayer from './components/VideoPlayer.jsx';
import RecordControls from './components/RecordControls.jsx';
import VideoTaggingTab from './components/VideoTaggingTab.jsx';
import './App.css';

export default function App() {
  const [activeTab, setActiveTab] = useState('record');
  const [museClient, setMuseClient] = useState(null);
  const [signalQuality, setSignalQuality] = useState(null);
  const [mode, setMode] = useState('play');
  const [videoUrl, setVideoUrl] = useState('https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4');
  const [importedMarkers, setImportedMarkers] = useState([]);

  return (
    <div className="app">
      <h1>EEGVideo — EEG-Video Sync</h1>

      <div className="tabs">
        <button
          className={`tab ${activeTab === 'record' ? 'active' : ''}`}
          onClick={() => setActiveTab('record')}
        >
          Record
        </button>
        <button
          className={`tab ${activeTab === 'tagging' ? 'active' : ''}`}
          onClick={() => setActiveTab('tagging')}
        >
          Video Tagging
        </button>
      </div>

      <div className="tab-content">
        {activeTab === 'record' && (
          <>
            <div className="section">
              <MuseConnect
                onStreamReady={(client) => setMuseClient(client)}
                onQualityUpdate={(q) => setSignalQuality(q)}
              />
            </div>
            <div className="section">
              <SignalQualityHead quality={signalQuality} />
            </div>
            <div className="section">
              <LiveEEGChart museClient={museClient} />
            </div>
            <div className="section">
              <RecordControls
                mode={mode}
                onModeChange={setMode}
                museConnected={!!museClient}
              />
            </div>
            <div className="section">
              <VideoPlayer
                mode={mode}
                museClient={museClient}
                videoUrl={videoUrl}
                onVideoUrlChange={setVideoUrl}
                importedMarkers={importedMarkers}
              />
            </div>
          </>
        )}
        {activeTab === 'tagging' && (
          <VideoTaggingTab onImportMarkers={(markers) => setImportedMarkers(markers || [])} />
        )}
      </div>
    </div>
  );
}
