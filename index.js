require('dotenv').config();
const ffmpeg = require('fluent-ffmpeg');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const uploader = require('./uploader');

// Configuration
const CONFIG = {
  // Meme sources - subreddits (r/) and users (u/)
  memeSources: [
    'r/memes',
    'r/dankmemes',
    'r/funny',
    'r/rareinsults',
    'r/clevercomebacks',
    'r/murderedbywords',
    'r/facepalm',
    'r/HistoryMemes',
    'r/ProgrammerHumor',
    'r/MinecraftMemes',
    'r/ROBLOXmemes',
    'r/wholesomememes',
    'u/The-LSD-Sheet-Guy',
    'u/BoredomFestival',
    'u/misthi_S',
    'u/Idea99',
    'u/Beer_Is_Good_V_2',
  ],
  outputWidth: parseInt(process.env.OUTPUT_WIDTH) || 1080,
  outputHeight: parseInt(process.env.OUTPUT_HEIGHT) || 1920,
  blurIntensity: parseInt(process.env.BLUR_INTENSITY) || 10,
  backgroundsDir: path.join(__dirname, 'assets', 'backgrounds'),
  musicDir: path.join(__dirname, 'assets', 'music'),
  outputDir: path.join(__dirname, 'output'),
  tempDir: path.join(__dirname, '.temp'),
};

// Ensure directories exist
[CONFIG.outputDir, CONFIG.tempDir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

/**
 * Get a random file from a directory
 */
function getRandomFileFromDir(dirPath, extensions = []) {
  if (!fs.existsSync(dirPath)) {
    return null;
  }

  let files = fs.readdirSync(dirPath);
  
  if (extensions.length > 0) {
    files = files.filter(file => 
      extensions.some(ext => file.toLowerCase().endsWith(ext))
    );
  }

  // Filter out hidden files
  files = files.filter(file => !file.startsWith('.'));

  if (files.length === 0) {
    return null;
  }

  const randomIndex = Math.floor(Math.random() * files.length);
  return path.join(dirPath, files[randomIndex]);
}

/**
 * Get random background video from assets/backgrounds
 */
function getRandomBackground() {
  const videoExtensions = ['.mp4', '.mov', '.avi', '.mkv', '.webm'];
  const backgroundPath = getRandomFileFromDir(CONFIG.backgroundsDir, videoExtensions);
  
  if (!backgroundPath) {
    throw new Error(`No video files found in ${CONFIG.backgroundsDir}. Please add a 16:9 gameplay video.`);
  }
  
  console.log(`📹 Selected background: ${path.basename(backgroundPath)}`);
  return backgroundPath;
}

/**
 * Get random music track from assets/music (optional)
 */
function getRandomMusic() {
  const audioExtensions = ['.mp3', '.wav', '.aac', '.m4a'];
  const musicPath = getRandomFileFromDir(CONFIG.musicDir, audioExtensions);
  
  if (musicPath) {
    console.log(`🎵 Selected music: ${path.basename(musicPath)}`);
  }
  
  return musicPath;
}

/**
 * Get random meme sources from the list
 */
function getRandomSources(count = 2) {
  const sources = [...CONFIG.memeSources];
  const selected = [];
  
  for (let i = 0; i < count && sources.length > 0; i++) {
    const randomIndex = Math.floor(Math.random() * sources.length);
    selected.push(sources.splice(randomIndex, 1)[0]);
  }
  
  return selected;
}

/**
 * Fetch top image post from a source (subreddit or user)
 */
async function fetchMemeFromSource(source) {
  // Determine if it's a subreddit or user
  const isUser = source.startsWith('u/');
  const name = source.substring(2); // Remove r/ or u/ prefix
  
  const url = isUser
    ? `https://www.reddit.com/user/${name}/submitted.json?limit=25&sort=top&t=day`
    : `https://www.reddit.com/r/${name}/top.json?limit=25&t=day`;
  
  console.log(`🌐 Fetching from ${source}...`);
  
  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Cache-Control': 'no-cache',
      },
      timeout: 10000,
    });
    
    const posts = response.data.data.children;
    
    // Filter for image posts only (jpg, png, gif)
    const imagePosts = posts.filter(post => {
      const postUrl = post.data.url || '';
      return (
        postUrl.includes('i.redd.it') ||
        postUrl.includes('i.imgur.com') ||
        postUrl.endsWith('.jpg') ||
        postUrl.endsWith('.jpeg') ||
        postUrl.endsWith('.png') ||
        postUrl.endsWith('.gif')
      );
    });
    
    if (imagePosts.length === 0) {
      console.log(`   ⚠️ No image posts found in ${source}`);
      return null;
    }
    
    // Pick a random image post from top results
    const randomIndex = Math.floor(Math.random() * Math.min(5, imagePosts.length));
    const post = imagePosts[randomIndex].data;
    
    console.log(`📷 Found: "${post.title.substring(0, 40)}..."`);
    
    return {
      title: post.title,
      url: post.url,
      author: post.author,
      score: post.score,
      source: source
    };
  } catch (error) {
    console.log(`   ⚠️ Failed to fetch from ${source}: ${error.message}`);
    return null;
  }
}

