#!/usr/bin/env node

/**
 * Distributed Video Generator & Scheduler
 * 
 * Two-phase workflow for maximum meme freshness:
 * 
 * Phase 1: Generate videos throughout the day (run every 4 hours via cron)
 *   node scheduler.js generate
 * 
 * Phase 2: Upload all pending videos at peak US hours
 *   node scheduler.js upload
 * 
 * Usage:
 *   npm run generate-one       # Generate 1 video (run every 4 hours)
 *   npm run upload-all         # Upload all pending videos to YouTube
 *   npm run batch:upload       # Generate 6 + upload immediately (old behavior)
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const uploader = require('./uploader');

// Configuration
const CONFIG = {
  peakHoursEST: {
    start: 18, // 6:00 PM EST
  },
  gapMinutes: 30,
  outputDir: path.join(__dirname, 'output'),
  tempDir: path.join(__dirname, '.temp'),
};

/**
 * Parse command line arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const command = args[0] || 'help';
  return {
    command,
    count: parseInt(args.find((_, i) => args[i - 1] === '--count') || 6),
    dryRun: args.includes('--dry-run'),
  };
}

/**
 * Calculate scheduled publish times at peak US hours
 * @param {number} count - Number of videos to schedule
 * @returns {Date[]} Array of publish times
 */
function calculateSchedule(count) {
  const now = new Date();
  
  // Calculate EST offset (simplified, not accounting for DST)
  const estOffset = -5;
  
  // Get current EST hour
  const utcHour = now.getUTCHours();
  const estHour = (utcHour + estOffset + 24) % 24;
  
  // Determine if we schedule for today or tomorrow
  // Peak ends at start + (count * gap / 60)
  const peakEnd = CONFIG.peakHoursEST.start + Math.ceil((count * CONFIG.gapMinutes) / 60);
  const scheduleForTomorrow = estHour >= CONFIG.peakHoursEST.start;
  
  const schedule = [];
  
  for (let i = 0; i < count; i++) {
    const publishTime = new Date(now);
    
    // Set date to tomorrow if too late today
    if (scheduleForTomorrow) {
      publishTime.setUTCDate(publishTime.getUTCDate() + 1);
    }
    
    // Calculate target time: 6 PM EST = 23:00 UTC (in winter)
    const targetESTHour = CONFIG.peakHoursEST.start;
    const slotMinutes = i * CONFIG.gapMinutes;
    const targetUTCHour = (targetESTHour - estOffset + Math.floor(slotMinutes / 60)) % 24;
    const targetUTCMinutes = slotMinutes % 60;
    
    publishTime.setUTCHours(targetUTCHour, targetUTCMinutes, 0, 0);
    
    // Ensure at least 15 min in future
    const minTime = new Date(Date.now() + 15 * 60 * 1000);
    if (publishTime < minTime) {
      publishTime.setUTCDate(publishTime.getUTCDate() + 1);
    }
    
    schedule.push(publishTime);
  }
  
  return schedule;
}

/**
 * Get pending videos from output directory (not yet uploaded)
 * @returns {string[]} Array of video file paths, oldest first
 */
function getPendingVideos() {
  if (!fs.existsSync(CONFIG.outputDir)) {
    return [];
  }
  
  return fs.readdirSync(CONFIG.outputDir)
    .filter(f => f.endsWith('.mp4'))
    .map(f => path.join(CONFIG.outputDir, f))
    .sort((a, b) => fs.statSync(a).mtime - fs.statSync(b).mtime); // Oldest first
}

/**
 * Generate a single video
 */
