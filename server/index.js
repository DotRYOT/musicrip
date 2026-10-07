import express from 'express';
import cors from 'cors';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
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
  tidalRefreshToken: '',
  tidalTokenExpiresAt: 0,
  tidalUserId: '',
  embedMetadata: true,
  embedThumbnail: true,
  namingTemplate: '{artist} - {title}',
  rateLimitEnabled: true,
  ytMinDelayMs: 1500,
  ytMaxDelayMs: 4000,
  ytMaxRetries: 3,
  cookieFile: '',
};

// Load saved settings
const settingsPath = path.join(__dirname, '.settings.json');
try {
  if (fs.existsSync(settingsPath)) {
    const saved = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    currentSettings = { ...currentSettings, ...saved };
  }
} catch {}

function saveSettings() {
  try {
    fs.writeFileSync(settingsPath, JSON.stringify(currentSettings, null, 2));
  } catch {}
}

// ─── Tidal OAuth2 (PKCE) ──────────────────────────────────────────────────
// With just a Client ID + Client Secret the user can click "Connect Tidal"
// and the whole token flow happens automatically in the background.
const TIDAL_AUTH_BASE = 'https://login.tidal.com/authorize';
const TIDAL_TOKEN_URL = 'https://auth.tidal.com/v1/oauth2/token';
const TIDAL_CLIENT_ID = process.env.TIDAL_CLIENT_ID || 'p9mbkShw0JU3uW2W'; // public app client id, override via env or UI
const TIDAL_SCOPES = 'r.usersonlyplaylists offline_access';

function b64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const tidalAuthSessions = new Map(); // state -> { codeVerifier, createdAt }

async function tidalTokenRequest(bodyParams) {
  const res = await fetch(TIDAL_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(bodyParams).toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error_description || data.error || `Tidal auth failed (HTTP ${res.status})`);
  }
  return data;
}

function storeTidalTokens(tokens) {
  currentSettings.tidalAccessToken = tokens.access_token || '';
  currentSettings.tidalRefreshToken = tokens.refresh_token || currentSettings.tidalRefreshToken || '';
  currentSettings.tidalTokenExpiresAt = Date.now() + (tokens.expires_in || 360000) * 1000;
  currentSettings.tidalUserId = String(tokens.user_id || currentSettings.tidalUserId || '');
  saveSettings();
}

async function refreshTidalToken(settings) {
  const clientId = settings.tidalApiKey || TIDAL_CLIENT_ID;
  const clientSecret = settings.tidalApiSecret;
  const refreshToken = settings.tidalRefreshToken;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('NO_REFRESH');
  }
  const tokens = await tidalTokenRequest({
    grant_type: 'refresh_token',
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
  });
  storeTidalTokens(tokens);
  return tokens.access_token;
}

// Returns a valid access token, refreshing it automatically when needed.
async function getTidalAccessToken(settings) {
  const hasToken = !!settings.tidalAccessToken;
  const expired = settings.tidalTokenExpiresAt && Date.now() > settings.tidalTokenExpiresAt - 60000;
  if (hasToken && !expired) return settings.tidalAccessToken;
  if (settings.tidalRefreshToken) {
    try {
      return await refreshTidalToken(settings);
    } catch (err) {
      if (!hasToken) throw err; // fall through to stale token only if we have one
    }
  }
  if (hasToken) return settings.tidalAccessToken; // best effort — API call will surface real errors
  throw new Error('Tidal is not connected yet. Open Settings → Tidal and paste your Client ID and Client Secret, then click "CONNECT TIDAL".');
}

