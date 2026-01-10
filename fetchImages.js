require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');

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
  imageOutputDir: path.join(__dirname, 'imageOutput'),
  requiredImages: 2, // Number of images needed for video
};

// Ensure imageOutput directory exists
if (!fs.existsSync(CONFIG.imageOutputDir)) {
  fs.mkdirSync(CONFIG.imageOutputDir, { recursive: true });
}

/**
 * Get existing images in imageOutput folder
 */
function getExistingImages() {
  if (!fs.existsSync(CONFIG.imageOutputDir)) {
    return [];
  }
  
  const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
  const files = fs.readdirSync(CONFIG.imageOutputDir)
    .filter(file => !file.startsWith('.'))
    .filter(file => imageExtensions.some(ext => file.toLowerCase().endsWith(ext)));
  
  return files.map(file => path.join(CONFIG.imageOutputDir, file));
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
async function fetchMemes(count) {
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
 * Save meme metadata to JSON file
 */
function saveMetadata(memes, imagePaths) {
  const metadata = memes.map((meme, index) => ({
    ...meme,
    localPath: imagePaths[index],
    fetchedAt: new Date().toISOString(),
  }));
  
  const metadataPath = path.join(CONFIG.imageOutputDir, 'metadata.json');
  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
  console.log(`📝 Metadata saved to: ${metadataPath}`);
}

/**
 * Main function - fetches images and stores them
 */
async function main() {
  console.log('🖼️  Meme Image Fetcher');
  console.log('======================\n');
  
  try {
    // 1. Check existing images
    const existingImages = getExistingImages();
    const existingCount = existingImages.length;
    
    console.log(`📂 Image output directory: ${CONFIG.imageOutputDir}`);
    console.log(`📊 Existing images: ${existingCount}`);
    console.log(`📊 Required images: ${CONFIG.requiredImages}\n`);
    
    if (existingCount >= CONFIG.requiredImages) {
      console.log('✅ Sufficient images already available!');
      console.log('\nExisting images:');
      existingImages.forEach((img, i) => {
        console.log(`   ${i + 1}. ${path.basename(img)}`);
      });
      console.log('\n💡 Run createVideo.js to create video from these images.');
      console.log('💡 Delete images from imageOutput folder to fetch new ones.');
      return;
    }
    
    // 2. Calculate how many more images we need
    const neededCount = CONFIG.requiredImages - existingCount;
    console.log(`📥 Need to fetch ${neededCount} more image(s)...\n`);
    
    // 3. Fetch memes from random sources
    const memes = await fetchMemes(neededCount);
    
    // 4. Download meme images
    const newImagePaths = [];
    for (let i = 0; i < memes.length; i++) {
      const meme = memes[i];
      const memeExtension = path.extname(meme.url) || '.jpg';
      const timestamp = Date.now();
      const imagePath = path.join(CONFIG.imageOutputDir, `meme_${existingCount + i + 1}_${timestamp}${memeExtension}`);
      
      const savedPath = await downloadImage(meme.url, imagePath);
      newImagePaths.push(savedPath);
    }
    
    // 5. Save metadata
    saveMetadata(memes, newImagePaths);
    
    // 6. Summary
    const allImages = getExistingImages();
    console.log('\n🎉 Image fetching complete!');
    console.log(`\n📂 Images in ${CONFIG.imageOutputDir}:`);
    allImages.forEach((img, i) => {
      console.log(`   ${i + 1}. ${path.basename(img)}`);
    });
    
    console.log('\n\n📋 Next steps:');
    console.log('   1. Review the fetched images in the imageOutput folder');
    console.log('   2. Delete any unwanted images and run this script again');
    console.log('   3. When satisfied, run: node createVideo.js');
    
  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);
    process.exit(1);
  }
}

// Run the main function
main();
