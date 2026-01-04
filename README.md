# Meme Video Generator 🎬

Automated vertical (9:16) video generator for YouTube Shorts/TikTok. Combines gameplay footage with Reddit meme overlays.

## Prerequisites

- **Node.js** v16+
- **FFmpeg** installed and in PATH
  - Mac: `brew install ffmpeg`
  - Windows: Download from [ffmpeg.org](https://ffmpeg.org) and add to PATH

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Add a 16:9 gameplay video to `assets/backgrounds/`

3. (Optional) Add music tracks to `assets/music/`

4. Configure `.env` (optional):
   ```env
   REDDIT_SUBREDDIT=memes
   ```

## Usage

```bash
npm start
# or
node index.js
```

The script will:
1. Select a random background video
2. Fetch the top meme from Reddit
3. Create a 15-second vertical video with the meme overlaid
4. Save to `output/` with a timestamped filename

## Output Specs

- Resolution: 1080x1920 (9:16)
- Codec: H.264/AAC
- Duration: 15 seconds
- FPS: 30

## Customization

Edit `.env` to change:
- `REDDIT_SUBREDDIT` - Source subreddit (default: memes)
- `BLUR_INTENSITY` - Background blur amount (default: 10)
- `OUTPUT_WIDTH/HEIGHT` - Video dimensions
