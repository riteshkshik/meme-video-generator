require('dotenv').config();
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const uploader = require('./uploader');

// Configuration
const CONFIG = {
  outputWidth: parseInt(process.env.OUTPUT_WIDTH) || 1080,
  outputHeight: parseInt(process.env.OUTPUT_HEIGHT) || 1920,
  backgroundsDir: path.join(__dirname, 'assets', 'backgrounds'),
  musicDir: path.join(__dirname, 'assets', 'music'),
  outputDir: path.join(__dirname, 'output'),
  imageOutputDir: path.join(__dirname, 'imageOutput'),
  requiredImages: 2,
};

// Ensure output directory exists
if (!fs.existsSync(CONFIG.outputDir)) {
  fs.mkdirSync(CONFIG.outputDir, { recursive: true });
}

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
 * Get images from imageOutput folder
 */
function getImagesFromFolder() {
  if (!fs.existsSync(CONFIG.imageOutputDir)) {
    throw new Error(`Image output directory not found: ${CONFIG.imageOutputDir}\nRun fetchImages.js first.`);
  }
  
  const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
  const files = fs.readdirSync(CONFIG.imageOutputDir)
    .filter(file => !file.startsWith('.'))
    .filter(file => imageExtensions.some(ext => file.toLowerCase().endsWith(ext)))
    .map(file => path.join(CONFIG.imageOutputDir, file));
  
  if (files.length < CONFIG.requiredImages) {
    throw new Error(`Insufficient images: found ${files.length}, need ${CONFIG.requiredImages}.\nRun fetchImages.js to fetch more images.`);
  }
  
  // Return only the required number of images (in order they were added)
  return files.slice(0, CONFIG.requiredImages);
}

/**
 * Get metadata for images (if available)
 */
function getMetadata() {
  const metadataPath = path.join(CONFIG.imageOutputDir, 'metadata.json');
  if (fs.existsSync(metadataPath)) {
    try {
      return JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
    } catch (error) {
      console.log('⚠️ Could not read metadata file');
    }
  }
  return null;
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
 * Clear images from imageOutput folder after successful video creation
 */
function clearImageOutput(keepMetadata = false) {
  if (!fs.existsSync(CONFIG.imageOutputDir)) return;
  
  const files = fs.readdirSync(CONFIG.imageOutputDir);
  files.forEach(file => {
    if (keepMetadata && file === 'metadata.json') return;
    const filePath = path.join(CONFIG.imageOutputDir, file);
    fs.unlinkSync(filePath);
  });
  console.log(`🧹 Cleared imageOutput folder`);
}

/**
 * Main function - creates video from images in imageOutput folder
 */
async function main() {
  // Check for --upload flag
  const shouldUpload = process.argv.includes('--upload');
  const privacyStatus = process.argv.includes('--public') ? 'public' : 'private';
  const shouldClear = process.argv.includes('--clear');
  
  console.log('🎬 Meme Video Creator');
  console.log('=====================\n');
  
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
    // 1. Get images from imageOutput folder
    const memePaths = getImagesFromFolder();
    console.log('📂 Using images from imageOutput folder:');
    memePaths.forEach((img, i) => {
      console.log(`   ${i + 1}. ${path.basename(img)}`);
    });
    
    // 2. Get metadata for titles (if available)
    const metadata = getMetadata();
    
    // 3. Get random background video
    const backgroundPath = getRandomBackground();
    
    // 4. Get random music (optional)
    const musicPath = getRandomMusic();
    
    // 5. Generate output filename
    const outputPath = generateOutputFilename();
    
    // 6. Create the video with stacked memes
    await createVideo(backgroundPath, memePaths, outputPath, musicPath);
    
    console.log('\n🎉 Video creation complete!');
    
    // Show metadata if available
    if (metadata) {
      console.log(`\nVideo details:`);
      metadata.forEach((meme, i) => {
        console.log(`   - Meme ${i + 1}: "${meme.title ? meme.title.substring(0, 40) : 'Unknown'}..."`);
        if (meme.source) console.log(`     Source: ${meme.source} | Author: u/${meme.author} | Score: ${meme.score}`);
      });
    }
    console.log(`   - Output: ${outputPath}`);
    
    // 7. Upload to YouTube if requested
    if (shouldUpload) {
      const memeTitles = metadata ? metadata.map(m => m.title) : ['Meme 1', 'Meme 2'];
      const uploadResult = await uploader.uploadVideo(outputPath, {
        memeTitles,
        privacyStatus,
      });
      
      console.log('\n🎉 All done! Video uploaded to YouTube.');
      
      // Clear images after successful upload
      if (shouldClear) {
        clearImageOutput();
      }
      
      return uploadResult;
    }
    
    // 8. Clear images if requested
    if (shouldClear) {
      clearImageOutput();
    }
    
    console.log('\n🎉 All done!');
    console.log('\n💡 Tip: Run with --clear to clean up imageOutput after video creation');
    console.log('💡 Tip: Run with --upload to upload to YouTube');
    return { outputPath };
    
  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);
    process.exit(1);
  }
}

// Run the main function
main();