// Start the OAuth flow: build the authorization URL for the browser popup.
// NOTE: Tidal's login page rejects unknown query parameters with a generic
// "Something went wrong" error — send ONLY the required OAuth2 PKCE params.
async function buildTidalAuthUrl(clientId, clientSecret) {
  if (!clientId) {
    throw new Error('A Tidal Client ID is required. Create one at https://developer.tidal.com/');
  }

  // Persist the credentials so the callback step can exchange the code.
  currentSettings.tidalApiKey = clientId;
  currentSettings.tidalApiSecret = clientSecret || currentSettings.tidalApiSecret || '';
  saveSettings();

  const origin = `http://localhost:${PORT}`;
  const redirectUri = `${origin}/api/tidal/callback`;

  const codeVerifier = b64url(crypto.randomBytes(32));
  const codeChallenge = b64url(crypto.createHash('sha256').update(codeVerifier).digest());
  const state = b64url(crypto.randomBytes(16));

  tidalAuthSessions.set(state, { codeVerifier, createdAt: Date.now(), clientId, clientSecret: currentSettings.tidalApiSecret });
  // Clean up old sessions
  for (const [s, v] of tidalAuthSessions) {
    if (Date.now() - v.createdAt > 10 * 60 * 1000) tidalAuthSessions.delete(s);
  }

  const url = `${TIDAL_AUTH_BASE}?${new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    energy_saving_scopes: 'true',
    redirect_uri: redirectUri,
    scope: TIDAL_SCOPES,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  })}`;

  // Validate the client id against Tidal's OAuth endpoint BEFORE opening the
  // popup, so a bad/wrong Client ID shows a clear error instead of Tidal's
  // cryptic "Something went wrong" login page.
  try {
    await tidalTokenRequest({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret || '',
      scope: TIDAL_SCOPES,
    });
  } catch (err) {
    const msg = String(err.message || '');
    if (/invalid_client|unauthorized|bad request/i.test(msg)) {
      throw new Error(
        'Tidal rejected these credentials (HTTP 401). Double-check that you pasted the CLIENT ID and CLIENT SECRET from the same app at developer.tidal.com → your app → Credentials, with no extra spaces.'
      );
    }
    // Network / transient errors shouldn't block the flow.
  }

  return url;
}

