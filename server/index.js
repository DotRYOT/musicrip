import express from 'express';
import cors from 'cors';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

// State
const playlists = new Map();
const downloadJobs = new Map();
let currentSettings = {
  outputDir: path.join(process.env.HOME || '~', 'Music', 'Downloads'),
  audioFormat: 'mp3',
  audioQuality: '320',
  tidalApiKey: '',
  tidalApiSecret: '',
  tidalAccessToken: '',
  tidalUserId: '',
  embedMetadata: true,
  embedThumbnail: true,
  namingTemplate: '{artist} - {title}',
};

// Load saved settings
const settingsPath = path.join(__dirname, '.settings.json');
try {
  if (fs.existsSync(settingsPath)) {
    const saved = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    currentSettings = { ...currentSettings, ...saved };
  }
} catch {}

// Utility: check if command exists
async function commandExists(cmd) {
  try {
    await execAsync(`which ${cmd}`);
    return true;
  } catch {
    return false;
  }
}

// Utility: get yt-dlp version
async function getYtDlpVersion() {
  try {
    const { stdout } = await execAsync('yt-dlp --version');
    return stdout.trim();
  } catch {
    return '';
  }
}

// Detect playlist source from URL
function detectSource(url) {
  if (url.includes('tidal.com') || url.includes('tidal.com')) {
    return 'tidal';
  }
  if (url.includes('youtube.com') || url.includes('youtu.be') || url.includes('music.youtube.com')) {
    return 'youtube';
  }
  return null;
}

// Fetch YouTube Music playlist using yt-dlp
async function fetchYouTubePlaylist(url) {
  const cmd = `yt-dlp --flat-playlist --dump-json "${url}"`;
  try {
    const { stdout } = await execAsync(cmd, { maxBuffer: 50 * 1024 * 1024 });
    const lines = stdout.trim().split('\n').filter(Boolean);
    const tracks = lines.map((line, index) => {
      const data = JSON.parse(line);
      return {
        id: uuidv4(),
        title: data.title || 'Unknown',
        artist: data.uploader || data.channel || 'Unknown',
        album: '',
        duration: data.duration || 0,
        thumbnail: data.thumbnail || '',
        source: 'youtube',
        status: 'pending',
        progress: 0,
        youtubeMatch: data.url || data.id,
      };
    });

    // Try to get playlist title
    let playlistTitle = 'YouTube Playlist';
    try {
      const { stdout: metaOut } = await execAsync(`yt-dlp --flat-playlist --print playlist_title "${url}" 2>/dev/null || echo "YouTube Playlist"`);
      playlistTitle = metaOut.trim() || 'YouTube Playlist';
    } catch {}

    return {
      id: uuidv4(),
      title: playlistTitle,
      source: 'youtube',
      url,
      tracks,
      totalTracks: tracks.length,
      completedTracks: 0,
      status: 'idle',
    };
  } catch (err) {
    throw new Error(`Failed to fetch YouTube playlist: ${err.message}`);
  }
}

// Fetch Tidal playlist using API
async function fetchTidalPlaylist(url, settings) {
  const { tidalAccessToken, tidalUserId } = settings;
  
  if (!tidalAccessToken) {
    throw new Error('Tidal access token is required. Please configure it in settings.');
  }

  // Extract playlist ID from URL
  const playlistIdMatch = url.match(/playlist\/([a-zA-Z0-9-]+)/);
  if (!playlistIdMatch) {
    throw new Error('Could not extract Tidal playlist ID from URL');
  }
  const playlistId = playlistIdMatch[1];

  // Fetch playlist metadata
  const metaResponse = await fetch(`https://api.tidal.com/v1/playlists/${playlistId}?countryCode=US`, {
    headers: {
      'Authorization': `Bearer ${tidalAccessToken}`,
    },
  });

  if (!metaResponse.ok) {
    throw new Error(`Tidal API error: ${metaResponse.status} ${metaResponse.statusText}`);
  }

  const meta = await metaResponse.json();

  // Fetch playlist tracks
  const tracksResponse = await fetch(`https://api.tidal.com/v1/playlists/${playlistId}/tracks?countryCode=US&limit=100&offset=0`, {
    headers: {
      'Authorization': `Bearer ${tidalAccessToken}`,
    },
  });

  if (!tracksResponse.ok) {
    throw new Error(`Tidal API error fetching tracks: ${tracksResponse.status}`);
  }

  const tracksData = await tracksResponse.json();
  
  // If there are more tracks, fetch them
  let allItems = tracksData.items || [];
  let offset = 100;
  const totalTracks = tracksData.totalNumberOfItems || allItems.length;
  
  while (allItems.length < totalTracks) {
    const moreResponse = await fetch(`https://api.tidal.com/v1/playlists/${playlistId}/tracks?countryCode=US&limit=100&offset=${offset}`, {
      headers: {
        'Authorization': `Bearer ${tidalAccessToken}`,
      },
    });
    const moreData = await moreResponse.json();
    allItems = [...allItems, ...(moreData.items || [])];
    offset += 100;
  }

  const tracks = allItems.map((item) => ({
    id: uuidv4(),
    title: item.title || 'Unknown',
    artist: item.artist?.name || item.artists?.map(a => a.name).join(', ') || 'Unknown',
    album: item.album?.title || '',
    duration: item.duration || 0,
    thumbnail: item.album?.cover ? `https://resources.tidal.com/images/${item.album.cover.replace(/-/g, '/')}/320x320.jpg` : '',
    source: 'tidal',
    status: 'pending',
    progress: 0,
    tidalId: item.id,
  }));

  return {
    id: uuidv4(),
    title: meta.title || 'Tidal Playlist',
    source: 'tidal',
    url,
    tracks,
    totalTracks: tracks.length,
    completedTracks: 0,
    status: 'idle',
  };
}

