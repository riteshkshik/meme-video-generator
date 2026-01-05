/**
 * Reddit OAuth API module
 * Handles authentication and fetching from Reddit's official API
 */

const axios = require('axios');

// Reddit OAuth configuration
const REDDIT_CONFIG = {
  tokenUrl: 'https://www.reddit.com/api/v1/access_token',
  apiBaseUrl: 'https://oauth.reddit.com',
  clientId: process.env.REDDIT_CLIENT_ID,
  clientSecret: process.env.REDDIT_CLIENT_SECRET,
  userAgent: `MemeVideoBot/1.0 (by /u/${process.env.REDDIT_USERNAME || 'MemeVideoBot'})`,
};

let accessToken = null;
let tokenExpiry = null;

/**
 * Check if Reddit OAuth credentials are configured
 */
function isConfigured() {
  return !!(REDDIT_CONFIG.clientId && REDDIT_CONFIG.clientSecret);
}

/**
 * Get OAuth access token using client credentials (app-only auth)
 */
async function getAccessToken() {
  // Return cached token if still valid (with 1 minute buffer)
  if (accessToken && tokenExpiry && Date.now() < tokenExpiry - 60000) {
    return accessToken;
  }

  console.log('🔑 Authenticating with Reddit...');

  const auth = Buffer.from(`${REDDIT_CONFIG.clientId}:${REDDIT_CONFIG.clientSecret}`).toString('base64');

  try {
    const response = await axios.post(
      REDDIT_CONFIG.tokenUrl,
      'grant_type=client_credentials',
      {
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': REDDIT_CONFIG.userAgent,
        },
      }
    );

    accessToken = response.data.access_token;
    tokenExpiry = Date.now() + (response.data.expires_in * 1000);
    
    console.log('✅ Reddit authentication successful');
    return accessToken;
  } catch (error) {
    console.error('❌ Reddit authentication failed:', error.response?.data || error.message);
    throw new Error('Failed to authenticate with Reddit API');
  }
}

/**
 * Make authenticated request to Reddit API
 */
async function apiRequest(endpoint) {
  const token = await getAccessToken();

  const response = await axios.get(`${REDDIT_CONFIG.apiBaseUrl}${endpoint}`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'User-Agent': REDDIT_CONFIG.userAgent,
    },
    timeout: 10000,
  });

  return response.data;
}

/**
 * Fetch meme from a subreddit
 */
async function fetchFromSubreddit(subreddit, sortBy = 'top', time = 'day', limit = 25) {
  const endpoint = `/r/${subreddit}/${sortBy}?t=${time}&limit=${limit}`;
  return await apiRequest(endpoint);
}

/**
 * Fetch posts from a user's submissions
 */
async function fetchFromUser(username, sortBy = 'top', time = 'day', limit = 25) {
  const endpoint = `/user/${username}/submitted?sort=${sortBy}&t=${time}&limit=${limit}`;
  return await apiRequest(endpoint);
}

/**
 * Unified function to fetch from source (r/subreddit or u/user)
 */
async function fetchFromSource(source) {
  const isUser = source.startsWith('u/');
  const name = source.substring(2); // Remove r/ or u/ prefix

  console.log(`🌐 Fetching from ${source}...`);

  try {
    const data = isUser
      ? await fetchFromUser(name)
      : await fetchFromSubreddit(name);

    const posts = data.data.children;

    // Filter for image posts only
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

module.exports = {
  isConfigured,
  getAccessToken,
  fetchFromSource,
  fetchFromSubreddit,
  fetchFromUser,
};
