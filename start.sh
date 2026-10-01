#!/bin/bash
# Playlist Ripper - Start Script for Arch Linux / CachyOS

echo "🎵 Playlist Ripper - Starting..."
echo ""

# Check dependencies
check_dep() {
    if ! command -v "$1" &> /dev/null; then
        echo "❌ $1 is not installed!"
        case "$1" in
            node)
                echo "   Install with: sudo pacman -S nodejs"
                ;;
            ffmpeg)
                echo "   Install with: sudo pacman -S ffmpeg"
                ;;
            yt-dlp)
                echo "   Install with: sudo pacman -S yt-dlp"
                echo "   Or: pip install --user yt-dlp"
                ;;
        esac
        exit 1
    else
        echo "✅ $1 found: $(command -v $1)"
    fi
}

echo "Checking dependencies..."
check_dep node
check_dep ffmpeg
check_dep yt-dlp
echo ""

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
    echo ""
fi

# Check if dist exists
if [ ! -d "dist" ]; then
    echo "🔨 Building frontend..."
    npm run build
    echo ""
fi

# Create download directory
DOWNLOAD_DIR="${HOME}/Music/Downloads"
if [ ! -d "$DOWNLOAD_DIR" ]; then
    echo "📁 Creating download directory: $DOWNLOAD_DIR"
    mkdir -p "$DOWNLOAD_DIR"
fi

echo "🚀 Starting server..."
echo "   Open http://localhost:3001 in your browser"
echo ""
node server/index.js
