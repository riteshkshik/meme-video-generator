# Meme Video Generator 🎬

Automated vertical (9:16) video generator for YouTube Shorts/TikTok. Combines gameplay footage with Reddit meme overlays and optionally uploads directly to YouTube.

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

### Generate Video Only
```bash
npm start
# or
node index.js
```

### Generate and Upload to YouTube
```bash
node index.js --upload           # Upload as private (recommended for testing)
node index.js --upload --public  # Upload as public
```

### Distributed Mode: Fresh Memes Every 4 Hours (Recommended)

Generate 1 video every 4 hours for fresh memes, then upload all at peak hours:

```bash
# Generate 1 video (run manually or via cron)
npm run generate-one

# Check how many videos are pending
npm run status

# Upload all pending videos at peak US hours
npm run upload-all
```

**Cron Setup (macOS/Linux):**
```bash
# Edit crontab
crontab -e

# Add this line to generate a video every 4 hours:
0 */4 * * * cd /path/to/meme-video-generation && npm run generate-one >> cron.log 2>&1

# Add this line to upload at 5 PM EST (10 PM UTC):
0 22 * * * cd /path/to/meme-video-generation && npm run upload-all >> cron.log 2>&1
```

### Quick Batch Mode
```bash
npm run batch:upload       # Generate 6 videos immediately + schedule uploads
```

**Key features:**
- Uploads scheduled for **6:00 PM - 8:30 PM EST** (30-minute gaps)
- Videos uploaded as **private**, auto-publish at scheduled time
- **Auto-cleanup**: Deletes video after successful upload
- **Retry support**: Failed uploads keep the file for later

The script will:
1. Select a random background video
2. Fetch top memes from Reddit (2 sources)
3. Create a 15-second vertical video with memes overlaid
4. Save to `output/` with a timestamped filename
5. (If uploading) Schedule to YouTube with auto-generated metadata

## YouTube Upload Setup

To enable YouTube uploads, you need to set up Google Cloud credentials:

### Step 1: Create a Google Cloud Project
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or select an existing one)
3. Note your project name for later

### Step 2: Enable YouTube Data API
1. Go to **APIs & Services** → **Library**
2. Search for "YouTube Data API v3"
3. Click **Enable**

### Step 3: Configure OAuth Consent Screen
1. Go to **APIs & Services** → **OAuth consent screen**
2. Select **External** and click Create
3. Fill in the required fields (App name, User support email)
4. Add your email to **Test users**
5. Save and continue through all steps

### Step 4: Create OAuth Credentials
1. Go to **APIs & Services** → **Credentials**
2. Click **Create Credentials** → **OAuth client ID**
3. Select **Desktop app** as application type
4. Click **Create**
5. Click **Download JSON**
6. Save the file as `client_secrets.json` in the project root

### First-Time Authorization

When you run with `--upload` for the first time:
1. The script will print an authorization URL
2. Open the URL in your browser
3. Sign in and grant access
4. Copy the authorization code
5. Paste it back into the terminal

The token is saved to `token.json` and reused for future uploads.

> **Note:** YouTube API has a daily quota of 10,000 units. Video uploads cost 1600 units each, allowing ~6 uploads per day on the default quota.

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

## Upload Metadata

When uploading, the script automatically generates:
- **Title**: Uses meme caption or a catchy random title
- **Description**: Includes featured memes and hashtags
- **Tags**: memes, shorts, funny, viral, comedy, etc.
- **Category**: Entertainment
- **Privacy**: Private by default (use `--public` to make public)

