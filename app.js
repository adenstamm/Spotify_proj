//imports
const express = require('express');
const path = require('path');
const session = require('express-session');
const axios = require('axios');
require('dotenv').config();
const { dbHelpers } = require('./database');

const app = express();
const port = process.env.PORT || 8888;

// Middleware
app.use(express.json()); // Parse JSON bodies
app.use(express.urlencoded({ extended: true })); // Parse URL-encoded bodies

// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key-change-this',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false, // Set to true if using HTTPS
    httpOnly: true, // Prevents JavaScript access to cookie
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

app.use(express.static(path.join(__dirname, 'public')));
app.use('/css', express.static(path.join(__dirname, 'public/css')));
app.use('/js', express.static(path.join(__dirname, 'public/js')));
app.use('/images', express.static(path.join(__dirname, 'public/images')));

// Routes
app.get('', (req, res) => {
  res.sendFile(path.join(__dirname, "/views/web.html"));
});

app.get('/logged', (req, res) => {
  res.sendFile(path.join(__dirname, "/views/logged.html"));
});


// Exchange authorization code for access token
app.post('/api/auth/token', async (req, res) => {
  try {
    const { code } = req.body;

    if (!code) {
      return res.status(400).json({ error: 'Authorization code is required' });
    }

    // Exchange code for token with Spotify
    const tokenResponse = await axios.post(
      'https://accounts.spotify.com/api/token',
      new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: process.env.SPOTIFY_REDIRECT_URI,
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': 'Basic ' + Buffer.from(
            process.env.SPOTIFY_CLIENT_ID + ':' + process.env.SPOTIFY_CLIENT_SECRET
          ).toString('base64')
        }
      }
    );

    const { access_token, refresh_token, expires_in } = tokenResponse.data;

    // Get user info from Spotify
    const userResponse = await axios.get('https://api.spotify.com/v1/me', {
      headers: {
        'Authorization': `Bearer ${access_token}`
      }
    });

    const userInfo = userResponse.data;

    const user = await dbHelpers.getOrCreateUser(
      userInfo.id,
      userInfo.display_name,
      userInfo.email
    );

    await dbHelpers.saveSession(
      user.id,
      req.sessionID,
      access_token,
      refresh_token,
      expires_in
    );

    req.session.userId = user.id;
    req.session.spotifyId = userInfo.id;
    req.session.displayName = userInfo.display_name;

    res.json({
      success: true,
      access_token: access_token,
      expires_in: expires_in
    });

  } catch (error) {
    console.error('Token exchange error:', error.response?.data || error.message);
    res.status(500).json({
      error: 'Failed to exchange authorization code',
      details: error.response?.data || error.message
    });
  }
});

app.post('/api/auth/refresh', async (req, res) => {
  try {
    const sessionId = req.sessionID;

    // Get session from database
    const sessionData = await dbHelpers.getSession(sessionId);

    if (!sessionData || !sessionData.refresh_token) {
      return res.status(401).json({ error: 'No valid session found' });
    }

    // Check if token is expired
    if (new Date(sessionData.expires_at) > new Date()) {
      return res.json({
        success: true,
        access_token: sessionData.access_token,
        expires_in: Math.floor((new Date(sessionData.expires_at) - new Date()) / 1000)
      });
    }

    // Refresh token  w spotify
    const tokenResponse = await axios.post(
      'https://accounts.spotify.com/api/token',
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: sessionData.refresh_token,
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': 'Basic ' + Buffer.from(
            process.env.SPOTIFY_CLIENT_ID + ':' + process.env.SPOTIFY_CLIENT_SECRET
          ).toString('base64')
        }
      }
    );

    const { access_token, expires_in } = tokenResponse.data;

    // Update session in database
    await dbHelpers.updateAccessToken(sessionId, access_token, expires_in);

    res.json({
      success: true,
      access_token: access_token,
      expires_in: expires_in
    });

  } catch (error) {
    console.error('Token refresh error:', error.response?.data || error.message);
    res.status(500).json({
      error: 'Failed to refresh token',
      details: error.response?.data || error.message
    });
  }
});

// Get current user info
app.get('/api/user', async (req, res) => {
  try {
    const sessionId = req.sessionID;
    const sessionData = await dbHelpers.getSession(sessionId);

    if (!sessionData) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    res.json({
      spotify_id: sessionData.spotify_id,
      display_name: sessionData.display_name,
      email: sessionData.email
    });

  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Failed to get user info' });
  }
});

// Logout
app.post('/api/auth/logout', async (req, res) => {
  try {
    const sessionId = req.sessionID;
    await dbHelpers.deleteSession(sessionId);
    req.session.destroy();
    res.json({ success: true, message: 'Logged out successfully' });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ error: 'Failed to logout' });
  }
});

// Cleanup expired sessions
setInterval(async () => {
  try {
    const result = await dbHelpers.cleanupExpiredSessions();
    console.log(`Cleaned up ${result.deleted} expired sessions`);
  } catch (error) {
    console.error('Session cleanup error:', error);
  }
}, 60 * 60 * 1000);

app.listen(port, () => console.info(`Listening on port ${port}`));