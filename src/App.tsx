import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Play, Pause, X, Check, AlertCircle, Loader2, ChevronDown, ChevronUp, Eye, EyeOff, ExternalLink } from 'lucide-react';
import type { Playlist, Track, Settings, ServerStatus, DownloadErrorSummary, TidalAuthStatus } from './types';
import { fetchPlaylist, startDownload, getServerStatus, getDownloadProgress, pauseDownload, resumeDownload, cancelDownload, retryTrack, skipTrack, getApiErrorMessage, getSettings, updateSettings, startTidalAuth, openTidalAuthInBrowser, getTidalAuthStatus, disconnectTidal } from './api';

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
    rateLimitEnabled: true,
    ytMinDelayMs: 1500,
    ytMaxDelayMs: 4000,
    ytMaxRetries: 3,
    cookieSource: 'none' as 'none' | 'file' | 'browser',
    cookieFile: '',
    cookieBrowser: '',
  });
  const [tidalStatus, setTidalStatus] = useState<TidalAuthStatus | null>(null);
  const [serverStatus, setServerStatus] = useState<ServerStatus | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloadSummary, setDownloadSummary] = useState<DownloadErrorSummary | null>(null);
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

  // Load saved settings + Tidal connection state from the server on startup
  useEffect(() => {
    (async () => {
      try {
        const saved = await getSettings();
        setSettings(prev => ({ ...prev, ...saved }));
      } catch {
        // server offline — keep defaults
      }
      try {
        setTidalStatus(await getTidalAuthStatus());
      } catch {
        // ignore
      }
    })();
  }, []);

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
          if (progress.errorSummary) {
            setDownloadSummary(progress.errorSummary);
          } else {
            setDownloadSummary(null);
          }
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
      setError(getApiErrorMessage(err, 'Failed to fetch playlist. Make sure the backend server is running on port 3001 (npm run server).'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleStartDownload = async () => {
    if (!playlist) return;
    setIsDownloading(true);
    setIsPaused(false);
    setError(null);
    setDownloadSummary(null);
    try {
      const result = await startDownload(playlist.id, settings);
      setJobId(result.jobId);
      setPlaylist(prev => prev ? { ...prev, status: 'downloading' } : null);
    } catch (err: any) {
      setError(getApiErrorMessage(err, 'Failed to start the download. Make sure the backend server is running on port 3001 (npm run server).'));
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
          <SettingsPanel
            settings={settings}
            setSettings={setSettings}
            tidalStatus={tidalStatus}
            onTidalStatusChange={setTidalStatus}
          />
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

        {/* Download failures summary */}
        {downloadSummary && !isDownloading && (
          <div className="ascii-border border-[#ff3333] bg-[#1a0a0a] p-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-[#ff3333] flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-[#ff3333] font-bold">
                  DOWNLOAD FINISHED WITH ERRORS: {downloadSummary.message}
                </p>
                <p className="text-[#aa5555] text-sm mt-1">{downloadSummary.example}</p>
                <p className="text-[#ffaa00] text-xs mt-2">HINT: {downloadSummary.hint}</p>
              </div>
              <button onClick={() => setDownloadSummary(null)} className="text-[#ff3333] hover:text-[#ff6666]">
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
  const [showErrorDetail, setShowErrorDetail] = useState(false);

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
    <div className={`group border-b border-[#0d1a0d] hover:bg-[#0d1a0d] ${config.bg}`}>
      <div className="flex items-center gap-2 px-2 py-1.5">
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

        {/* Toggle error details */}
        {track.status === 'error' && track.error && (
          <button
            onClick={() => setShowErrorDetail(!showErrorDetail)}
            className="p-1 text-[#ff3333] hover:text-[#ff6666]"
            title={showErrorDetail ? 'Hide error details' : 'Show error details'}
          >
            {showErrorDetail ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
        )}

        {/* Actions */}
        {track.status === 'error' && (
          <div className={`flex items-center gap-1 ${isDownloading ? 'opacity-0 group-hover:opacity-100' : ''} transition-opacity`}>
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

      {/* Expanded error details */}
      {track.status === 'error' && showErrorDetail && track.error && (
        <div className="px-10 pb-2 text-xs space-y-1">
          <p className="text-[#ff3333]">{track.error}</p>
          {track.errorHint && (
            <p className="text-[#ffaa00]">HINT: {track.errorHint}</p>
          )}
          {track.errorDetail && (
            <pre className="text-[10px] text-[#aa5555] whitespace-pre-wrap break-all bg-[#0a0a0a] border border-[#1a3a1a] p-2 max-h-32 overflow-y-auto">
{track.errorDetail}
            </pre>
          )}
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

function SettingsPanel({ settings, setSettings, tidalStatus, onTidalStatusChange }: {
  settings: Settings;
  setSettings: (s: Settings) => void;
  tidalStatus: TidalAuthStatus | null;
  onTidalStatusChange: (s: TidalAuthStatus | null) => void;
}) {
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
          <TidalConnectCard
            settings={settings}
            setSettings={setSettings}
            tidalStatus={tidalStatus}
            onTidalStatusChange={onTidalStatusChange}
          />
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

        <div className="md:col-span-2 ascii-input p-3">
          <pre className="text-[10px] text-[#1a3a1a] mb-2">{'YOUTUBE ANTI-RATE-LIMITING'}</pre>
          <label className="flex items-center gap-2 cursor-pointer mb-3">
            <input
              type="checkbox"
              checked={settings.rateLimitEnabled}
              onChange={(e) => setSettings({ ...settings, rateLimitEnabled: e.target.checked })}
            />
            <span className="text-xs text-[#33ff33]">ENABLE (throttle + backoff retries)</span>
          </label>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-[#1a3a1a] mb-1">MIN DELAY (MS):</label>
              <input
                type="number"
                min={0}
                value={settings.ytMinDelayMs}
                onChange={(e) => setSettings({ ...settings, ytMinDelayMs: Number(e.target.value) || 0 })}
                className="w-full px-3 py-2 ascii-input text-xs"
              />
            </div>
            <div>
              <label className="block text-xs text-[#1a3a1a] mb-1">MAX DELAY (MS):</label>
              <input
                type="number"
                min={0}
                value={settings.ytMaxDelayMs}
                onChange={(e) => setSettings({ ...settings, ytMaxDelayMs: Number(e.target.value) || 0 })}
                className="w-full px-3 py-2 ascii-input text-xs"
              />
            </div>
            <div>
              <label className="block text-xs text-[#1a3a1a] mb-1">MAX RETRIES:</label>
              <input
                type="number"
                min={0}
                value={settings.ytMaxRetries}
                onChange={(e) => setSettings({ ...settings, ytMaxRetries: Number(e.target.value) || 0 })}
                className="w-full px-3 py-2 ascii-input text-xs"
              />
            </div>
          </div>
          <div className="mt-3">
            <label className="block text-xs text-[#1a3a1a] mb-1">COOKIES (OPTIONAL — SIGN-IN RAISES YOUTUBE LIMITS):</label>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-2">
              {(['none', 'file', 'browser'] as const).map((src) => (
                <button
                  key={src}
                  type="button"
                  onClick={() => setSettings({ ...settings, cookieSource: src })}
                  className={`px-3 py-2 ascii-input text-xs uppercase ${
                    settings.cookieSource === src ? 'text-[#33ff33] border border-[#33ff33]' : 'text-[#1a3a1a]'
                  }`}
                >
                  {src === 'none' ? 'None (anonymous)' : src === 'file' ? 'Cookies file' : 'From browser'}
                </button>
              ))}
            </div>
            {settings.cookieSource === 'file' && (
              <input
                type="text"
                value={settings.cookieFile}
                onChange={(e) => setSettings({ ...settings, cookieFile: e.target.value })}
                placeholder="~/.config/ytdlp-cookies.txt (Netscape format)"
                className="w-full px-3 py-2 ascii-input text-xs"
              />
            )}
            {settings.cookieSource === 'browser' && (
              <select
                value={settings.cookieBrowser}
                onChange={(e) => setSettings({ ...settings, cookieBrowser: e.target.value })}
                className="w-full px-3 py-2 ascii-input text-xs"
              >
                <option value="">Select browser…</option>
                {['brave', 'chrome', 'chromium', 'edge', 'firefox', 'opera', 'safari', 'vivaldi'].map((b) => (
                  <option key={b} value={b}>{b.toUpperCase()}</option>
                ))}
              </select>
            )}
            {settings.cookieSource !== 'none' && (
              <CookieValidateButton settings={settings} />
            )}
            <p className="text-[10px] text-[#1a3a1a] mt-1">
              {settings.cookieSource === 'none' && 'Anonymous mode — most likely to be rate limited.'}
              {settings.cookieSource === 'file' && 'Export cookies with a "Get cookies.txt"-style browser extension while signed in to YouTube.'}
              {settings.cookieSource === 'browser' && 'Reads your logged-in session directly from the browser profile (server must run on the same machine as the browser).'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// Test button for the optional cookies configuration (validates file / browser profile).
function CookieValidateButton({ settings }: { settings: Settings }) {
  const [state, setState] = useState<{ busy: boolean; result: { ok: boolean; message: string } | null }>({
    busy: false,
    result: null,
  });

  const validate = async () => {
    setState({ busy: true, result: null });
    try {
      const res = await fetch('/api/cookies/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cookieSource: settings.cookieSource,
          cookieFile: settings.cookieFile,
          cookieBrowser: settings.cookieBrowser,
        }),
      });
      const json = await res.json();
      setState({ busy: false, result: json });
    } catch (err) {
      setState({ busy: false, result: { ok: false, message: `Request failed: ${(err && (err as Error).message) || 'network error'}` } });
    }
  };

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={validate}
        disabled={state.busy}
        className="px-3 py-2 ascii-input text-xs text-[#33ff33] disabled:opacity-50"
      >
        {state.busy ? 'TESTING…' : 'TEST COOKIES'}
      </button>
      {state.result && (
        <p className={`text-[10px] mt-1 ${state.result.ok ? 'text-[#33ff33]' : 'text-[#ff5555]'}`}>
          {state.result.message}
        </p>
      )}
    </div>
  );
}

// ─── Tidal "paste two fields and click connect" card ──────────────────────
function TidalConnectCard({ settings, setSettings, tidalStatus, onTidalStatusChange }: {
  settings: Settings;
  setSettings: (s: Settings) => void;
  tidalStatus: TidalAuthStatus | null;
  onTidalStatusChange: (s: TidalAuthStatus | null) => void;
}) {
  const [showSecret, setShowSecret] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [busyMsg, setBusyMsg] = useState<string | null>(null);
  const [connError, setConnError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [manualAuthUrl, setManualAuthUrl] = useState<string | null>(null);

  const connected = !!tidalStatus?.connected;
  const canConnect = settings.tidalApiKey.trim().length > 0 && settings.tidalApiSecret.trim().length > 0;

  const pollTidalStatus = useCallback(async () => {
    try {
      onTidalStatusChange(await getTidalAuthStatus());
    } catch {
      // server offline
    }
  }, [onTidalStatusChange]);

  useEffect(() => {
    if (!connecting) return;
    const interval = setInterval(pollTidalStatus, 1000);
    return () => clearInterval(interval);
  }, [connecting, pollTidalStatus]);

  const handleSave = async () => {
    setConnError(null);
    setBusyMsg('SAVING...');
    try {
      await updateSettings({ tidalApiKey: settings.tidalApiKey, tidalApiSecret: settings.tidalApiSecret });
      setBusyMsg(null);
    } catch (err: any) {
      setBusyMsg(null);
      setConnError(getApiErrorMessage(err, 'Could not save credentials — is the backend server running?'));
    }
  };

  const handleConnect = async () => {
    setConnError(null);
    setBusyMsg('CONTACTING TIDAL...');
    try {
      // Persist pasted credentials first so the server can exchange the code later.
      await updateSettings({ tidalApiKey: settings.tidalApiKey, tidalApiSecret: settings.tidalApiSecret });
      const { url } = await startTidalAuth(settings.tidalApiKey.trim(), settings.tidalApiSecret.trim());

      // If the UI itself is served from the local backend (http://localhost),
      // open the login in a popup. Otherwise (e.g. hosted HTTPS page) popups
      // back to localhost would be blocked as mixed content — ask the server
      // to open the system's default browser instead.
      const isLocalHttp = ['localhost', '127.0.0.1'].includes(window.location.hostname) && window.location.protocol === 'http:';
      let opened = false;
      if (isLocalHttp) {
        const popup = window.open(url, 'tidal-auth', 'width=520,height=720,menubar=no,toolbar=no');
        opened = !!popup;
        if (!opened) {
          setConnError('The browser blocked the login popup. Please allow popups for this site and try again.');
        }
      } else {
        try {
          await openTidalAuthInBrowser(settings.tidalApiKey.trim(), settings.tidalApiSecret.trim());
          opened = true;
        } catch {
          // Server couldn't launch a browser — fall through to manual link.
        }
        if (!opened) {
          setConnError('Could not open your browser automatically. Copy the URL shown below and open it manually.');
        }
      }

      setManualAuthUrl(url);
      if (opened) {
        setConnecting(true);
        setBusyMsg(isLocalHttp ? 'WAITING FOR TIDAL LOGIN...' : 'CHECK YOUR BROWSER FOR THE TIDAL LOGIN PAGE...');
      } else {
        setBusyMsg(null);
      }
    } catch (err: any) {
      setBusyMsg(null);
      setManualAuthUrl(null);
      setConnError(getApiErrorMessage(err, 'Failed to start the Tidal login flow.'));
    }
  };

  // Once the status flips to connected, stop the spinner.
  useEffect(() => {
    if (connecting && connected) {
      setConnecting(false);
      setBusyMsg(null);
    }
  }, [connecting, connected]);

  const handleDisconnect = async () => {
    setConnError(null);
    try {
      await disconnectTidal();
      onTidalStatusChange({ connected: false, userId: '', expiresAt: null });
    } catch (err: any) {
      setConnError(getApiErrorMessage(err, 'Failed to disconnect.'));
    }
  };

  return (
    <div className={`ascii-border p-4 ${connected ? 'border-[#33ff33]' : 'border-[#1a3a1a]'}`}>
      <pre className="text-xs mb-2 glow">
{`┌─ TIDAL CONNECTION ──────────────────────┐`}
      </pre>

      {/* Status line */}
      <div className="flex items-center justify-between mb-3">
        <div className={`flex items-center gap-2 text-xs ${connected ? 'text-[#33ff33]' : 'text-[#ffaa00]'}`}>
          <div className={`w-2 h-2 ${connected ? 'bg-[#33ff33]' : 'bg-[#ffaa00] blink'}`} />
          {connected
            ? <>CONNECTED {tidalStatus?.userId ? `• USER ID: ${tidalStatus.userId}` : ''}</>
            : 'NOT CONNECTED'}
        </div>
        {connected && (
          <button
            onClick={handleDisconnect}
            className="text-[10px] text-[#ff3333] hover:text-[#ff6666] underline"
          >
            [DISCONNECT]
          </button>
        )}
      </div>

      {/* The only two fields the user needs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-[10px] text-[#1a3a1a] mb-1">CLIENT ID:</label>
          <input
            type="text"
            value={settings.tidalApiKey}
            onChange={(e) => setSettings({ ...settings, tidalApiKey: e.target.value })}
            placeholder="Paste your Client ID..."
            autoComplete="off"
            spellCheck={false}
            className="w-full px-3 py-2 ascii-input text-xs"
          />
        </div>
        <div>
          <label className="block text-[10px] text-[#1a3a1a] mb-1">CLIENT SECRET:</label>
          <div className="relative">
            <input
              type={showSecret ? 'text' : 'password'}
              value={settings.tidalApiSecret}
              onChange={(e) => setSettings({ ...settings, tidalApiSecret: e.target.value })}
              placeholder="Paste your Client Secret..."
              autoComplete="off"
              spellCheck={false}
              className="w-full px-3 py-2 pr-9 ascii-input text-xs"
            />
            <button
              type="button"
              onClick={() => setShowSecret(!showSecret)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[#1a3a1a] hover:text-[#33ff33]"
              title={showSecret ? 'Hide' : 'Show'}
            >
              {showSecret ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>
      </div>

      {/* Action buttons */}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          onClick={handleConnect}
          disabled={!canConnect || connecting}
          className="ascii-btn px-4 py-2 text-xs flex items-center gap-2 disabled:opacity-40"
        >
          {connecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ExternalLink className="w-3.5 h-3.5" />}
          {connecting ? '[CONNECTING...]' : '[CONNECT TIDAL]'}
        </button>
        <button
          onClick={handleSave}
          className="ascii-btn px-4 py-2 text-xs"
          title="Save credentials without reconnecting"
        >
          [SAVE]
        </button>
        {busyMsg && <span className="text-[10px] text-[#33aaff]">{busyMsg}</span>}
      </div>

      {!canConnect && !connected && (
        <p className="text-[10px] text-[#1a3a1a] mt-2">
          Paste both values above, then click [CONNECT TIDAL] and log in with your Tidal account.
          The access token is obtained automatically — you don't need to touch it.
        </p>
      )}

      {connError && (
        <div className="mt-2 text-[10px] text-[#ff3333] flex items-start gap-2">
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <span>{connError}</span>
        </div>
      )}

      {manualAuthUrl && !connected && (
        <div className="mt-2 text-[10px] border border-[#1a3a1a] p-2">
          <span className="text-[#33aaff]">TIDAL LOGIN URL — open it in your browser to sign in:</span>
          <div className="flex items-center gap-2 mt-1">
            <input
              readOnly
              value={manualAuthUrl}
              onFocus={(e) => e.target.select()}
              className="flex-1 px-2 py-1 ascii-input text-[9px]"
            />
            <button
              onClick={() => navigator.clipboard.writeText(manualAuthUrl)}
              className="ascii-btn px-2 py-1 text-[9px] whitespace-nowrap"
            >
              [COPY]
            </button>
            <a
              href={manualAuthUrl}
              target="_blank"
              rel="noreferrer"
              className="ascii-btn px-2 py-1 text-[9px] whitespace-nowrap inline-block"
            >
              [OPEN]
            </a>
          </div>
          <p className="text-[#1a3a1a] mt-1">
            IMPORTANT: the redirect URI registered in your Tidal developer app must be exactly{' '}
            <code className="text-[#33ff33]">http://localhost:3001/api/tidal/callback</code>
            {' '}(plain http, port 3001). A mismatch causes Tidal's "Something went wrong" error.
          </p>
        </div>
      )}

      <p className="text-[10px] text-[#1a3a1a] mt-2">
        Get credentials:{' '}
        <a
          href="https://developer.tidal.com/"
          target="_blank"
          rel="noreferrer"
          className="text-[#33aaff] hover:underline inline-flex items-center gap-1"
        >
          developer.tidal.com <ExternalLink className="w-3 h-3" />
        </a>
        {' '}→ create an app → copy Client ID &amp; Secret. Add redirect URL{' '}
        <code className="text-[#33ff33]">http://localhost:3001/api/tidal/callback</code> to your app.
      </p>

      {/* Advanced: manual tokens (unchanged behavior, just collapsed away) */}
      <button
        onClick={() => setShowAdvanced(!showAdvanced)}
        className="mt-3 text-[10px] text-[#1a3a1a] hover:text-[#33ff33] flex items-center gap-1"
      >
        {showAdvanced ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        [ADVANCED: MANUAL TOKENS]
      </button>
      {showAdvanced && (
        <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-3 border-t border-[#1a3a1a] pt-3">
          <div>
            <label className="block text-[10px] text-[#1a3a1a] mb-1">ACCESS TOKEN (OPTIONAL):</label>
            <input
              type="password"
              value={settings.tidalAccessToken}
              onChange={(e) => setSettings({ ...settings, tidalAccessToken: e.target.value })}
              className="w-full px-3 py-2 ascii-input text-xs"
            />
          </div>
          <div>
            <label className="block text-[10px] text-[#1a3a1a] mb-1">USER ID (OPTIONAL):</label>
            <input
              type="text"
              value={settings.tidalUserId}
              onChange={(e) => setSettings({ ...settings, tidalUserId: e.target.value })}
              className="w-full px-3 py-2 ascii-input text-xs"
            />
          </div>
          <p className="sm:col-span-2 text-[10px] text-[#1a3a1a]">
            Only needed if you want to bypass the automatic login above. Tokens entered here are used
            until they expire, after which the automatic refresh takes over if a Client Secret is set.
          </p>
        </div>
      )}
    </div>
  );
}

export default App;
