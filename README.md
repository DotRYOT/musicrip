# 🎵 Playlist Ripper

A web application for downloading audio from **YouTube Music** and **Tidal** playlists to your local machine. Built for Arch Linux / CachyOS.

![Playlist Ripper](https://img.shields.io/badge/Platform-Arch%20Linux%20%2F%20CachyOS-blue) ![Node](https://img.shields.io/badge/Node.js-18+-green) ![License](https://img.shields.io/badge/License-MIT-yellow)

## Features

- 🎶 Import playlists from YouTube Music, YouTube, or Tidal
- 🔄 Auto-searches YouTube Music for Tidal tracks
- 📊 Real-time download progress tracking
- ⏸️ Pause, resume, and cancel downloads
- 🏷️ Embeds metadata (title, artist, album, thumbnail)
- 🎛️ Multiple audio formats: MP3, FLAC, Opus, M4A
- 🔧 Configurable naming templates and quality settings
- 🔐 Secure Tidal API integration

---

## 📋 Prerequisites (Arch Linux / CachyOS)

### System Dependencies

Install all required packages using pacman/paru:

```bash
# Core dependencies
sudo pacman -S nodejs npm ffmpeg yt-dlp

# Or if you prefer the AUR version of yt-dlp (often more up to date):
paru -S yt-dlp

# Alternative: install yt-dlp via pip (user-level)
pip install --user yt-dlp
# Make sure ~/.local/bin is in your PATH
```

### Verify Installation

```bash
node --version    # Should be 18+
npm --version     # Should be 9+
ffmpeg -version   # Should show ffmpeg version
yt-dlp --version  # Should show yt-dlp version
```

### Optional Dependencies

```bash
# For better YouTube Music metadata extraction
sudo pacman -S python-mutagen

# For high-quality Tidal streaming (if using lossless)
sudo pacman -S python-requests
```

---

## 🚀 Installation

### 1. Clone the Repository

```bash
git clone https://github.com/DotRYOT/musicrip.git playlist-ripper
cd playlist-ripper
```

### 2. Install Node.js Dependencies

```bash
npm install
```

### 3. Build the Frontend

```bash
npm run build
```

### 4. Start the Server

```bash
# Production mode (serves both frontend and API)
node server/index.js

# Development mode (frontend on :3000, API on :3001)
# Terminal 1 - Start backend:
node server/index.js

# Terminal 2 - Start frontend dev server:
npm run dev
```

The application will be available at:
- **Production**: http://localhost:3001
- **Development**: http://localhost:3000

---

## ⚙️ Configuration

### Tidal Setup (Client ID + Client Secret only)

1. Go to [Tidal Developer Portal](https://developer.tidal.com/)
2. Create an application to get your **Client ID** and **Client Secret**
3. In the app's settings, add this OAuth redirect URI: `http://localhost:3001/api/tidal/callback`
4. Open the web UI → **[SETTINGS]** → paste the two values into the *TIDAL CONNECTION* card
5. Click **[CONNECT TIDAL]** — a Tidal login window opens; after you log in, the access
   token is fetched, saved, and auto-refreshed for you. Nothing else to configure.

<details>
<summary>Advanced: manual access token (optional)</summary>

If you prefer, you can still paste an access token directly under
*[ADVANCED: MANUAL TOKENS]* in the settings card. To generate one via the OAuth2 flow manually:

```bash
# Step 1: Get authorization URL (replace YOUR_CLIENT_ID)
echo "https://login.tidal.com/authorize?response_type=code&client_id=YOUR_CLIENT_ID&redirect_uri=http://localhost:3001/api/tidal/callback&scope=r.usersonlyplaylists+offline_access&code_challenge_method=S256"

# Step 2: After authorizing, exchange the code for a token
curl -X POST "https://auth.tidal.com/v1/oauth2/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=authorization_code" \
  -d "client_id=YOUR_CLIENT_ID" \
  -d "client_secret=YOUR_CLIENT_SECRET" \
  -d "code=AUTH_CODE_FROM_STEP_1" \
  -d "redirect_uri=http://localhost:3001/api/tidal/callback"
```
</details>

### Settings

All settings can be configured through the web UI:

| Setting | Description | Default |
|---------|-------------|---------|
| Output Directory | Where to save downloaded files | `~/Music/Downloads` |
| Audio Format | MP3, FLAC, Opus, or M4A | MP3 |
| Audio Quality | Bitrate in kbps (or 0 for best) | 320 |
| Naming Template | File naming pattern | `{artist} - {title}` |
| Embed Metadata | Write ID3/Vorbis tags | ✅ |
| Embed Thumbnail | Embed album art | ✅ |

---

## 📖 Usage

### YouTube Music Playlist

1. Copy the playlist URL from YouTube Music
   - Example: `https://music.youtube.com/playlist?list=PLxxxxxx`
2. Paste it into the input field
3. Click "Fetch Playlist"
4. Review the track list
5. Click "Download All"

### Tidal Playlist

1. Copy the playlist URL from Tidal
   - Example: `https://tidal.com/playlist/xxxxxx-xxxx-xxxx`
2. Make sure your Tidal API credentials are configured in Settings
3. Paste the URL and click "Fetch Playlist"
4. Tracks will be searched on YouTube Music and downloaded
5. Click "Download All"

### Supported URL Formats

- `https://music.youtube.com/playlist?list=PL...`
- `https://www.youtube.com/playlist?list=PL...`
- `https://youtu.be/...` (single video)
- `https://tidal.com/playlist/...`
- `https://listen.tidal.com/playlist/...`

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────┐
│                   Frontend (React)                    │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────┐ │
│  │ Playlist │ │  Track   │ │ Progress │ │Settings│ │
│  │  Input   │ │  List    │ │  Bar     │ │ Panel  │ │
│  └──────────┘ └──────────┘ └──────────┘ └────────┘ │
└──────────────────────┬──────────────────────────────┘
                       │ HTTP API
┌──────────────────────┴──────────────────────────────┐
│                 Backend (Express)                     │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────┐ │
│  │  Tidal   │ │ YouTube  │ │ Download │ │  Job   │ │
│  │   API    │ │  Music   │ │  Queue   │ │Manager │ │
│  └──────────┘ └──────────┘ └──────────┘ └────────┘ │
└──────────────────────┬──────────────────────────────┘
                       │
              ┌────────┴────────┐
              │     yt-dlp      │
              │   + ffmpeg      │
              └─────────────────┘
```

---

## 🔧 Development

### Project Structure

```
playlist-ripper/
├── src/                    # Frontend React source
│   ├── App.tsx            # Main application component
│   ├── api.ts             # API client
│   ├── types.ts           # TypeScript types
│   ├── main.tsx           # Entry point
│   └── index.css          # Global styles
├── server/
│   └── index.js           # Backend Express server
├── index.html             # HTML template
├── vite.config.js         # Vite configuration
├── package.json           # Dependencies
└── README.md              # This file
```

### Development Commands

```bash
# Start frontend dev server (with hot reload)
npm run dev

# Build for production
npm run build

# Type check
npm run typecheck

# Start backend server
node server/index.js
```

---

## 🐛 Troubleshooting

### yt-dlp not found

```bash
# Install via pacman
sudo pacman -S yt-dlp

# Or via pip
pip install --user yt-dlp
export PATH="$HOME/.local/bin:$PATH"
```

### ffmpeg not found

```bash
sudo pacman -S ffmpeg
```

### Tidal API errors

- Verify your access token hasn't expired (they typically last 7 days)
- Check that your API key has the correct scopes
- Ensure your Tidal subscription is active for the content you're accessing

### Download fails for some tracks

- Some tracks may be region-restricted
- Try changing the search query format in the naming template
- Check that yt-dlp is up to date: `yt-dlp -U`

### Permission errors on output directory

```bash
# Ensure the output directory exists and is writable
mkdir -p ~/Music/Downloads
chmod 755 ~/Music/Downloads
```

### Port already in use

```bash
# Find what's using port 3001
lsof -i :3001

# Kill the process
kill -9 <PID>

# Or use a different port (edit server/index.js)
```

---

## 🔒 Legal Notice

This tool is for personal use only. Please respect copyright laws and the Terms of Service of YouTube Music and Tidal. Downloading copyrighted content without authorization may be illegal in your jurisdiction.

---

## 📝 License

MIT License - Feel free to use and modify as needed.

---

## 🙏 Credits

- [yt-dlp](https://github.com/yt-dlp/yt-dlp) - YouTube/downloader
- [ffmpeg](https://ffmpeg.org/) - Audio processing
- [Tidal API](https://developer.tidal.com/) - Tidal playlist data
- [React](https://react.dev/) - Frontend framework
- [Tailwind CSS](https://tailwindcss.com/) - Styling