async function generateSingleVideo() {
  const ffmpeg = require('fluent-ffmpeg');
  const axios = require('axios');
  
  const indexConfig = {
    memeSources: [
      'r/memes', 'r/dankmemes', 'r/funny', 'r/rareinsults', 'r/clevercomebacks',
      'r/murderedbywords', 'r/facepalm', 'r/HistoryMemes', 'r/ProgrammerHumor',
      'r/MinecraftMemes', 'r/ROBLOXmemes', 'r/wholesomememes',
      'u/The-LSD-Sheet-Guy', 'u/BoredomFestival', 'u/misthi_S', 'u/Idea99', 'u/Beer_Is_Good_V_2',
    ],
    outputWidth: parseInt(process.env.OUTPUT_WIDTH) || 1080,
    outputHeight: parseInt(process.env.OUTPUT_HEIGHT) || 1920,
    backgroundsDir: path.join(__dirname, 'assets', 'backgrounds'),
    musicDir: path.join(__dirname, 'assets', 'music'),
    outputDir: CONFIG.outputDir,
    tempDir: CONFIG.tempDir,
  };
  
  // Ensure directories exist
  [indexConfig.outputDir, indexConfig.tempDir].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });
  
  // Helper functions
  function getRandomFileFromDir(dirPath, extensions = []) {
    if (!fs.existsSync(dirPath)) return null;
    let files = fs.readdirSync(dirPath);
    if (extensions.length > 0) {
      files = files.filter(file => extensions.some(ext => file.toLowerCase().endsWith(ext)));
    }
    files = files.filter(file => !file.startsWith('.'));
    if (files.length === 0) return null;
    return path.join(dirPath, files[Math.floor(Math.random() * files.length)]);
  }
  
  async function fetchMemeFromSource(source) {
    const isUser = source.startsWith('u/');
    const name = source.substring(2);
    const url = isUser
      ? `https://www.reddit.com/user/${name}/submitted.json?limit=25&sort=top&t=day`
      : `https://www.reddit.com/r/${name}/top.json?limit=25&t=day`;
    
    try {
      const response = await axios.get(url, { headers: { 'User-Agent': 'MemeVideoBot/1.0' } });
      const posts = response.data.data.children;
      const imagePosts = posts.filter(post => {
        const postUrl = post.data.url || '';
        return postUrl.includes('i.redd.it') || postUrl.includes('i.imgur.com') ||
               postUrl.endsWith('.jpg') || postUrl.endsWith('.jpeg') ||
               postUrl.endsWith('.png') || postUrl.endsWith('.gif');
      });
      if (imagePosts.length === 0) return null;
      const post = imagePosts[Math.floor(Math.random() * Math.min(5, imagePosts.length))].data;
      return { title: post.title, url: post.url, author: post.author, source };
    } catch { return null; }
  }
  
  async function fetchMemes(count) {
    const memes = [];
    const triedSources = new Set();
    while (memes.length < count && triedSources.size < indexConfig.memeSources.length) {
      const availableSources = indexConfig.memeSources.filter(s => !triedSources.has(s));
      const source = availableSources[Math.floor(Math.random() * availableSources.length)];
      triedSources.add(source);
      const meme = await fetchMemeFromSource(source);
      if (meme) memes.push(meme);
    }
    if (memes.length < count) throw new Error(`Could only find ${memes.length} memes`);
    return memes;
  }
  
  async function downloadImage(url, outputPath) {
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
      timeout: 30000,
    });
    
    const buffer = Buffer.from(response.data);
    
    // Validate image signature
    const isJPEG = buffer[0] === 0xFF && buffer[1] === 0xD8;
    const isPNG = buffer[0] === 0x89 && buffer[1] === 0x50;
    const isGIF = buffer[0] === 0x47 && buffer[1] === 0x49;
    const isWEBP = buffer.length > 11 && buffer[8] === 0x57 && buffer[9] === 0x45;
    
    if (!isJPEG && !isPNG && !isGIF && !isWEBP) {
      const preview = buffer.slice(0, 100).toString('utf-8').toLowerCase();
      if (preview.includes('<html') || preview.includes('<!doctype')) {
        throw new Error('Got HTML instead of image');
      }
      throw new Error('Invalid image format');
    }
    
    // Correct extension
    let correctedPath = outputPath;
    if (isJPEG) correctedPath = outputPath.replace(/\.[^.]+$/, '.jpg');
    else if (isPNG) correctedPath = outputPath.replace(/\.[^.]+$/, '.png');
    else if (isGIF) correctedPath = outputPath.replace(/\.[^.]+$/, '.gif');
    
    fs.writeFileSync(correctedPath, buffer);
    return correctedPath;
  }
  
  // Generate video
  console.log('🎬 Generating single video...\n');
  
  const backgroundPath = getRandomFileFromDir(indexConfig.backgroundsDir, ['.mp4', '.mov', '.avi', '.mkv', '.webm']);
  if (!backgroundPath) throw new Error('No background videos found');
  console.log(`📹 Background: ${path.basename(backgroundPath)}`);
  
  const musicPath = getRandomFileFromDir(indexConfig.musicDir, ['.mp3', '.wav', '.aac', '.m4a']);
  if (musicPath) console.log(`🎵 Music: ${path.basename(musicPath)}`);
  
  const memes = await fetchMemes(2);
  memes.forEach((m, i) => console.log(`📷 Meme ${i + 1}: "${m.title.substring(0, 50)}..."`));
  
  const memePaths = [];
  for (let i = 0; i < memes.length; i++) {
    const ext = path.extname(memes[i].url) || '.jpg';
    const tempPath = path.join(indexConfig.tempDir, `meme${i + 1}${ext}`);
    await downloadImage(memes[i].url, tempPath);
    memePaths.push(tempPath);
  }
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
  const outputPath = path.join(indexConfig.outputDir, `meme_video_${timestamp}.mp4`);
  
  await new Promise((resolve, reject) => {
    const { outputWidth, outputHeight } = indexConfig;
    const complexFilter = [
      `[0:v]scale=${outputWidth}:${outputHeight}:force_original_aspect_ratio=increase,crop=${outputWidth}:${outputHeight}[bg]`,
      `[1:v]scale=1000:700:force_original_aspect_ratio=decrease,pad=max(iw\\,1000):ih+40:(ow-iw)/2:0:black@0[meme1]`,
      `[2:v]scale=1000:700:force_original_aspect_ratio=decrease,pad=max(iw\\,1000):ih:(ow-iw)/2:0:black@0[meme2]`,
      `[meme1][meme2]vstack=inputs=2[stacked]`,
      `[bg][stacked]overlay=(W-w)/2:(H-h)/2`
    ].join(';');
    
    let cmd = ffmpeg().input(backgroundPath).input(memePaths[0]).input(memePaths[1])
      .complexFilter(complexFilter)
      .outputOptions(['-c:v', 'libx264', '-preset', 'medium', '-crf', '23', '-pix_fmt', 'yuv420p', '-t', '15', '-r', '30']);
    
    if (musicPath) {
      cmd.input(musicPath).outputOptions(['-map', '0:a', '-c:a', 'aac', '-b:a', '192k', '-shortest']);
    } else {
      cmd.outputOptions(['-map', '0:a?', '-c:a', 'aac', '-b:a', '192k', '-shortest']);
    }
    
    cmd.output(outputPath)
      .on('progress', p => p.percent && process.stdout.write(`\r⏳ ${Math.round(p.percent)}%`))
      .on('end', () => { console.log('\n'); resolve(); })
      .on('error', reject)
      .run();
  });
  
  // Cleanup temp
  memePaths.forEach(p => fs.existsSync(p) && fs.unlinkSync(p));
  
  console.log(`✅ Video created: ${path.basename(outputPath)}`);
  return outputPath;
}