// Download a single track using yt-dlp
function downloadTrack(track, settings, onProgress) {
  return new Promise((resolve, reject) => {
    const outputDir = settings.outputDir.replace('~', process.env.HOME || '');
    
    // Ensure output directory exists
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const formatMap = {
      mp3: 'mp3',
      flac: 'flac',
      opus: 'opus',
      m4a: 'm4a',
    };

    const ext = formatMap[settings.audioFormat] || 'mp3';
    const quality = settings.audioQuality === '0' ? '0' : settings.audioQuality;
    
    const filename = settings.namingTemplate
      .replace('{artist}', track.artist.replace(/[/\\?%*:|"<>]/g, '_'))
      .replace('{title}', track.title.replace(/[/\\?%*:|"<>]/g, '_'))
      .replace('{album}', (track.album || 'Unknown').replace(/[/\\?%*:|"<>]/g, '_'));

    const outputPath = path.join(outputDir, `${filename}.${ext}`);

    let searchQuery;
    if (track.source === 'youtube' && track.youtubeMatch) {
      searchQuery = `https://www.youtube.com/watch?v=${track.youtubeMatch}`;
    } else {
      // Search YouTube Music for the track
      searchQuery = `ytsearch5:${track.artist} - ${track.title}`;
    }

    const args = [
      '-x',
      '--audio-format', ext,
      '--audio-quality', quality === '0' ? '0' : `${quality}K`,
      '-o', outputPath,
      '--no-playlist',
    ];

    if (settings.embedMetadata) {
      args.push('--embed-metadata');
    }
    if (settings.embedThumbnail) {
      args.push('--embed-thumbnail');
    }

    args.push(searchQuery);

    const proc = spawn('yt-dlp', args);
    let lastProgress = 0;

    proc.stderr.on('data', (data) => {
      const output = data.toString();
      
      // Parse progress
      const progressMatch = output.match(/(\d+\.?\d*)%/);
      if (progressMatch) {
        const progress = parseFloat(progressMatch[1]);
        if (progress > lastProgress) {
          lastProgress = progress;
          onProgress(progress);
        }
      }
    });

    proc.stdout.on('data', (data) => {
      const output = data.toString();
      const progressMatch = output.match(/(\d+\.?\d*)%/);
      if (progressMatch) {
        const progress = parseFloat(progressMatch[1]);
        if (progress > lastProgress) {
          lastProgress = progress;
          onProgress(progress);
        }
      }
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ outputPath, success: true });
      } else {
        reject(new Error(`yt-dlp exited with code ${code}`));
      }
    });

    proc.on('error', (err) => {
      reject(err);
    });
  });
}

// API Routes

// Server status
app.get('/api/status', async (req, res) => {
  const ytDlpExists = await commandExists('yt-dlp');
  const ffmpegExists = await commandExists('ffmpeg');
  const version = ytDlpExists ? await getYtDlpVersion() : '';
  
  res.json({
    connected: true,
    ytDlpInstalled: ytDlpExists,
    ytDlpVersion: version,
    ffmpegInstalled: ffmpegExists,
    downloadDir: currentSettings.outputDir,
    activeDownloads: Array.from(downloadJobs.values()).filter(j => j.status === 'running').length,
  });
});

// Fetch playlist
app.post('/api/playlist/fetch', async (req, res) => {
  const { url, settings } = req.body;
  
  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  const source = detectSource(url);
  if (!source) {
    return res.status(400).json({ error: 'Unsupported URL. Please provide a YouTube Music or Tidal playlist URL.' });
  }

  try {
    let playlist;
    if (source === 'youtube') {
      playlist = await fetchYouTubePlaylist(url);
    } else {
      playlist = await fetchTidalPlaylist(url, { ...currentSettings, ...settings });
    }
    
    playlists.set(playlist.id, playlist);
    res.json(playlist);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Start download
app.post('/api/download/start', async (req, res) => {
  const { playlistId, settings } = req.body;
  const playlist = playlists.get(playlistId);
  
  if (!playlist) {
    return res.status(404).json({ error: 'Playlist not found' });
  }

  const mergedSettings = { ...currentSettings, ...settings };
  const jobId = uuidv4();
  
  const job = {
    id: jobId,
    playlistId,
    status: 'running',
    currentTrack: 0,
    totalTracks: playlist.tracks.length,
    paused: false,
    cancelled: false,
  };
  
  downloadJobs.set(jobId, job);
  playlist.status = 'downloading';

  // Start downloading tracks
  (async () => {
    for (let i = 0; i < playlist.tracks.length; i++) {
      if (job.cancelled) break;
      
      while (job.paused && !job.cancelled) {
        await new Promise(r => setTimeout(r, 500));
      }
      
      if (job.cancelled) break;
      
      const track = playlist.tracks[i];
      if (track.status === 'completed' || track.status === 'skipped') continue;
      
      job.currentTrack = i;
      track.status = 'searching';

      try {
        track.status = 'downloading';
        
        await downloadTrack(track, mergedSettings, (progress) => {
          track.progress = progress;
        });
        
        track.status = 'completed';
        track.progress = 100;
        playlist.completedTracks++;
      } catch (err) {
        track.status = 'error';
        track.error = err.message;
      }
    }
    
    if (!job.cancelled) {
      job.status = 'completed';
      playlist.status = 'completed';
    }
  })();

  res.json({ jobId });
});

// Get download progress
app.get('/api/download/progress/:jobId', (req, res) => {
  const job = downloadJobs.get(req.params.jobId);
  const playlist = playlists.get(job?.playlistId);
  
  if (!job || !playlist) {
    return res.status(404).json({ error: 'Job not found' });
  }

  res.json({
    tracks: playlist.tracks,
    status: job.status,
    currentTrack: job.currentTrack,
  });
});

// Pause download
app.post('/api/download/pause', (req, res) => {
  const { jobId } = req.body;
  const job = downloadJobs.get(jobId);
  if (job) {
    job.paused = true;
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Job not found' });
  }
});

// Resume download
app.post('/api/download/resume', (req, res) => {
  const { jobId } = req.body;
  const job = downloadJobs.get(jobId);
  if (job) {
    job.paused = false;
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Job not found' });
  }
});

// Cancel download
app.post('/api/download/cancel', (req, res) => {
  const { jobId } = req.body;
  const job = downloadJobs.get(jobId);
  if (job) {
    job.cancelled = true;
    job.status = 'cancelled';
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Job not found' });
  }
});

// Retry track
app.post('/api/download/retry', (req, res) => {
  const { trackId, jobId } = req.body;
  const job = downloadJobs.get(jobId);
  const playlist = playlists.get(job?.playlistId);
  
  if (!playlist) {
    return res.status(404).json({ error: 'Playlist not found' });
  }

  const track = playlist.tracks.find(t => t.id === trackId);
  if (track) {
    track.status = 'pending';
    track.progress = 0;
    track.error = undefined;
  }
  
  res.json({ success: true });
});

// Skip track
app.post('/api/download/skip', (req, res) => {
  const { trackId, jobId } = req.body;
  const job = downloadJobs.get(jobId);
  const playlist = playlists.get(job?.playlistId);
  
  if (!playlist) {
    return res.status(404).json({ error: 'Playlist not found' });
  }

  const track = playlist.tracks.find(t => t.id === trackId);
  if (track) {
    track.status = 'skipped';
  }
  
  res.json({ success: true });
});

// Settings
app.get('/api/settings', (req, res) => {
  res.json(currentSettings);
});

app.post('/api/settings', (req, res) => {
  currentSettings = { ...currentSettings, ...req.body };
  // Save settings
  try {
    fs.writeFileSync(settingsPath, JSON.stringify(currentSettings, null, 2));
  } catch {}
  res.json({ success: true });
});

// YouTube search (for manual matching)
app.post('/api/youtube/search', async (req, res) => {
  const { query } = req.body;
  try {
    const cmd = `yt-dlp --flat-playlist --dump-json "ytsearch5:${query}"`;
    const { stdout } = await execAsync(cmd, { maxBuffer: 10 * 1024 * 1024 });
    const lines = stdout.trim().split('\n').filter(Boolean);
    const results = lines.map(line => {
      const data = JSON.parse(line);
      return {
        id: data.id,
        title: data.title,
        artist: data.uploader || '',
        duration: data.duration,
        thumbnail: data.thumbnail,
      };
    });
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Serve static frontend files in production
const distPath = path.join(__dirname, '..', 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('*', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`🎵 Playlist Ripper backend running on http://localhost:${PORT}`);
  console.log(`📁 Download directory: ${currentSettings.outputDir}`);
  if (fs.existsSync(distPath)) {
    console.log(`🌐 Serving frontend at http://localhost:${PORT}`);
  }
});