/**
 * Fetch memes from random sources
 */
async function fetchMemes(count = 2) {
  const memes = [];
  const triedSources = new Set();
  
  while (memes.length < count && triedSources.size < CONFIG.memeSources.length) {
    // Get random sources we haven't tried yet
    const availableSources = CONFIG.memeSources.filter(s => !triedSources.has(s));
    const randomIndex = Math.floor(Math.random() * availableSources.length);
    const source = availableSources[randomIndex];
    triedSources.add(source);
    
    const meme = await fetchMemeFromSource(source);
    if (meme) {
      memes.push(meme);
    }
  }
  
  if (memes.length < count) {
    throw new Error(`Could only find ${memes.length} memes, needed ${count}`);
  }
  
  return memes;
}

/**
 * Download image from URL to local path with validation
 */
async function downloadImage(url, outputPath) {
  console.log(`⬇️  Downloading meme image...`);
  
  const response = await axios.get(url, {
    responseType: 'arraybuffer',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
    },
    timeout: 30000,
    maxRedirects: 5,
  });
  
  const buffer = Buffer.from(response.data);
  
  // Validate image signature (magic bytes)
  const isJPEG = buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF;
  const isPNG = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47;
  const isGIF = buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46;
  const isWEBP = buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50;
  
  if (!isJPEG && !isPNG && !isGIF && !isWEBP) {
    // Check if it's HTML (error page)
    const preview = buffer.slice(0, 100).toString('utf-8').toLowerCase();
    if (preview.includes('<html') || preview.includes('<!doctype')) {
      throw new Error('Downloaded HTML instead of image (possible 403/404 error)');
    }
    throw new Error(`Invalid image format (not JPEG/PNG/GIF/WEBP)`);
  }
  
  // Fix extension if needed
  let correctedPath = outputPath;
  if (isJPEG && !outputPath.toLowerCase().endsWith('.jpg') && !outputPath.toLowerCase().endsWith('.jpeg')) {
    correctedPath = outputPath.replace(/\.[^.]+$/, '.jpg');
  } else if (isPNG && !outputPath.toLowerCase().endsWith('.png')) {
    correctedPath = outputPath.replace(/\.[^.]+$/, '.png');
  } else if (isGIF && !outputPath.toLowerCase().endsWith('.gif')) {
    correctedPath = outputPath.replace(/\.[^.]+$/, '.gif');
  }
  
  fs.writeFileSync(correctedPath, buffer);
  console.log(`✅ Image saved to: ${correctedPath}`);
  
  return correctedPath;
}

/**
 * Generate unique output filename with timestamp
 */
function generateOutputFilename() {
  const timestamp = new Date().toISOString()
    .replace(/[:.]/g, '-')
    .replace('T', '_')
    .slice(0, 19);
  
  return path.join(CONFIG.outputDir, `meme_video_${timestamp}.mp4`);
}

/**
 * Create the final video using FFmpeg with two stacked memes
 */
