/**
 * YouTube Video Uploader Module
 * 
 * Handles OAuth2 authentication and video uploads to YouTube using the Data API v3.
 * 
 * Required files:
 * - client_secrets.json: OAuth2 credentials from Google Cloud Console
 * - token.json: Stored access/refresh tokens (auto-generated after first auth)
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { google } = require('googleapis');

// File paths for credentials
const CLIENT_SECRETS_PATH = path.join(__dirname, 'client_secrets.json');
const TOKEN_PATH = path.join(__dirname, 'token.json');

// Required OAuth2 scopes for YouTube uploads
const SCOPES = ['https://www.googleapis.com/auth/youtube.upload'];

/**
 * Load OAuth2 client from credentials file
 * @returns {OAuth2Client} Configured OAuth2 client
 */
function loadClientSecrets() {
  if (!fs.existsSync(CLIENT_SECRETS_PATH)) {
    throw new Error(
      `Missing client_secrets.json!\n\n` +
      `To set up YouTube uploads:\n` +
      `1. Go to https://console.cloud.google.com/\n` +
      `2. Create a project and enable "YouTube Data API v3"\n` +
      `3. Go to APIs & Services → Credentials\n` +
      `4. Create OAuth 2.0 Client ID (Desktop app)\n` +
      `5. Download JSON and save as "client_secrets.json" in project root`
    );
  }

  const content = fs.readFileSync(CLIENT_SECRETS_PATH, 'utf-8');
  const credentials = JSON.parse(content);
  
  // Handle both "installed" (Desktop) and "web" credential types
  const { client_secret, client_id, redirect_uris } = 
    credentials.installed || credentials.web;
  
  return new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris[0]
  );
}

/**
 * Get a valid access token, prompting for authorization if needed
 * @param {OAuth2Client} oAuth2Client - The OAuth2 client
 * @returns {Promise<OAuth2Client>} Authorized OAuth2 client
 */
async function authorize(oAuth2Client) {
  // Check for existing token
  if (fs.existsSync(TOKEN_PATH)) {
    const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
    oAuth2Client.setCredentials(token);
    
    // Check if token is expired
    if (token.expiry_date && token.expiry_date < Date.now()) {
      console.log('🔄 Token expired, refreshing...');
      try {
        const { credentials } = await oAuth2Client.refreshAccessToken();
        oAuth2Client.setCredentials(credentials);
        fs.writeFileSync(TOKEN_PATH, JSON.stringify(credentials, null, 2));
        console.log('✅ Token refreshed successfully');
      } catch (error) {
        console.log('⚠️  Could not refresh token, re-authorization required');
        return getNewToken(oAuth2Client);
      }
    }
    
    return oAuth2Client;
  }
  
  return getNewToken(oAuth2Client);
}

/**
 * Get a new token via console authorization flow
 * @param {OAuth2Client} oAuth2Client - The OAuth2 client
 * @returns {Promise<OAuth2Client>} Authorized OAuth2 client
 */
function getNewToken(oAuth2Client) {
  return new Promise((resolve, reject) => {
    const authUrl = oAuth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
    });

    console.log('\n🔐 Authorization Required');
    console.log('═'.repeat(50));
    console.log('\nOpen this URL in your browser to authorize:\n');
    console.log(authUrl);
    console.log('\n' + '═'.repeat(50));

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question('\nEnter the authorization code: ', async (code) => {
      rl.close();
      
      try {
        const { tokens } = await oAuth2Client.getToken(code);
        oAuth2Client.setCredentials(tokens);
        
        // Store the token for future use
        fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
        console.log('✅ Token stored successfully');
        
        resolve(oAuth2Client);
      } catch (error) {
        reject(new Error(`Failed to get token: ${error.message}`));
      }
    });
  });
}

/**
 * Generate video metadata for YouTube
 * @param {Object} options - Metadata options
 * @param {string[]} options.memeTitles - Titles of the memes used
 * @param {string} options.privacyStatus - 'private', 'public', or 'unlisted'
 * @param {string} options.publishAt - ISO 8601 timestamp for scheduled publishing
 * @returns {Object} Video metadata object
 */
function generateMetadata(options = {}) {
  const { memeTitles = [], privacyStatus = 'private', publishAt = null } = options;
  
  // Generate catchy titles
  const titleOptions = [
    'Daily Dose of Internet Memes #Shorts',
    'Memes That Hit Different 😂 #Shorts',
    'Try Not To Laugh Challenge #Shorts',
    'Funniest Memes of the Day #Shorts',
    'Meme Compilation That Will Make You Laugh #Shorts',
    'Best Memes To Cure Your Boredom #Shorts',
    'Viral Memes You Need To See #Shorts',
    'When The Memes Are Too Relatable #Shorts',
  ];
  
  // If we have meme titles, use the first one (truncated)
  let title;
  if (memeTitles.length > 0 && memeTitles[0].length > 10) {
    // Use meme title, truncated to fit YouTube's 100 char limit
    const memeTitle = memeTitles[0].substring(0, 70);
    title = `${memeTitle} #Shorts`;
  } else {
    // Pick a random catchy title
    title = titleOptions[Math.floor(Math.random() * titleOptions.length)];
  }
  
  // Build description with hashtags and meme credits
  let description = '🔥 Daily meme compilation!\n\n';
  
  if (memeTitles.length > 0) {
    description += 'Featured memes:\n';
    memeTitles.forEach((memeTitle, i) => {
      const truncated = memeTitle.substring(0, 80);
      description += `${i + 1}. ${truncated}\n`;
    });
    description += '\n';
  }
  
  description += '━━━━━━━━━━━━━━━━━━━━━━\n';
  description += '#shorts #memes #funny #meme #viral #comedy #lol #relatable #dankmemes #funnymemes\n';
  description += '━━━━━━━━━━━━━━━━━━━━━━\n\n';
  description += '🎵 Subscribe for daily meme content!\n';
  description += '👍 Like if this made you laugh!\n';
  description += '💬 Comment your favorite meme!\n';
  
  // Tags for discoverability
  const tags = [
    'memes',
    'meme',
    'funny',
    'shorts',
    'youtube shorts',
    'short',
    'funny video',
    'meme compilation',
    'dank memes',
    'funny memes',
    'try not to laugh',
    'comedy',
    'viral',
    'trending',
    'relatable',
    'humor',
    'lol',
  ];
  
  const status = {
    privacyStatus: publishAt ? 'private' : privacyStatus, // Must be private for scheduling
    selfDeclaredMadeForKids: false,
  };
  
  // Add publishAt for scheduled publishing
  if (publishAt) {
    status.publishAt = publishAt;
  }
  
  return {
    snippet: {
      title,
      description,
      tags,
      categoryId: '24', // Entertainment
      defaultLanguage: 'en',
      defaultAudioLanguage: 'en',
    },
    status,
  };
}

