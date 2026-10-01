import axios from 'axios';
import type { Playlist, Settings, ServerStatus, Track } from './types';

const API_BASE = '/api';

const api = axios.create({
  baseURL: API_BASE,
  timeout: 30000,
});

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

export const getDownloadProgress = async (jobId: string): Promise<{ tracks: Track[]; status: string }> => {
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