/**
 * Delete a video file
 */
function deleteVideo(videoPath) {
  if (fs.existsSync(videoPath)) {
    fs.unlinkSync(videoPath);
    console.log(`🗑️  Deleted: ${path.basename(videoPath)}`);
  }
}

/**
 * Upload all pending videos with scheduled times
 */
async function uploadAllPending(options = {}) {
  const { dryRun = false } = options;
  
  const pendingVideos = getPendingVideos();
  
  if (pendingVideos.length === 0) {
    console.log('📭 No pending videos to upload');
    console.log('   Generate videos first with: npm run generate-one');
    return [];
  }
  
  console.log(`📹 Found ${pendingVideos.length} pending video(s)`);
  
  // Calculate schedule
  const schedule = calculateSchedule(pendingVideos.length);
  
  console.log('\n📅 Upload Schedule:');
  schedule.forEach((time, i) => {
    console.log(`   ${i + 1}. ${time.toLocaleString()}`);
  });
  
  if (dryRun) {
    console.log('\n🧪 Dry run - skipping actual uploads');
    return pendingVideos.map((p, i) => ({ videoPath: p, scheduledFor: schedule[i], dryRun: true }));
  }
  
  // Upload each video
  const results = [];
  
  for (let i = 0; i < pendingVideos.length; i++) {
    const videoPath = pendingVideos[i];
    const publishTime = schedule[i];
    
    console.log(`\n📤 Uploading ${i + 1}/${pendingVideos.length}: ${path.basename(videoPath)}`);
    
    try {
      const result = await uploader.uploadVideo(videoPath, {
        privacyStatus: 'private',
        publishAt: publishTime.toISOString(),
      });
      
      results.push({ ...result, videoPath, scheduledFor: publishTime });
      deleteVideo(videoPath);
      
    } catch (error) {
      console.error(`   ❌ Failed: ${error.message}`);
      results.push({ success: false, error: error.message, videoPath });
      console.log('   ⏭️  Keeping for retry');
    }
  }
  
  return results;
}

