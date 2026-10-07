import axios from 'axios';
import type { Playlist, Settings, ServerStatus, Track, DownloadErrorSummary, TidalAuthStatus } from './types';

const API_BASE = '/api';

const api = axios.create({
  baseURL: API_BASE,
  timeout: 30000,
});

// Turn axios/network failures into clear, actionable messages
export const getApiErrorMessage = (err: any, fallback: string): string => {
  if (err?.response?.data?.error) return err.response.data.error;
  if (err?.code === 'ECONNABORTED') {
    return 'The server took too long to respond. It may be busy or stuck — check that the backend is running and try again.';
  }
  if (err?.message === 'Network Error' || err?.code === 'ERR_NETWORK') {
    return 'Cannot reach the backend server (port 3001). Make sure it is running: npm run server';
  }
  if (err?.response?.status === 503) {
    return err.response.data?.error || 'The server is missing a required tool (yt-dlp or ffmpeg).';
  }
  return err?.response?.data?.error || err?.message || fallback;
};

export const fetchPlaylist = async (url: string, settings: Partial<Settings>): Promise<Playlist> => {
  const { data } = await api.post('/playlist/fetch', { url, settings });
  return data;
};

export const startDownload = async (playlistId: string, settings: Partial<Settings>): Promise<{ jobId: string }> => {
  const { data } = await api.post('/download/start', { playlistId, settings });
  return data;
};

export const pauseDownload = async (jobId: string): Promise<void> => {
  await api.post('/download/pause', { jobId });
};

export const resumeDownload = async (jobId: string): Promise<void> => {
  await api.post('/download/resume', { jobId });
};

export const cancelDownload = async (jobId: string): Promise<void> => {
  await api.post('/download/cancel', { jobId });
};

export const getServerStatus = async (): Promise<ServerStatus> => {
  const { data } = await api.get('/status');
  return data;
};

export const getDownloadProgress = async (jobId: string): Promise<{ tracks: Track[]; status: string; errorSummary: DownloadErrorSummary | null }> => {
  const { data } = await api.get(`/download/progress/${jobId}`);
  return data;
};

export const updateSettings = async (settings: Partial<Settings>): Promise<void> => {
  await api.post('/settings', settings);
};

export const getSettings = async (): Promise<Settings> => {
  const { data } = await api.get('/settings');
  return data;
};

export const searchYouTubeMusic = async (query: string): Promise<Track[]> => {
  const { data } = await api.post('/youtube/search', { query });
  return data;
};

export const retryTrack = async (trackId: string, jobId: string): Promise<void> => {
  await api.post('/download/retry', { trackId, jobId });
};

export const skipTrack = async (trackId: string, jobId: string): Promise<void> => {
  await api.post('/download/skip', { trackId, jobId });
};

// ─── Tidal one-click connect (only Client ID + Client Secret needed) ──────

export const startTidalAuth = async (clientId: string, clientSecret: string): Promise<{ url: string }> => {
  const { data } = await api.post('/tidal/auth/start', {
    clientId,
    clientSecret,
    origin: window.location.origin,
  });
  return data;
};

export const getTidalAuthStatus = async (): Promise<TidalAuthStatus> => {
  const { data } = await api.get('/tidal/auth/status');
  return data;
};

export const disconnectTidal = async (): Promise<void> => {
  await api.post('/tidal/disconnect', {});
};
