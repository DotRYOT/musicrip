import { useState, useEffect, useCallback } from 'react';
import { Music, Download, Settings as SettingsIcon, Server, RefreshCw, Trash2, Play, Pause, X, Check, AlertCircle, Loader2, Search, Disc3 } from 'lucide-react';
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
    <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 text-white">
      {/* Header */}
      <header className="border-b border-gray-800/50 backdrop-blur-xl bg-gray-950/50 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
                <Music className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
                  Playlist Ripper
                </h1>
                <p className="text-xs text-gray-500">YouTube Music & Tidal → Local Audio</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <ServerStatusBadge status={serverStatus} />
              <button
                onClick={() => setShowSettings(!showSettings)}
                className="p-2 rounded-lg bg-gray-800/50 hover:bg-gray-700/50 border border-gray-700/50 transition-colors"
              >
                <SettingsIcon className="w-5 h-5 text-gray-400" />
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        {/* Server Warning */}
        {serverStatus && !serverStatus.connected && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-amber-200 font-medium">Backend server not connected</p>
              <p className="text-amber-200/70 text-sm mt-1">
                Make sure the backend server is running on port 3001. Run <code className="bg-amber-500/20 px-1.5 py-0.5 rounded text-amber-300">npm run server</code> to start it.
              </p>
            </div>
          </div>
        )}

        {/* Settings Panel */}
        {showSettings && (
          <SettingsPanel settings={settings} setSettings={setSettings} />
        )}

        {/* Playlist Input */}
        <div className="bg-gray-900/50 border border-gray-800/50 rounded-2xl p-6 backdrop-blur-sm">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Disc3 className="w-5 h-5 text-purple-400" />
            Import Playlist
          </h2>
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <input
                type="text"
                value={playlistUrl}
                onChange={(e) => setPlaylistUrl(e.target.value)}
                placeholder="Paste YouTube Music or Tidal playlist URL..."
                className="w-full pl-10 pr-4 py-3 bg-gray-800/50 border border-gray-700/50 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/25 transition-all"
                onKeyDown={(e) => e.key === 'Enter' && handleFetchPlaylist()}
              />
            </div>
            <button
              onClick={handleFetchPlaylist}
              disabled={isLoading || !playlistUrl.trim()}
              className="px-6 py-3 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 disabled:from-gray-700 disabled:to-gray-700 disabled:text-gray-500 rounded-xl font-medium transition-all flex items-center gap-2 whitespace-nowrap"
            >
              {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              {isLoading ? 'Fetching...' : 'Fetch Playlist'}
            </button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-gray-500">
            <span>Supported:</span>
            <span className="bg-gray-800/50 px-2 py-0.5 rounded">YouTube Music Playlists</span>
            <span className="bg-gray-800/50 px-2 py-0.5 rounded">Tidal Playlists</span>
            <span className="bg-gray-800/50 px-2 py-0.5 rounded">YouTube Playlists</span>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-red-200">{error}</p>
            </div>
            <button onClick={() => setError(null)} className="text-red-400 hover:text-red-300">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Playlist Content */}
        {playlist && (
          <div className="bg-gray-900/50 border border-gray-800/50 rounded-2xl overflow-hidden backdrop-blur-sm">
            {/* Playlist Header */}
            <div className="p-6 border-b border-gray-800/50">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h3 className="text-lg font-bold">{playlist.title}</h3>
                  <p className="text-sm text-gray-400 mt-1">
                    {playlist.tracks.length} tracks • Source: {playlist.source === 'youtube' ? 'YouTube Music' : 'Tidal'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {!isDownloading ? (
                    <button
                      onClick={handleStartDownload}
                      className="px-4 py-2 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 rounded-lg font-medium text-sm flex items-center gap-2 transition-all"
                    >
                      <Play className="w-4 h-4" />
                      Download All
                    </button>
                  ) : (
                    <>
                      {isPaused ? (
                        <button onClick={handleResume} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg font-medium text-sm flex items-center gap-2">
                          <Play className="w-4 h-4" /> Resume
                        </button>
                      ) : (
                        <button onClick={handlePause} className="px-4 py-2 bg-amber-600 hover:bg-amber-500 rounded-lg font-medium text-sm flex items-center gap-2">
                          <Pause className="w-4 h-4" /> Pause
                        </button>
                      )}
                      <button onClick={handleCancel} className="px-4 py-2 bg-red-600 hover:bg-red-500 rounded-lg font-medium text-sm flex items-center gap-2">
                        <X className="w-4 h-4" /> Cancel
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Progress Bar */}
              {(isDownloading || completedCount > 0) && (
                <div className="mt-4">
                  <div className="flex items-center justify-between text-sm mb-2">
                    <span className="text-gray-400">
                      {completedCount} / {playlist.tracks.length} completed
                      {errorCount > 0 && <span className="text-red-400 ml-2">({errorCount} errors)</span>}
                    </span>
                    <span className="text-purple-400 font-medium">{progressPercent}%</span>
                  </div>
                  <div className="w-full h-2 bg-gray-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-purple-500 to-pink-500 rounded-full transition-all duration-500"
                      style={{ width: `${progressPercent}%` }}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Filter Tabs */}
            <div className="px-6 pt-4 flex gap-2">
              {(['all', 'pending', 'completed', 'error'] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    filter === f
                      ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                      : 'bg-gray-800/50 text-gray-400 hover:text-gray-300 border border-transparent'
                  }`}
                >
                  {f.charAt(0).toUpperCase() + f.slice(1)}
                  {f === 'all' && ` (${playlist.tracks.length})`}
                  {f === 'pending' && ` (${playlist.tracks.filter(t => t.status === 'pending' || t.status === 'searching').length})`}
                  {f === 'completed' && ` (${completedCount})`}
                  {f === 'error' && ` (${errorCount})`}
                </button>
              ))}
            </div>

            {/* Track List */}
            <div className="p-4 max-h-[600px] overflow-y-auto space-y-1">
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
                <div className="text-center py-8 text-gray-500">
                  No tracks match the current filter
                </div>
              )}
            </div>
          </div>
        )}

        {/* Empty State */}
        {!playlist && !isLoading && (
          <div className="text-center py-16">
            <div className="w-20 h-20 mx-auto rounded-2xl bg-gray-800/50 flex items-center justify-center mb-4">
              <Music className="w-10 h-10 text-gray-600" />
            </div>
            <h3 className="text-lg font-medium text-gray-400">No playlist loaded</h3>
            <p className="text-sm text-gray-600 mt-2">Paste a YouTube Music or Tidal playlist URL above to get started</p>
          </div>
        )}
      </main>
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
    pending: { icon: null, color: 'text-gray-500', bg: 'bg-gray-800/30' },
    searching: { icon: <Loader2 className="w-3.5 h-3.5 animate-spin" />, color: 'text-blue-400', bg: 'bg-blue-500/10' },
    downloading: { icon: <Loader2 className="w-3.5 h-3.5 animate-spin" />, color: 'text-purple-400', bg: 'bg-purple-500/10' },
    completed: { icon: <Check className="w-3.5 h-3.5" />, color: 'text-green-400', bg: 'bg-green-500/10' },
    error: { icon: <AlertCircle className="w-3.5 h-3.5" />, color: 'text-red-400', bg: 'bg-red-500/10' },
    skipped: { icon: <X className="w-3.5 h-3.5" />, color: 'text-gray-500', bg: 'bg-gray-800/30' },
  };

  const config = statusConfig[track.status];

  return (
    <div className={`flex items-center gap-3 px-3 py-2.5 rounded-lg ${config.bg} group`}>
      <span className="text-xs text-gray-600 w-6 text-right font-mono">{index}</span>
      
      {track.thumbnail ? (
        <img src={track.thumbnail} alt="" className="w-10 h-10 rounded object-cover flex-shrink-0" />
      ) : (
        <div className="w-10 h-10 rounded bg-gray-800 flex items-center justify-center flex-shrink-0">
          <Music className="w-4 h-4 text-gray-600" />
        </div>
      )}
      
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{track.title}</p>
        <p className="text-xs text-gray-500 truncate">{track.artist}</p>
      </div>

      {/* Progress bar for downloading */}
      {track.status === 'downloading' && (
        <div className="w-20 h-1.5 bg-gray-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-purple-500 rounded-full transition-all"
            style={{ width: `${track.progress}%` }}
          />
        </div>
      )}

      {/* Status */}
      <div className={`flex items-center gap-1.5 ${config.color}`}>
        {config.icon}
        <span className="text-xs capitalize hidden sm:inline">{track.status}</span>
      </div>

      {/* Actions */}
      {track.status === 'error' && isDownloading && (
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={() => onRetry(track.id)}
            className="p-1 rounded hover:bg-gray-700/50 text-blue-400"
            title="Retry"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => onSkip(track.id)}
            className="p-1 rounded hover:bg-gray-700/50 text-gray-400"
            title="Skip"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

function ServerStatusBadge({ status }: { status: ServerStatus | null }) {
  if (!status) return null;
  
  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs ${
      status.connected ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'
    }`}>
      <div className={`w-2 h-2 rounded-full ${status.connected ? 'bg-green-400' : 'bg-red-400'} ${status.connected ? 'animate-pulse' : ''}`} />
      <span>{status.connected ? 'Server Online' : 'Server Offline'}</span>
    </div>
  );
}

function SettingsPanel({ settings, setSettings }: { settings: Settings; setSettings: (s: Settings) => void }) {
  return (
    <div className="bg-gray-900/50 border border-gray-800/50 rounded-2xl p-6 backdrop-blur-sm">
      <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
        <SettingsIcon className="w-5 h-5 text-purple-400" />
        Settings
      </h2>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm text-gray-400 mb-1">Output Directory</label>
          <input
            type="text"
            value={settings.outputDir}
            onChange={(e) => setSettings({ ...settings, outputDir: e.target.value })}
            className="w-full px-3 py-2 bg-gray-800/50 border border-gray-700/50 rounded-lg text-white text-sm focus:outline-none focus:border-purple-500/50"
          />
        </div>
        
        <div>
          <label className="block text-sm text-gray-400 mb-1">Audio Format</label>
          <select
            value={settings.audioFormat}
            onChange={(e) => setSettings({ ...settings, audioFormat: e.target.value as Settings['audioFormat'] })}
            className="w-full px-3 py-2 bg-gray-800/50 border border-gray-700/50 rounded-lg text-white text-sm focus:outline-none focus:border-purple-500/50"
          >
            <option value="mp3">MP3</option>
            <option value="flac">FLAC</option>
            <option value="opus">Opus</option>
            <option value="m4a">M4A (AAC)</option>
          </select>
        </div>
        
        <div>
          <label className="block text-sm text-gray-400 mb-1">Audio Quality (kbps)</label>
          <select
            value={settings.audioQuality}
            onChange={(e) => setSettings({ ...settings, audioQuality: e.target.value })}
            className="w-full px-3 py-2 bg-gray-800/50 border border-gray-700/50 rounded-lg text-white text-sm focus:outline-none focus:border-purple-500/50"
          >
            <option value="128">128 kbps</option>
            <option value="192">192 kbps</option>
            <option value="256">256 kbps</option>
            <option value="320">320 kbps</option>
            <option value="0">Best Available</option>
          </select>
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-1">Naming Template</label>
          <input
            type="text"
            value={settings.namingTemplate}
            onChange={(e) => setSettings({ ...settings, namingTemplate: e.target.value })}
            placeholder="{artist} - {title}"
            className="w-full px-3 py-2 bg-gray-800/50 border border-gray-700/50 rounded-lg text-white text-sm focus:outline-none focus:border-purple-500/50"
          />
        </div>

        <div className="md:col-span-2">
          <h3 className="text-sm font-medium text-purple-400 mb-2">Tidal API Credentials</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">API Key</label>
              <input
                type="password"
                value={settings.tidalApiKey}
                onChange={(e) => setSettings({ ...settings, tidalApiKey: e.target.value })}
                className="w-full px-3 py-2 bg-gray-800/50 border border-gray-700/50 rounded-lg text-white text-sm focus:outline-none focus:border-purple-500/50"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">API Secret</label>
              <input
                type="password"
                value={settings.tidalApiSecret}
                onChange={(e) => setSettings({ ...settings, tidalApiSecret: e.target.value })}
                className="w-full px-3 py-2 bg-gray-800/50 border border-gray-700/50 rounded-lg text-white text-sm focus:outline-none focus:border-purple-500/50"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Access Token</label>
              <input
                type="password"
                value={settings.tidalAccessToken}
                onChange={(e) => setSettings({ ...settings, tidalAccessToken: e.target.value })}
                className="w-full px-3 py-2 bg-gray-800/50 border border-gray-700/50 rounded-lg text-white text-sm focus:outline-none focus:border-purple-500/50"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">User ID</label>
              <input
                type="text"
                value={settings.tidalUserId}
                onChange={(e) => setSettings({ ...settings, tidalUserId: e.target.value })}
                className="w-full px-3 py-2 bg-gray-800/50 border border-gray-700/50 rounded-lg text-white text-sm focus:outline-none focus:border-purple-500/50"
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
              className="rounded border-gray-600 bg-gray-800 text-purple-500 focus:ring-purple-500/25"
            />
            <span className="text-sm text-gray-300">Embed metadata</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.embedThumbnail}
              onChange={(e) => setSettings({ ...settings, embedThumbnail: e.target.checked })}
              className="rounded border-gray-600 bg-gray-800 text-purple-500 focus:ring-purple-500/25"
            />
            <span className="text-sm text-gray-300">Embed thumbnail</span>
          </label>
        </div>
      </div>
    </div>
  );
}

export default App;
