import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Play, Pause, X, Check, AlertCircle, Loader2 } from 'lucide-react';
import type { Playlist, Track, Settings, ServerStatus } from './types';
import { fetchPlaylist, startDownload, getServerStatus, getDownloadProgress, pauseDownload, resumeDownload, cancelDownload, retryTrack, skipTrack } from './api';

function App() {
  const [playlistUrl, setPlaylistUrl] = useState('');
  const [playlist, setPlaylist] = useState<Playlist | null>(null);
  const [settings, setSettings] = useState<Settings>({
    outputDir: '~/Music/Downloads',
    audioFormat: 'mp3',
    audioQuality: '320',
    tidalApiKey: '',
    tidalApiSecret: '',
    tidalAccessToken: '',
    tidalUserId: '',
    embedMetadata: true,
    embedThumbnail: true,
    namingTemplate: '{artist} - {title}',
  });
  const [serverStatus, setServerStatus] = useState<ServerStatus | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [filter, setFilter] = useState<'all' | 'pending' | 'completed' | 'error'>('all');

  const checkServerStatus = useCallback(async () => {
    try {
      const status = await getServerStatus();
      setServerStatus(status);
    } catch {
      setServerStatus({
        connected: false,
        ytDlpInstalled: false,
        ytDlpVersion: '',
        ffmpegInstalled: false,
        downloadDir: '',
        activeDownloads: 0,
      });
    }
  }, []);

  useEffect(() => {
    checkServerStatus();
    const interval = setInterval(checkServerStatus, 10000);
    return () => clearInterval(interval);
  }, [checkServerStatus]);

  useEffect(() => {
    if (!jobId || !isDownloading || isPaused) return;
    const interval = setInterval(async () => {
      try {
        const progress = await getDownloadProgress(jobId);
        if (playlist) {
          setPlaylist(prev => prev ? { ...prev, tracks: progress.tracks, status: progress.status as Playlist['status'] } : null);
        }
        if (progress.status === 'completed') {
          setIsDownloading(false);
        }
      } catch {
        // ignore
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [jobId, isDownloading, isPaused, playlist]);

  const handleFetchPlaylist = async () => {
    if (!playlistUrl.trim()) return;
    setIsLoading(true);
    setError(null);
    try {
      const result = await fetchPlaylist(playlistUrl, settings);
      setPlaylist(result);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to fetch playlist. Make sure the backend server is running.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleStartDownload = async () => {
    if (!playlist) return;
    setIsDownloading(true);
    setIsPaused(false);
    setError(null);
    try {
      const result = await startDownload(playlist.id, settings);
      setJobId(result.jobId);
      setPlaylist(prev => prev ? { ...prev, status: 'downloading' } : null);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to start download');
      setIsDownloading(false);
    }
  };

  const handlePause = async () => {
    if (!jobId) return;
    try {
      await pauseDownload(jobId);
      setIsPaused(true);
    } catch {
      // ignore
    }
  };

  const handleResume = async () => {
    if (!jobId) return;
    try {
      await resumeDownload(jobId);
      setIsPaused(false);
    } catch {
      // ignore
    }
  };

  const handleCancel = async () => {
    if (!jobId) return;
    try {
      await cancelDownload(jobId);
      setIsDownloading(false);
      setIsPaused(false);
      setJobId(null);
    } catch {
      // ignore
    }
  };

  const handleRetryTrack = async (trackId: string) => {
    if (!jobId) return;
    try {
      await retryTrack(trackId, jobId);
    } catch {
      // ignore
    }
  };

  const handleSkipTrack = async (trackId: string) => {
    if (!jobId) return;
    try {
      await skipTrack(trackId, jobId);
    } catch {
      // ignore
    }
  };

  const filteredTracks = playlist?.tracks.filter(t => {
    if (filter === 'all') return true;
    if (filter === 'pending') return t.status === 'pending' || t.status === 'searching';
    if (filter === 'completed') return t.status === 'completed';
    if (filter === 'error') return t.status === 'error';
    return true;
  }) || [];

  const completedCount = playlist?.tracks.filter(t => t.status === 'completed').length || 0;
  const errorCount = playlist?.tracks.filter(t => t.status === 'error').length || 0;
  const progressPercent = playlist ? Math.round((completedCount / playlist.tracks.length) * 100) : 0;

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-[#33ff33] crt-effect">
      {/* Header */}
      <header className="border-b border-[#1a3a1a]">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <pre className="text-xs glow-strong leading-tight">
{`╔══════════════════════════════════════════╗
║  PLAYLIST RIPPER v1.0                    ║
║  YouTube Music & Tidal Audio Downloader  ║
╚══════════════════════════════════════════╝`}
              </pre>
            </div>
            <div className="flex items-center gap-4">
              <ServerStatusBadge status={serverStatus} />
              <button
                onClick={() => setShowSettings(!showSettings)}
                className="ascii-btn px-3 py-1 text-xs"
              >
                [SETTINGS]
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        {/* Server Warning */}
        {serverStatus && !serverStatus.connected && (
          <div className="ascii-border border-[#ffaa00] bg-[#1a1a0a] p-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-[#ffaa00] flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-[#ffaa00] font-bold">⚠ WARNING: Backend server not connected</p>
                <p className="text-[#aa7700] text-sm mt-1">
                  Make sure the backend server is running on port 3001.<br/>
                  Run: <code className="bg-[#1a1a0a] px-2 py-0.5 border border-[#aa7700]">npm run server</code>
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Settings Panel */}
        {showSettings && (
          <SettingsPanel settings={settings} setSettings={setSettings} />
        )}

        {/* Playlist Input */}
        <div className="ascii-border p-4">
          <pre className="text-xs mb-3 glow">
{`┌──────────────────────────────────────────┐
│  IMPORT PLAYLIST                         │
└──────────────────────────────────────────┘`}
          </pre>
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1">
              <input
                type="text"
                value={playlistUrl}
                onChange={(e) => setPlaylistUrl(e.target.value)}
                placeholder="Paste YouTube Music or Tidal playlist URL..."
                className="w-full px-3 py-2 ascii-input text-sm"
                onKeyDown={(e) => e.key === 'Enter' && handleFetchPlaylist()}
              />
            </div>
            <button
              onClick={handleFetchPlaylist}
              disabled={isLoading || !playlistUrl.trim()}
              className="ascii-btn px-6 py-2 text-sm flex items-center gap-2"
            >
              {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {isLoading ? '[FETCHING...]' : '[FETCH PLAYLIST]'}
            </button>
          </div>
          <div className="mt-3 text-xs text-[#1a3a1a]">
            <span>SUPPORTED:</span>
            <span className="ml-2">YouTube Music</span>
            <span className="ml-2">•</span>
            <span className="ml-2">Tidal</span>
            <span className="ml-2">•</span>
            <span className="ml-2">YouTube</span>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="ascii-border border-[#ff3333] bg-[#1a0a0a] p-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-[#ff3333] flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-[#ff3333]">ERROR: {error}</p>
              </div>
              <button onClick={() => setError(null)} className="text-[#ff3333] hover:text-[#ff6666]">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Playlist Content */}
        {playlist && (
          <div className="ascii-border">
            {/* Playlist Header */}
            <div className="p-4 border-b border-[#1a3a1a]">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h3 className="text-lg font-bold glow">{playlist.title}</h3>
                  <p className="text-xs text-[#1a3a1a] mt-1">
                    {playlist.tracks.length} tracks • Source: {playlist.source === 'youtube' ? 'YouTube Music' : 'Tidal'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {!isDownloading ? (
                    <button
                      onClick={handleStartDownload}
                      className="ascii-btn px-4 py-2 text-xs flex items-center gap-2"
                    >
                      <Play className="w-4 h-4" />
                      [DOWNLOAD ALL]
                    </button>
                  ) : (
                    <>
                      {isPaused ? (
                        <button onClick={handleResume} className="ascii-btn px-4 py-2 text-xs flex items-center gap-2">
                          <Play className="w-4 h-4" /> [RESUME]
                        </button>
                      ) : (
                        <button onClick={handlePause} className="ascii-btn px-4 py-2 text-xs flex items-center gap-2">
                          <Pause className="w-4 h-4" /> [PAUSE]
                        </button>
                      )}
                      <button onClick={handleCancel} className="ascii-btn px-4 py-2 text-xs flex items-center gap-2 border-[#ff3333] text-[#ff3333] hover:bg-[#ff3333] hover:text-[#0a0a0a]">
                        <X className="w-4 h-4" /> [CANCEL]
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Progress Bar */}
              {(isDownloading || completedCount > 0) && (
                <div className="mt-4">
                  <div className="flex items-center justify-between text-xs mb-2">
                    <span className="text-[#1a3a1a]">
                      PROGRESS: {completedCount} / {playlist.tracks.length}
                      {errorCount > 0 && <span className="text-[#ff3333] ml-2">({errorCount} ERRORS)</span>}
                    </span>
                    <span className="text-[#33ff33] font-bold glow">{progressPercent}%</span>
                  </div>
                  <div className="w-full h-4 bg-[#0a0a0a] border border-[#1a3a1a] overflow-hidden font-mono">
                    <div className="h-full flex items-center justify-center text-xs">
                      <div
                        className="h-full bg-[#33ff33] transition-all duration-500 flex items-center justify-center text-[#0a0a0a] font-bold"
                        style={{ width: `${progressPercent}%` }}
                      >
                        {progressPercent > 10 && '█'.repeat(Math.floor(progressPercent / 5))}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Filter Tabs */}
            <div className="px-4 pt-3 flex gap-2 border-b border-[#1a3a1a]">
              {(['all', 'pending', 'completed', 'error'] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-3 py-1 text-xs transition-colors ${
                    filter === f
                      ? 'bg-[#33ff33] text-[#0a0a0a] border border-[#33ff33]'
                      : 'bg-transparent text-[#1a3a1a] hover:text-[#33ff33] border border-[#1a3a1a] hover:border-[#33ff33]'
                  }`}
                >
                  [{f.toUpperCase()}]
                  {f === 'all' && ` (${playlist.tracks.length})`}
                  {f === 'pending' && ` (${playlist.tracks.filter(t => t.status === 'pending' || t.status === 'searching').length})`}
                  {f === 'completed' && ` (${completedCount})`}
                  {f === 'error' && ` (${errorCount})`}
                </button>
              ))}
            </div>

            {/* Track List */}
            <div className="p-2 max-h-[600px] overflow-y-auto">
              {filteredTracks.map((track, index) => (
                <TrackRow
                  key={track.id}
                  track={track}
                  index={index + 1}
                  onRetry={handleRetryTrack}
                  onSkip={handleSkipTrack}
                  isDownloading={isDownloading}
                />
              ))}
              {filteredTracks.length === 0 && (
                <div className="text-center py-8 text-[#1a3a1a]">
                  No tracks match the current filter
                </div>
              )}
            </div>
          </div>
        )}

        {/* Empty State */}
        {!playlist && !isLoading && (
          <div className="text-center py-16">
            <pre className="text-[#1a3a1a] text-xs inline-block">
{`
╔══════════════════════════════════════════╗
║                                          ║
║         NO PLAYLIST LOADED               ║
║                                          ║
║    Paste a YouTube Music or Tidal        ║
║    playlist URL above to get started     ║
║                                          ║
╚══════════════════════════════════════════╝
`}
            </pre>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-[#1a3a1a] mt-12 py-4">
        <div className="max-w-7xl mx-auto px-4 text-center text-xs text-[#1a3a1a]">
          <pre className="inline-block">
{`═══════════════════════════════════════════════════════════
Playlist Ripper v1.0 | Arch Linux / CachyOS | MIT License
═══════════════════════════════════════════════════════════`}
          </pre>
        </div>
      </footer>
    </div>
  );
}

function TrackRow({ track, index, onRetry, onSkip, isDownloading }: {
  track: Track;
  index: number;
  onRetry: (id: string) => void;
  onSkip: (id: string) => void;
  isDownloading: boolean;
}) {
  const statusConfig = {
    pending: { icon: null, color: 'text-[#1a3a1a]', bg: '' },
    searching: { icon: <Loader2 className="w-3 h-3 animate-spin" />, color: 'text-[#33aaff]', bg: 'bg-[#0a1a2a]' },
    downloading: { icon: <Loader2 className="w-3 h-3 animate-spin" />, color: 'text-[#33ff33]', bg: 'bg-[#0a1a0a]' },
    completed: { icon: <Check className="w-3 h-3" />, color: 'text-[#33ff33]', bg: 'bg-[#0a1a0a]' },
    error: { icon: <AlertCircle className="w-3 h-3" />, color: 'text-[#ff3333]', bg: 'bg-[#1a0a0a]' },
    skipped: { icon: <X className="w-3 h-3" />, color: 'text-[#1a3a1a]', bg: '' },
  };

  const config = statusConfig[track.status];

  return (
    <div className={`flex items-center gap-2 px-2 py-1.5 border-b border-[#0d1a0d] hover:bg-[#0d1a0d] group ${config.bg}`}>
      <span className="text-xs text-[#1a3a1a] w-8 text-right font-mono">{String(index).padStart(3, '0')}</span>
      
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium truncate">{track.title}</p>
        <p className="text-[10px] text-[#1a3a1a] truncate">{track.artist}</p>
      </div>

      {/* Progress bar for downloading */}
      {track.status === 'downloading' && (
        <div className="w-16 h-2 bg-[#0a0a0a] border border-[#1a3a1a] overflow-hidden">
          <div
            className="h-full bg-[#33ff33] transition-all"
            style={{ width: `${track.progress}%` }}
          />
        </div>
      )}

      {/* Status */}
      <div className={`flex items-center gap-1 ${config.color}`}>
        {config.icon}
        <span className="text-[10px] uppercase hidden sm:inline">{track.status}</span>
      </div>

      {/* Actions */}
      {track.status === 'error' && isDownloading && (
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={() => onRetry(track.id)}
            className="p-1 hover:bg-[#1a3a1a] text-[#33aaff]"
            title="Retry"
          >
            <RefreshCw className="w-3 h-3" />
          </button>
          <button
            onClick={() => onSkip(track.id)}
            className="p-1 hover:bg-[#1a3a1a] text-[#1a3a1a]"
            title="Skip"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}
    </div>
  );
}

function ServerStatusBadge({ status }: { status: ServerStatus | null }) {
  if (!status) return null;
  
  return (
    <div className={`flex items-center gap-2 px-2 py-1 text-xs border ${
      status.connected ? 'border-[#33ff33] text-[#33ff33]' : 'border-[#ff3333] text-[#ff3333]'
    }`}>
      <div className={`w-2 h-2 ${status.connected ? 'bg-[#33ff33] blink' : 'bg-[#ff3333]'}`} />
      <span>{status.connected ? 'SERVER ONLINE' : 'SERVER OFFLINE'}</span>
    </div>
  );
}

function SettingsPanel({ settings, setSettings }: { settings: Settings; setSettings: (s: Settings) => void }) {
  return (
    <div className="ascii-border p-4">
      <pre className="text-xs mb-4 glow">
{`┌──────────────────────────────────────────┐
│  SETTINGS                                │
└──────────────────────────────────────────┘`}
      </pre>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs text-[#1a3a1a] mb-1">OUTPUT DIRECTORY:</label>
          <input
            type="text"
            value={settings.outputDir}
            onChange={(e) => setSettings({ ...settings, outputDir: e.target.value })}
            className="w-full px-3 py-2 ascii-input text-xs"
          />
        </div>
        
        <div>
          <label className="block text-xs text-[#1a3a1a] mb-1">AUDIO FORMAT:</label>
          <select
            value={settings.audioFormat}
            onChange={(e) => setSettings({ ...settings, audioFormat: e.target.value as Settings['audioFormat'] })}
            className="w-full px-3 py-2 ascii-input text-xs"
          >
            <option value="mp3">MP3</option>
            <option value="flac">FLAC</option>
            <option value="opus">OPUS</option>
            <option value="m4a">M4A (AAC)</option>
          </select>
        </div>
        
        <div>
          <label className="block text-xs text-[#1a3a1a] mb-1">AUDIO QUALITY (KBPS):</label>
          <select
            value={settings.audioQuality}
            onChange={(e) => setSettings({ ...settings, audioQuality: e.target.value })}
            className="w-full px-3 py-2 ascii-input text-xs"
          >
            <option value="128">128 KBPS</option>
            <option value="192">192 KBPS</option>
            <option value="256">256 KBPS</option>
            <option value="320">320 KBPS</option>
            <option value="0">BEST AVAILABLE</option>
          </select>
        </div>

        <div>
          <label className="block text-xs text-[#1a3a1a] mb-1">NAMING TEMPLATE:</label>
          <input
            type="text"
            value={settings.namingTemplate}
            onChange={(e) => setSettings({ ...settings, namingTemplate: e.target.value })}
            placeholder="{artist} - {title}"
            className="w-full px-3 py-2 ascii-input text-xs"
          />
        </div>

        <div className="md:col-span-2">
          <pre className="text-xs text-[#33ff33] mb-2 glow">
{`┌─ TIDAL API CREDENTIALS ─────────────────┐`}
          </pre>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] text-[#1a3a1a] mb-1">API KEY:</label>
              <input
                type="password"
                value={settings.tidalApiKey}
                onChange={(e) => setSettings({ ...settings, tidalApiKey: e.target.value })}
                className="w-full px-3 py-2 ascii-input text-xs"
              />
            </div>
            <div>
              <label className="block text-[10px] text-[#1a3a1a] mb-1">API SECRET:</label>
              <input
                type="password"
                value={settings.tidalApiSecret}
                onChange={(e) => setSettings({ ...settings, tidalApiSecret: e.target.value })}
                className="w-full px-3 py-2 ascii-input text-xs"
              />
            </div>
            <div>
              <label className="block text-[10px] text-[#1a3a1a] mb-1">ACCESS TOKEN:</label>
              <input
                type="password"
                value={settings.tidalAccessToken}
                onChange={(e) => setSettings({ ...settings, tidalAccessToken: e.target.value })}
                className="w-full px-3 py-2 ascii-input text-xs"
              />
            </div>
            <div>
              <label className="block text-[10px] text-[#1a3a1a] mb-1">USER ID:</label>
              <input
                type="text"
                value={settings.tidalUserId}
                onChange={(e) => setSettings({ ...settings, tidalUserId: e.target.value })}
                className="w-full px-3 py-2 ascii-input text-xs"
              />
            </div>
          </div>
        </div>

        <div className="md:col-span-2 flex items-center gap-6">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.embedMetadata}
              onChange={(e) => setSettings({ ...settings, embedMetadata: e.target.checked })}
            />
            <span className="text-xs text-[#33ff33]">EMBED METADATA</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.embedThumbnail}
              onChange={(e) => setSettings({ ...settings, embedThumbnail: e.target.checked })}
            />
            <span className="text-xs text-[#33ff33]">EMBED THUMBNAIL</span>
          </label>
        </div>
      </div>
    </div>
  );
}

export default App;