function createVideo(backgroundPath, memePaths, outputPath, musicPath = null) {
  return new Promise((resolve, reject) => {
    console.log(`\n🎬 Starting video composition...`);
    console.log(`   Background: ${path.basename(backgroundPath)}`);
    console.log(`   Meme 1: ${path.basename(memePaths[0])}`);
    console.log(`   Meme 2: ${path.basename(memePaths[1])}`);
    console.log(`   Output: ${path.basename(outputPath)}`);
    if (musicPath) {
      console.log(`   Music: ${path.basename(musicPath)}`);
    }
    
    const { outputWidth, outputHeight } = CONFIG;
    
    // Build complex filter for video composition
    // 1. Scale/crop background to output dimensions (no blur)
    // 2. Scale both memes to fit half the screen height
    // 3. Stack memes vertically and overlay on background
    
    const memeMaxWidth = 1000;
    const memeMaxHeight = 700; // Half screen for stacking
    
    const complexFilter = [
      // Process background: scale to fill, crop to exact size (no blur)
      `[0:v]scale=${outputWidth}:${outputHeight}:force_original_aspect_ratio=increase,crop=${outputWidth}:${outputHeight}[bg]`,
      
      // Scale first meme to fit within bounds, pad to uniform width, add bottom padding for gap
      `[1:v]scale=${memeMaxWidth}:${memeMaxHeight}:force_original_aspect_ratio=decrease,pad=max(iw\\,${memeMaxWidth}):ih+40:(ow-iw)/2:0:black@0[meme1]`,
      
      // Scale second meme to fit within bounds, pad to uniform width  
      `[2:v]scale=${memeMaxWidth}:${memeMaxHeight}:force_original_aspect_ratio=decrease,pad=max(iw\\,${memeMaxWidth}):ih:(ow-iw)/2:0:black@0[meme2]`,
      
      // Stack memes vertically
      `[meme1][meme2]vstack=inputs=2[stacked]`,
      
      // Overlay stacked memes on background (centered)
      `[bg][stacked]overlay=(W-w)/2:(H-h)/2`
    ].join(';');
    
    let command = ffmpeg()
      .input(backgroundPath)
      .input(memePaths[0])
      .input(memePaths[1])
      .complexFilter(complexFilter)
      .outputOptions([
        '-c:v', 'libx264',
        '-preset', 'medium',
        '-crf', '23',
        '-pix_fmt', 'yuv420p',
        '-t', '15', // 15 second video
        '-r', '30', // 30fps
      ]);
    
    // Handle audio: use music track or background video audio
    if (musicPath) {
      command
        .input(musicPath)
        .outputOptions([
          '-map', '0:a',
          '-c:a', 'aac',
          '-b:a', '192k',
          '-shortest'
        ]);
    } else {
      // Use audio from background video
      command.outputOptions([
        '-map', '0:a?',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-shortest'
      ]);
    }
    
    command
      .output(outputPath)
      .on('start', (cmdline) => {
        console.log(`\n📝 FFmpeg command started...`);
      })
      .on('progress', (progress) => {
        if (progress.percent) {
          process.stdout.write(`\r⏳ Processing: ${Math.round(progress.percent)}%`);
        }
      })
      .on('end', () => {
        console.log(`\n\n✅ Video created successfully!`);
        console.log(`📁 Output: ${outputPath}`);
        resolve(outputPath);
      })
      .on('error', (err, stdout, stderr) => {
        console.error(`\n❌ FFmpeg error: ${err.message}`);
        if (stderr) {
          console.error(`FFmpeg stderr: ${stderr}`);
        }
        reject(err);
      })
      .run();
  });
}

/**
 * Cleanup temporary files
 */
function cleanup() {
  if (fs.existsSync(CONFIG.tempDir)) {
    const files = fs.readdirSync(CONFIG.tempDir);
    files.forEach(file => {
      fs.unlinkSync(path.join(CONFIG.tempDir, file));
    });
    console.log(`🧹 Cleaned up temporary files`);
  }
}

/**
 * Main function - orchestrates the entire video generation
 */
async function main() {
  // Check for --upload flag
  const shouldUpload = process.argv.includes('--upload');
  const privacyStatus = process.argv.includes('--public') ? 'public' : 'private';
  
  console.log('🚀 Meme Video Generator');
  console.log('========================\n');
  
  if (shouldUpload) {
    console.log('📤 Upload mode: enabled');
    console.log(`🔒 Privacy: ${privacyStatus}\n`);
    
    if (!uploader.isConfigured()) {
      console.error('❌ YouTube upload requires client_secrets.json');
      console.error('   See README.md for setup instructions');
      process.exit(1);
    }
  }
  
  try {
    // 1. Get random background video
    const backgroundPath = getRandomBackground();
    
    // 2. Get random music (optional)
    const musicPath = getRandomMusic();
    
    // 3. Fetch 2 memes from random sources
    const memes = await fetchMemes(2);
    
    // 4. Download both meme images
    const memePaths = [];
    for (let i = 0; i < memes.length; i++) {
      const meme = memes[i];
      const memeExtension = path.extname(meme.url) || '.jpg';
      const memeTempPath = path.join(CONFIG.tempDir, `meme${i + 1}${memeExtension}`);
      await downloadImage(meme.url, memeTempPath);
      memePaths.push(memeTempPath);
    }
    
    // 5. Generate output filename
    const outputPath = generateOutputFilename();
    
    // 6. Create the video with stacked memes
    await createVideo(backgroundPath, memePaths, outputPath, musicPath);
    
    // 7. Cleanup
    cleanup();
    
    console.log('\n🎉 Video generation complete!');
    console.log(`\nVideo details:`);
    memes.forEach((meme, i) => {
      console.log(`   - Meme ${i + 1}: "${meme.title.substring(0, 40)}..."`);
      console.log(`     Source: ${meme.source} | Author: u/${meme.author} | Score: ${meme.score}`);
    });
    console.log(`   - Output: ${outputPath}`);
    
    // 8. Upload to YouTube if requested
    if (shouldUpload) {
      const memeTitles = memes.map(m => m.title);
      const uploadResult = await uploader.uploadVideo(outputPath, {
        memeTitles,
        privacyStatus,
      });
      
      console.log('\n🎉 All done! Video uploaded to YouTube.');
      return uploadResult;
    }
    
    console.log('\n🎉 All done!');
    return { outputPath };
    
  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);
    cleanup();
    process.exit(1);
  }
}

// Run the main function
main();