/**
 * Show help
 */
function showHelp() {
  console.log(`
🎬 Meme Video Scheduler

Commands:
  generate      Generate 1 video (run every 4 hours via cron)
  upload        Upload all pending videos at peak US hours
  batch         Generate multiple videos + upload immediately
  status        Show pending videos count
  help          Show this help

Examples:
  node scheduler.js generate          # Generate 1 video
  node scheduler.js upload            # Upload all pending
  node scheduler.js upload --dry-run  # Preview upload schedule
  node scheduler.js batch --count 6   # Old behavior: generate 6 + upload

Cron Setup (generate every 4 hours):
  0 */4 * * * cd ${__dirname} && node scheduler.js generate >> cron.log 2>&1
`);
}

/**
 * Show status
 */
function showStatus() {
  const pending = getPendingVideos();
  console.log(`📊 Status:`);
  console.log(`   Pending videos: ${pending.length}`);
  if (pending.length > 0) {
    console.log(`\n   Files:`);
    pending.forEach(p => console.log(`   - ${path.basename(p)}`));
  }
}

/**
 * Main
 */
async function main() {
  const args = parseArgs();
  
  console.log('🎬 Meme Video Scheduler');
  console.log('═'.repeat(40) + '\n');
  
  switch (args.command) {
    case 'generate':
      await generateSingleVideo();
      const afterGen = getPendingVideos();
      console.log(`\n📊 Total pending: ${afterGen.length} video(s)`);
      console.log('   Run "npm run upload-all" when ready to schedule uploads');
      break;
      
    case 'upload':
      if (!uploader.isConfigured()) {
        console.error('❌ YouTube upload requires client_secrets.json');
        process.exit(1);
      }
      const results = await uploadAllPending({ dryRun: args.dryRun });
      const ok = results.filter(r => r.success).length;
      const fail = results.filter(r => !r.success).length;
      console.log(`\n✅ Uploaded: ${ok} | ❌ Failed: ${fail}`);
      break;
      
    case 'batch':
      // Old behavior: generate N videos then upload
      console.log(`Generating ${args.count} videos...\n`);
      for (let i = 0; i < args.count; i++) {
        console.log(`\n[${i + 1}/${args.count}]`);
        await generateSingleVideo();
      }
      if (!args.dryRun && uploader.isConfigured()) {
        await uploadAllPending({ dryRun: args.dryRun });
      }
      break;
      
    case 'status':
      showStatus();
      break;
      
    default:
      showHelp();
  }
}

main().catch(err => {
  console.error(`\n❌ Error: ${err.message}`);
  process.exit(1);
});