app.post('/api/tidal/auth/start', async (req, res) => {
  const body = req.body || {};
  const clientId = (body.clientId || '').trim() || currentSettings.tidalApiKey || TIDAL_CLIENT_ID;
  const clientSecret = (body.clientSecret || '').trim();
  try {
    const url = await buildTidalAuthUrl(clientId, clientSecret);
    res.json({ url });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Server-side login: open the auth URL directly in the DEFAULT browser
// (no popup — avoids CORS/popup issues when the UI is served over HTTPS).
app.post('/api/tidal/auth/open-browser', async (req, res) => {
  const body = req.body || {};
  const clientId = (body.clientId || '').trim() || currentSettings.tidalApiKey || TIDAL_CLIENT_ID;
  const clientSecret = (body.clientSecret || '').trim();
  try {
    const url = await buildTidalAuthUrl(clientId, clientSecret);
    const opener = process.platform === 'darwin' ? 'open'
      : process.platform === 'win32' ? 'start'
      : 'xdg-open';
    exec(`${opener} "${url}"`, () => {});
    res.json({ success: true, url });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// OAuth callback — exchanges the code for tokens and closes the popup window.
app.get('/api/tidal/callback', async (req, res) => {
  const { code, state, error: oauthError } = req.query;
  const closePage = (ok, message) => res.type('html').send(`<!doctype html><html><head><title>Tidal</title></head>
    <body style="background:#0a0a0a;color:${ok ? '#33ff33' : '#ff3333'};font-family:monospace;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
    <pre>${ok ? '✔ TIDAL CONNECTED — you can close this window.' : `✘ TIDAL LOGIN FAILED: ${message}\\nYou can close this window.`}</pre>
    <script>setTimeout(()=>{window.close()},1500);</script></body></html>`);

  if (oauthError) return closePage(false, String(oauthError));
  if (!code || !state) return closePage(false, 'missing parameters');

  const session = tidalAuthSessions.get(String(state));
  if (!session) return closePage(false, 'session expired, please try again');
  tidalAuthSessions.delete(String(state));

  try {
    const tokens = await tidalTokenRequest({
      grant_type: 'authorization_code',
      client_id: session.clientId || currentSettings.tidalApiKey || TIDAL_CLIENT_ID,
      client_secret: session.clientSecret || currentSettings.tidalApiSecret,
      code: String(code),
      // Must be byte-for-byte identical to the redirect_uri sent to /authorize.
      redirect_uri: `http://localhost:${PORT}/api/tidal/callback`,
      code_verifier: session.codeVerifier,
    });
    storeTidalTokens(tokens);
    return closePage(true);
  } catch (err) {
    return closePage(false, err.message);
  }
});

// Polling endpoint used by the UI popup flow.
app.get('/api/tidal/auth/status', (req, res) => {
  const connected = !!currentSettings.tidalAccessToken;
  res.json({
    connected,
    userId: connected ? currentSettings.tidalUserId : '',
    expiresAt: currentSettings.tidalTokenExpiresAt || null,
  });
});

// Disconnect / clear Tidal tokens
app.post('/api/tidal/disconnect', (req, res) => {
  currentSettings.tidalAccessToken = '';
  currentSettings.tidalRefreshToken = '';
  currentSettings.tidalTokenExpiresAt = 0;
  currentSettings.tidalUserId = '';
  saveSettings();
  res.json({ success: true });
});

// ─── YouTube anti-rate-limiting ──────────────────────────────────────────
// YouTube aggressively throttles clients that fire many requests in a row
// ("Too many requests" / HTTP 429 / "Sign in to confirm you're not a bot").
// To avoid that we: (1) serialize every yt-dlp invocation through one queue,
// (2) wait a randomized pause between calls, (3) retry with exponential
// backoff when a call is rate limited, and (4) reuse one persistent client
// context (PO token cache + optional cookies) so each call doesn't look like
// a brand-new suspicious visitor.

const RATE_LIMIT_DEFAULTS = {
  enabled: true,
  minDelayMs: 1500,   // pause before each yt-dlp call (min of random range)
  maxDelayMs: 4000,   // pause before each yt-dlp call (max of random range)
  maxRetries: 3,      // extra attempts after the first try when rate limited
  baseBackoffMs: 10000, // 10s → 20s → 40s … while backing off
};

let ytQueueTail = Promise.resolve(); // global FIFO queue for all yt-dlp invocations

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function randInt(min, max) {
  return Math.floor(min + Math.random() * Math.max(0, max - min));
}

function getRateLimitConfig(settings) {
  const s = settings || currentSettings;
  return {
    ...RATE_LIMIT_DEFAULTS,
    ...(s.rateLimitEnabled === false ? { enabled: false } : null),
    minDelayMs: Number.isFinite(+s.ytMinDelayMs) && +s.ytMinDelayMs >= 0 ? +s.ytMinDelayMs : RATE_LIMIT_DEFAULTS.minDelayMs,
    maxDelayMs: Math.max(
      Number.isFinite(+s.ytMaxDelayMs) && +s.ytMaxDelayMs >= 0 ? +s.ytMaxDelayMs : RATE_LIMIT_DEFAULTS.maxDelayMs,
      Number.isFinite(+s.ytMinDelayMs) && +s.ytMinDelayMs >= 0 ? +s.ytMinDelayMs : RATE_LIMIT_DEFAULTS.minDelayMs
    ),
    maxRetries: Number.isFinite(+s.ytMaxRetries) && +s.ytMaxRetries >= 0 ? +s.ytMaxRetries : RATE_LIMIT_DEFAULTS.maxRetries,
    baseBackoffMs: Number.isFinite(+s.ytBaseBackoffMs) && +s.ytBaseBackoffMs > 0 ? +s.ytBaseBackoffMs : RATE_LIMIT_DEFAULTS.baseBackoffMs,
  };
}

// Detect YouTube-side blocking from process output / errors.
function looksRateLimited(text) {
  if (!text) return false;
  return /too many requests|http error 429|rate ?limit|sign in to confirm|not a bot|captcha|are you a robot|403 forbidden|restricted/i.test(text);
}

// Common hardening flags applied to every yt-dlp call.
function getYtDlpCommonArgs(settings) {
  const args = [
    '--extractor-args', 'youtube:player_client=android', // less prone to bot checks than the web client
    '--extractor-args', 'youtubetab:approximate_date',
    '--sleep-requests', '1',                              // pause between internal HTTP requests
    '--sleep-interval', '2',                              // pause before each download
    '--max-sleep-interval', '6',
    '--retries', '5',                                     // yt-dlp's own transient-network retries
    '--retry-sleep', '5',
    '--socket-timeout', '30',
    '--ignore-errors',
  ];
  const cookieFile = String((settings && settings.cookieFile) || '').trim().replace(/^~(?=$|\/)/, process.env.HOME || '');
  if (cookieFile && fs.existsSync(cookieFile)) {
    args.push('--cookies', cookieFile);
  }
  return args;
}

// Run yt-dlp with: global serialization, randomized inter-call delay, and
// exponential backoff retries whenever YouTube rate limits us.
// `run(opts)` receives { addArgs, spawnOpts } and must resolve with { stdout }.
// `outputText(err)` extracts log text from whatever the run throws/rejects.
async function runYtDlpThrottled(run, opts = {}) {
  const cfg = getRateLimitConfig(opts.settings);

  // Chain onto the global queue so two yt-dlp calls never overlap.
  let release;
  const slot = new Promise((r) => (release = r));
  const prev = ytQueueTail;
  ytQueueTail = ytQueueTail.then(() => slot);
  await prev; // wait for our turn

  try {
    const attempts = cfg.enabled ? cfg.maxRetries + 1 : 1;
    let lastErr;
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (cfg.enabled) {
        // Randomized human-like pause before every call.
        await sleep(randInt(cfg.minDelayMs, cfg.maxDelayMs));
      }
      try {
        return await run({ addArgs: getYtDlpCommonArgs(opts.settings), spawnOpts: opts.spawnOpts || {} });
      } catch (err) {
        lastErr = err;
        const text = typeof opts.outputText === 'function' ? opts.outputText(err) : String((err && (err.stderr || err.message)) || '');
        if (!looksRateLimited(text) || attempt === attempts - 1) throw err;
        const backoff = cfg.baseBackoffMs * Math.pow(2, attempt) + randInt(0, 2000);
        console.log(`[yt-dlp] Rate limited by YouTube — backing off ${Math.round(backoff / 1000)}s (retry ${attempt + 1}/${cfg.maxRetries})`);
        await sleep(backoff);
      }
    }
    throw lastErr;
  } finally {
    release(); // let the next queued call proceed
  }
}

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
async function fetchYouTubePlaylist(url, settings) {
  const safeUrl = String(url).replace(/["'`$\\]/g, ''); // basic shell-safety for the URL
  try {
    const { stdout } = await runYtDlpThrottled(
      ({ addArgs }) => execAsync(`yt-dlp ${addArgs.join(' ')} --flat-playlist --dump-json "${safeUrl}"`, {
        maxBuffer: 50 * 1024 * 1024,
      }),
      { settings }
    );
    const lines = stdout.trim().split('\n').filter(Boolean);
    let playlistTitle = 'YouTube Playlist';
    const tracks = [];
    for (const line of lines) {
      let data;
      try {
        data = JSON.parse(line);
      } catch {
        continue; // skip any non-JSON warning lines yt-dlp may emit
      }
      if (data._type === 'playlist') {
        playlistTitle = data.title || playlistTitle;
        continue;
      }
      tracks.push({
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
      });
    }

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
    const text = `${err.stderr || ''} ${err.message || ''}`;
    if (looksRateLimited(text)) {
      throw new Error('YouTube is rate limiting this server ("Too many requests"). It will back off automatically — wait a few minutes and retry, or add a cookies file in Settings for higher limits.');
    }
    throw new Error(`Failed to fetch YouTube playlist: ${err.message}`);
  }
}

// Fetch Tidal playlist using API
async function fetchTidalPlaylist(url, settings) {
  // Obtain a valid access token automatically (refreshes expired tokens in the
  // background — the user only ever needs to paste Client ID + Client Secret).
  const tidalAccessToken = await getTidalAccessToken(settings);

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

  if (metaResponse.status === 401) {
    // Token may have been revoked server-side — force one refresh and retry.
    try {
      const freshToken = await refreshTidalToken(settings);
      const retryResponse = await fetch(`https://api.tidal.com/v1/playlists/${playlistId}?countryCode=US`, {
        headers: { 'Authorization': `Bearer ${freshToken}` },
      });
      if (retryResponse.ok) {
        return finishTidalPlaylistFetch(retryResponse, playlistId, url, freshToken);
      }
    } catch {}
    throw new Error('Tidal rejected the login (HTTP 401). Open Settings → Tidal and click "CONNECT TIDAL" again.');
  }

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

// Helper for the 401-retry path above (metadata already fetched OK)
async function finishTidalPlaylistFetch(metaResponse, playlistId, url, tidalAccessToken) {
  const meta = await metaResponse.json();
  const tracksResponse = await fetch(`https://api.tidal.com/v1/playlists/${playlistId}/tracks?countryCode=US&limit=100&offset=0`, {
    headers: { 'Authorization': `Bearer ${tidalAccessToken}` },
  });
  if (!tracksResponse.ok) {
    throw new Error(`Tidal API error fetching tracks: ${tracksResponse.status}`);
  }
  const tracksData = await tracksResponse.json();
  const tracks = (tracksData.items || []).map((item) => ({
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

// Build a user-friendly error from yt-dlp output / exit info
function buildDownloadError(rawOutput, exitCode, track, searchQuery) {
  const output = (rawOutput || '').trim();
  // Keep the most informative (last) ERROR line from yt-dlp for context
  const errorLines = output.split('\n').filter(l => /ERROR/i.test(l));
  const detail = errorLines.length ? errorLines[errorLines.length - 1].replace(/^\s*ERROR:\s*/i, '').trim() : '';
  const lower = detail.toLowerCase();

  let message;
  if (exitCode === 127 || /command not found/i.test(output)) {
    message = 'yt-dlp is not installed or not on your PATH';
  } else if (/unable to download api|sign in to confirm you.?re not a bot/i.test(lower)) {
    message = 'YouTube blocked the request ("Sign in to confirm you\'re not a bot")';
  } else if (/age[- ]?restricted/i.test(lower)) {
    message = 'This track is age-restricted and requires sign-in credentials';
  } else if (/video unavailable/i.test(lower)) {
    message = 'The source video is unavailable (removed, private, or region-locked)';
  } else if (/not a valid url|unsupported url/i.test(lower)) {
    message = 'The resolved media URL is invalid or unsupported';
  } else if (/no formats?(?: .*)?found|requested format is not available/i.test(lower)) {
    message = 'No audio stream is available for this track at the selected quality';
  } else if (/unable to extract (?:json|title|info)|get.*info.*failed/i.test(lower)) {
    message = 'Could not read metadata from the source site — it may be down or blocking requests';
  } else if (/network is unreachable|getaddrinfo|timed? ?out|connection refused|unable to download data|temporary error|ssl/i.test(lower)) {
    message = 'Network error while downloading — check your internet connection';
  } else if (/http error 403/i.test(lower)) {
    message = 'Access denied by the server (HTTP 403) — the link may have expired';
  } else if (/http error 404/i.test(lower)) {
    message = 'Media not found on the server (HTTP 404)';
  } else if (/http error 4\d{2}|http error 5\d{2}/i.test(lower)) {
    message = 'The media server returned an error response';
  } else if (/permission denied/i.test(lower)) {
    message = 'Permission denied writing to the download folder';
  } else if (/no space left/i.test(lower)) {
    message = 'Disk is full — free up space before retrying';
  } else if (/ffmpeg .*not found|couldn.?t find ffmpeg|is it installed/i.test(lower)) {
    message = 'ffmpeg is required to convert audio but was not found on your PATH';
  } else if (/download completed but file size was zero/i.test(lower)) {
    message = 'The download finished but produced an empty file';
  } else if (/fragment|retrying/i.test(lower) && /failed|giving up/i.test(lower)) {
    message = 'The stream dropped repeatedly before it could finish';
  } else if (detail) {
    message = `yt-dlp reported: ${detail}`;
  } else if (exitCode === null || exitCode === undefined) {
    message = 'The download process was terminated unexpectedly';
  } else {
    message = `yt-dlp failed with exit code ${exitCode}`;
  }

  const who = track ? `"${track.artist} – ${track.title}"` : 'this track';
  const hintMap = [
    [/not installed|not on your PATH/i, 'Install it with "pacman -S yt-dlp" (or "pip install -U yt-dlp") and restart the server.'],
    [/blocked the request|bot/i, 'Try again in a few minutes, update yt-dlp, or configure account cookies in Settings.'],
    [/age-restricted/i, 'Configure account cookies for YouTube in Settings, then retry this track.'],
    [/unavailable/i, 'Skip this track, or use Retry to manually match it against a different YouTube video.'],
    [/no audio stream|selected quality/i, 'Lower the audio quality/format in Settings, or skip this track.'],
    [/metadata from the source site/i, 'Update yt-dlp ("yt-dlp -U") — sites change frequently. Then retry.'],
    [/network/i, 'Check your internet connection, then retry this track.'],
    [/403/i, 'Retry the download — a fresh link will be requested automatically.'],
    [/404/i, 'The track may have been removed from the source site. Try searching for a different version.'],
    [/permission denied/i, 'Pick a writable output directory in Settings (check folder permissions).'],
    [/disk is full/i, 'Free up disk space, then retry this track.'],
    [/ffmpeg/i, 'Install ffmpeg with "pacman -S ffmpeg" and restart the server.'],
    [/empty file/i, 'Retry this track. If it keeps failing, try a different format.'],
    [/stream dropped/i, 'Retry when your connection is more stable.'],
    [/terminated unexpectedly/i, 'The process was killed (possibly out of memory). Try retrying this track.'],
  ];
  const hint = hintMap.find(([re]) => re.test(message))?.[1]
    || 'Retry this track. If it keeps failing, open the server terminal for the full yt-dlp log.';

  return {
    message: `Couldn't download ${who}: ${message}.`,
    hint,
    detail: detail || `yt-dlp exited with code ${exitCode}`,
  };
}

// Download a single track using yt-dlp (goes through the rate-limit-aware queue)
async function downloadTrack(track, settings, onProgress) {
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

  const baseArgs = [
    '-x',
    '--audio-format', ext,
    '--audio-quality', quality === '0' ? '0' : `${quality}K`,
    '-o', outputPath,
    '--no-playlist',
  ];

  if (settings.embedMetadata) {
    baseArgs.push('--embed-metadata');
  }
  if (settings.embedThumbnail) {
    baseArgs.push('--embed-thumbnail');
  }

  return runYtDlpThrottled(
    ({ addArgs }) =>
      new Promise((resolve, reject) => {
        const proc = spawn('yt-dlp', [...baseArgs, ...addArgs, searchQuery]);
        let lastProgress = 0;
        let stderrTail = '';

        proc.stderr.on('data', (data) => {
          const output = data.toString();

          // Keep the tail of stderr so we can build a helpful error message on failure
          stderrTail = (stderrTail + output).slice(-8000);

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
            const info = buildDownloadError(stderrTail, code, track, searchQuery);
            const err = new Error(info.message);
            err.hint = info.hint;
            err.detail = info.detail;
            // Carry the raw log so the queue can detect rate limiting and retry
            err.rawOutput = stderrTail;
            reject(err);
          }
        });

        proc.on('error', (err) => {
          if (err.code === 'ENOENT') {
            const info = buildDownloadError('', 127, track, searchQuery);
            const friendly = new Error(info.message);
            friendly.hint = info.hint;
            friendly.detail = 'yt-dlp executable not found';
            reject(friendly);
          } else {
            const info = buildDownloadError(err.message, null, track, searchQuery);
            const friendly = new Error(info.message);
            friendly.hint = info.hint;
            friendly.detail = err.message;
            reject(friendly);
          }
        });
      }),
    {
      settings,
      outputText: (err) => `${err.rawOutput || ''} ${err.stderr || ''} ${err.message || ''}`,
    }
  );
}

// Pre-flight checks before starting a download job; returns a friendly error string or null
async function checkDownloadPrerequisites(settings) {
  const ytDlpExists = await commandExists('yt-dlp');
  if (!ytDlpExists) {
    return 'Cannot start downloads: yt-dlp is not installed or not on your PATH. Install it with "pacman -S yt-dlp" (or "pip install -U yt-dlp") and restart the server.';
  }

  const needsFfmpeg = settings.embedThumbnail || settings.audioFormat !== 'best';
  if (needsFfmpeg && !(await commandExists('ffmpeg'))) {
    return 'Cannot start downloads: ffmpeg is required to convert audio and embed metadata/thumbnails, but it was not found on your PATH. Install it with "pacman -S ffmpeg" and restart the server.';
  }

  const outputDir = String(settings.outputDir || '').replace('~', process.env.HOME || '');
  try {
    fs.mkdirSync(outputDir, { recursive: true });
    fs.accessSync(outputDir, fs.constants.W_OK);
  } catch (err) {
    if (err.code === 'EACCES' || err.code === 'EPERM') {
      return `Cannot start downloads: no permission to write to "${settings.outputDir}". Choose a different output directory in Settings.`;
    }
    if (err.code === 'ENOSPC') {
      return `Cannot start downloads: disk is full while preparing "${settings.outputDir}". Free up space and try again.`;
    }
    return `Cannot start downloads: output directory "${settings.outputDir}" is not usable (${err.message}). Check the path in Settings.`;
  }

  return null;
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

  const mergedFetchSettings = { ...currentSettings, ...(settings || {}) };

  try {
    let playlist;
    if (source === 'youtube') {
      playlist = await fetchYouTubePlaylist(url, mergedFetchSettings);
    } else {
      playlist = await fetchTidalPlaylist(url, mergedFetchSettings);
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

  // Fail fast with a clear message instead of erroring on every track
  const prereqError = await checkDownloadPrerequisites(mergedSettings);
  if (prereqError) {
    return res.status(503).json({ error: prereqError });
  }

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
        track.errorHint = err.hint || '';
        track.errorDetail = err.detail || err.message;
      }
    }
    
    if (!job.cancelled) {
      job.status = 'completed';
      playlist.status = 'completed';

      // Summarize any failures so the UI can show one clear, actionable message
      const failed = playlist.tracks.filter(t => t.status === 'error');
      if (failed.length > 0) {
        const first = failed[0];
        job.errorSummary = {
          count: failed.length,
          total: playlist.tracks.length,
          message: `${failed.length} of ${playlist.tracks.length} tracks failed to download.`,
          example: first.error,
          hint: first.errorHint || 'Open the failing tracks to see details, then retry or skip them.',
        };
      }
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
    errorSummary: job.errorSummary || null,
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
    const safeQuery = String(query || '').replace(/["'`$\\]/g, ''); // basic shell-safety
    const { stdout } = await runYtDlpThrottled(
      ({ addArgs }) => execAsync(`yt-dlp ${addArgs.join(' ')} --flat-playlist --dump-json "ytsearch5:${safeQuery}"`, {
        maxBuffer: 10 * 1024 * 1024,
      }),
      {}
    );
    const lines = stdout.trim().split('\n').filter(Boolean);
    const results = [];
    for (const line of lines) {
      let data;
      try {
        data = JSON.parse(line);
      } catch {
        continue;
      }
      if (data._type === 'playlist') continue;
      results.push({
        id: data.id,
        title: data.title,
        artist: data.uploader || '',
        duration: data.duration,
        thumbnail: data.thumbnail,
      });
    }
    res.json(results);
  } catch (err) {
    const text = `${err.stderr || ''} ${err.message || ''}`;
    if (looksRateLimited(text)) {
      return res.status(429).json({ error: 'YouTube is rate limiting searches right now. Wait a minute or two and try again.' });
    }
    res.status(500).json({ error: err.message });
  }
});

// Serve static frontend files in production
const distPath = path.join(__dirname, '..', 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('/{*splat}', (req, res) => {
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
