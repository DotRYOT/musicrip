export interface Track {
  id: string;
  title: string;
  artist: string;
  album?: string;
  duration?: number;
  thumbnail?: string;
  source: 'youtube' | 'tidal';
  status: 'pending' | 'searching' | 'downloading' | 'completed' | 'error' | 'skipped';
  progress: number;
  error?: string;
  errorHint?: string;
  errorDetail?: string;
  youtubeMatch?: string;
  outputPath?: string;
}

export interface DownloadErrorSummary {
  count: number;
  total: number;
  message: string;
  example: string;
  hint: string;
}

export interface Playlist {
  id: string;
  title: string;
  source: 'youtube' | 'tidal';
  url: string;
  tracks: Track[];
  totalTracks: number;
  completedTracks: number;
  status: 'idle' | 'fetching' | 'downloading' | 'completed' | 'error';
}

export interface Settings {
  outputDir: string;
  audioFormat: 'mp3' | 'flac' | 'opus' | 'm4a';
  audioQuality: string;
  tidalApiKey: string;
  tidalApiSecret: string;
  tidalAccessToken: string;
  tidalRefreshToken?: string;
  tidalTokenExpiresAt?: number;
  tidalUserId: string;
  embedMetadata: boolean;
  embedThumbnail: boolean;
  namingTemplate: string;
}

export interface TidalAuthStatus {
  connected: boolean;
  userId: string;
  expiresAt: number | null;
}

export interface ServerStatus {
  connected: boolean;
  ytDlpInstalled: boolean;
  ytDlpVersion: string;
  ffmpegInstalled: boolean;
  downloadDir: string;
  activeDownloads: number;
}

export interface DownloadJob {
  id: string;
  playlist: Playlist;
  status: 'running' | 'paused' | 'completed' | 'error';
  currentTrack: number;
  totalTracks: number;
}