/**
 * Upload a video to YouTube
 * @param {string} videoPath - Path to the video file
 * @param {Object} options - Upload options
 * @param {string[]} options.memeTitles - Titles of the memes used
 * @param {string} options.privacyStatus - 'private', 'public', or 'unlisted'
 * @param {string} options.publishAt - ISO 8601 timestamp for scheduled publishing
 * @returns {Promise<Object>} Upload response with video ID and URL
 */
async function uploadVideo(videoPath, options = {}) {
  const { memeTitles = [], privacyStatus = 'private', publishAt = null } = options;
  
  console.log('\n📤 Starting YouTube Upload');
  console.log('═'.repeat(50));
  
  // Validate video file exists
  if (!fs.existsSync(videoPath)) {
    throw new Error(`Video file not found: ${videoPath}`);
  }
  
  const fileSizeBytes = fs.statSync(videoPath).size;
  const fileSizeMB = (fileSizeBytes / (1024 * 1024)).toFixed(2);
  console.log(`📁 Video: ${path.basename(videoPath)} (${fileSizeMB} MB)`);
  console.log(`🔒 Privacy: ${privacyStatus}`);
  
  try {
    // Initialize OAuth2 client and authorize
    const oAuth2Client = loadClientSecrets();
    await authorize(oAuth2Client);
    
    // Create YouTube API client
    const youtube = google.youtube({ version: 'v3', auth: oAuth2Client });
    
    // Generate metadata
    const metadata = generateMetadata({ memeTitles, privacyStatus, publishAt });
    console.log(`📝 Title: ${metadata.snippet.title}`);
    if (publishAt) {
      console.log(`📅 Scheduled: ${new Date(publishAt).toLocaleString()}`);
    }
    
    // Upload the video
    console.log('\n⏳ Uploading...');
    
    const response = await youtube.videos.insert({
      part: ['snippet', 'status'],
      requestBody: metadata,
      media: {
        body: fs.createReadStream(videoPath),
      },
    }, {
      // Enable resumable uploads for large files
      onUploadProgress: (evt) => {
        const progress = (evt.bytesRead / fileSizeBytes) * 100;
        process.stdout.write(`\r   Progress: ${progress.toFixed(1)}%`);
      },
    });
    
    const videoId = response.data.id;
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const studioUrl = `https://studio.youtube.com/video/${videoId}/edit`;
    
    console.log('\n\n✅ Upload Successful!');
    console.log('═'.repeat(50));
    console.log(`🎬 Video ID: ${videoId}`);
    console.log(`🔗 Watch URL: ${videoUrl}`);
    console.log(`📊 Studio URL: ${studioUrl}`);
    console.log('═'.repeat(50));
    
    return {
      success: true,
      videoId,
      videoUrl,
      studioUrl,
      title: metadata.snippet.title,
      publishAt: publishAt || null,
    };
    
  } catch (error) {
    // Handle specific API errors
    if (error.code === 403) {
      if (error.message.includes('quotaExceeded')) {
        console.error('\n❌ YouTube API Quota Exceeded!');
        console.error('   Daily quota limit reached. Try again tomorrow.');
        console.error('   Tip: Request quota increase at https://console.cloud.google.com/');
      } else if (error.message.includes('forbidden')) {
        console.error('\n❌ Access Forbidden!');
        console.error('   Check that YouTube Data API v3 is enabled for your project.');
      } else {
        console.error(`\n❌ Forbidden: ${error.message}`);
      }
    } else if (error.code === 401) {
      console.error('\n❌ Authentication Error!');
      console.error('   Token may be invalid. Delete token.json and try again.');
    } else if (error.code === 400) {
      console.error('\n❌ Bad Request!');
      console.error(`   ${error.message}`);
    } else if (error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT') {
      console.error('\n❌ Network Error!');
      console.error('   Check your internet connection and try again.');
    } else {
      console.error(`\n❌ Upload Failed: ${error.message}`);
    }
    
    throw error;
  }
}

/**
 * Check if upload credentials are configured
 * @returns {boolean} True if client_secrets.json exists
 */
function isConfigured() {
  return fs.existsSync(CLIENT_SECRETS_PATH);
}

/**
 * Check if already authorized (token exists)
 * @returns {boolean} True if token.json exists
 */
function isAuthorized() {
  return fs.existsSync(TOKEN_PATH);
}

module.exports = {
  uploadVideo,
  isConfigured,
  isAuthorized,
  generateMetadata,
};
