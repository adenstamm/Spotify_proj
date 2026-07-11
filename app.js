//imports
const express = require('express');
const path = require('path');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const axios = require('axios');
const busboy = require('busboy');
require('dotenv').config();
const { dbHelpers } = require('./database');

const app = express();
const port = process.env.PORT || 8888;

// Middleware
// Skip body parsing for multipart/form-data (busboy handles it)
app.use((req, res, next) => {
  const contentType = req.headers['content-type'] || '';
  if (contentType.includes('multipart/form-data')) {
    return next(); // Skip body parsing for file uploads
  }
  express.json()(req, res, next);
});

app.use((req, res, next) => {
  const contentType = req.headers['content-type'] || '';
  if (contentType.includes('multipart/form-data')) {
    return next(); // Skip URL encoding for file uploads
  }
  express.urlencoded({ extended: true })(req, res, next);
});

// Session configuration with database-backed store
app.use(session({
  store: new SQLiteStore({
    db: 'sessions.db',
    dir: './'
  }),
  secret: process.env.SESSION_SECRET || 'idkwhattosayhere',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production', // true in production (HTTPS only)
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

app.get('/history', (req, res) => {
  res.sendFile(path.join(__dirname, "/views/history.html"));
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

    // Check if token is still valid (not expired)
    if (new Date(sessionData.expires_at) > new Date()) {
      // Token still valid, return it
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

// Upload extended history files
app.post('/api/upload/history', (req, res) => {
  console.log('=== UPLOAD ROUTE HIT ===');
  console.log('Content-Type:', req.headers['content-type']);
  console.log('Session ID:', req.sessionID);
  // Ensure we always return JSON, even on errors
  res.setHeader('Content-Type', 'application/json');
  
  try {
    const bb = busboy({ headers: req.headers });
    const files = [];
    const fileContents = [];
    let filesProcessed = 0;
    let totalFilesExpected = 0;

    bb.on('file', (name, file, info) => {
      const { filename, encoding, mimeType } = info;
      console.log(`Receiving file: ${filename} (${mimeType})`);
      totalFilesExpected++;
      
      let fileData = '';
      let fileSize = 0;
      file.on('data', (data) => {
        fileData += data.toString();
        fileSize += data.length;
        // Log progress for large files
        if (fileSize % (10 * 1024 * 1024) === 0) { // Every 10MB
          console.log(`Reading ${filename}: ${(fileSize / 1024 / 1024).toFixed(2)} MB...`);
        }
      });

      file.on('end', () => {
        console.log(`Finished reading ${filename}: ${(fileSize / 1024 / 1024).toFixed(2)} MB`);
        
        // Only process .json files, skip everything else
        if (!filename.toLowerCase().endsWith('.json')) {
          console.log(`Skipping non-JSON file: ${filename}`);
          filesProcessed++;
          if (filesProcessed === totalFilesExpected) {
            sendResponse().catch(err => {
              console.error('Error in sendResponse:', err);
              if (!res.headersSent) {
                res.status(500).json({ error: 'Processing error', details: err.message });
              }
            });
          }
          return; // Skip this file entirely
        }
        
        files.push({
          filename: filename,
          size: fileData.length,
          mimeType: mimeType
        });
        
        console.log(`Parsing JSON for ${filename}...`);
        try {
          const jsonData = JSON.parse(fileData);
          console.log(`Successfully parsed ${filename}: ${Array.isArray(jsonData) ? jsonData.length : 'not an array'} entries`);
          fileContents.push({
            filename: filename,
            data: jsonData
          });
        } catch (error) {
          console.error(`Error parsing ${filename} as JSON:`, error.message);
          // Track invalid JSON files as errors
          fileContents.push({
            filename: filename,
            error: `Invalid JSON: ${error.message}`
          });
        }
        
        filesProcessed++;
        console.log(`Files processed: ${filesProcessed}/${totalFilesExpected}`);
        
        // Send response when all files are processed
        if (filesProcessed === totalFilesExpected) {
          console.log('All files received, starting database processing...');
          sendResponse().catch(err => {
            console.error('Error in sendResponse:', err);
            if (!res.headersSent) {
              res.status(500).json({ error: 'Processing error', details: err.message });
            }
          });
        }
      });
    });

    async function sendResponse() {
      console.log(`Processed ${files.length} files`);
      
      const successfulFiles = fileContents.filter(f => f.data);
      const failedFiles = fileContents.filter(f => f.error);
      
      // Process the files and store in database
      let totalRecords = 0;
      let processedRecords = 0;
      let errors = [];
      
      // Get user ID from session
      const sessionId = req.sessionID;
      let userId = null;
      
      try {
        const session = await dbHelpers.getSession(sessionId);
        if (!session || !session.user_id) {
          throw new Error('User not authenticated');
        }
        userId = session.user_id;
      } catch (err) {
        console.error('Session error:', err);
        if (!res.headersSent) {
          return res.status(401).json({ error: 'Authentication required' });
        }
      }

      // Track seen combinations to avoid duplicates
      const seenCombinations = new Set();
      let duplicatesSkipped = 0;
      
      // Process each JSON file
      for (let i = 0; i < successfulFiles.length; i++) {
        const fileContent = successfulFiles[i];
        try {
          const data = fileContent.data;
          
          // Spotify extended history format: array of objects
          if (Array.isArray(data)) {
            console.log(`[${i + 1}/${successfulFiles.length}] Processing ${fileContent.filename}: ${data.length} entries`);
            let fileRecords = 0;
            let fileProcessed = 0;
            let fileDuplicates = 0;
            
            // Process in batches to show progress
            const batchSize = 1000;
            for (let j = 0; j < data.length; j += batchSize) {
              const batch = data.slice(j, Math.min(j + batchSize, data.length));
              
              for (const entry of batch) {
                // Handle Spotify extended history format
                const trackName = entry.master_metadata_track_name || entry.trackName || entry.track_name;
                const artistName = entry.master_metadata_album_artist_name || entry.artistName || entry.artist_name;
                
                // Skip entries with null/empty track or artist (podcasts, audiobooks, etc.)
                if (!trackName || !artistName || trackName === null || artistName === null) {
                  continue; // Skip this entry
                }
                
                const msPlayed = entry.ms_played || entry.msPlayed || 0;
                const endTime = entry.ts || entry.endTime || entry.end_time || new Date().toISOString();
                
                // Create unique key from the 4 fields
                const uniqueKey = `${endTime}|${trackName.trim()}|${artistName.trim()}|${msPlayed}`;
                
                // Check if we've seen this combination before
                if (seenCombinations.has(uniqueKey)) {
                  duplicatesSkipped++;
                  fileDuplicates++;
                  continue; // Skip duplicate
                }
                
                // Mark this combination as seen
                seenCombinations.add(uniqueKey);
                
                totalRecords++;
                fileRecords++;
                
                try {
                  await dbHelpers.upsertListeningHistory(
                    userId,
                    trackName.trim(),
                    artistName.trim(),
                    msPlayed,
                    endTime
                  );
                  
                  await dbHelpers.upsertArtistHistory(
                    userId,
                    artistName.trim(),
                    endTime
                  );
                  
                  processedRecords++;
                  fileProcessed++;
                } catch (dbErr) {
                  console.error(`Error storing record:`, dbErr);
                  errors.push(`Error storing ${trackName} by ${artistName}: ${dbErr.message}`);
                }
              }
              
              // Log progress every batch
              if ((j + batchSize) % (batchSize * 10) === 0 || j + batchSize >= data.length) {
                console.log(`  Progress: ${Math.min(j + batchSize, data.length)}/${data.length} entries processed`);
              }
            }
            
            console.log(`✓ File ${fileContent.filename}: ${fileProcessed}/${fileRecords} records processed, ${fileDuplicates} duplicates skipped`);
          } else {
            console.log(`File ${fileContent.filename} is not an array. Type: ${typeof data}, Keys:`, Object.keys(data || {}));
          }
        } catch (parseErr) {
          console.error(`Error processing ${fileContent.filename}:`, parseErr);
          errors.push(`Error processing ${fileContent.filename}: ${parseErr.message}`);
        }
      }
      
      console.log(`=== UPLOAD COMPLETE ===`);
      console.log(`User ID: ${userId}`);
      console.log(`Total unique records found: ${totalRecords}`);
      console.log(`Successfully processed: ${processedRecords}`);
      console.log(`Duplicates skipped: ${duplicatesSkipped}`);
      
      const summary = {
        totalFiles: files.length,
        successful: successfulFiles.length,
        failed: failedFiles.length,
        totalRecords: totalRecords,
        processedRecords: processedRecords,
        duplicatesSkipped: duplicatesSkipped,
        files: files.map(f => ({
          filename: f.filename,
          size: f.size,
          status: fileContents.find(fc => fc.filename === f.filename)?.error ? 'error' : 'success'
        })),
        errors: failedFiles.map(f => ({ filename: f.filename, error: f.error })).concat(
          errors.length > 0 ? errors.slice(0, 10) : [] // Limit error messages
        )
      };
      
      if (!res.headersSent) {
        res.json(summary);
      }
    }

    bb.on('finish', () => {
      console.log(`Busboy finished. Files processed: ${filesProcessed}, Expected: ${totalFilesExpected}`);
      // If no files were received, send response immediately
      if (totalFilesExpected === 0) {
        if (!res.headersSent) {
          res.json({ 
            totalFiles: 0, 
            successful: 0, 
            failed: 0, 
            files: [], 
            errors: [],
            message: 'No files received'
          });
        }
      } else if (filesProcessed === totalFilesExpected) {
        // All files already processed, response sent in file.on('end')
        // Do nothing here
      }
    });

    bb.on('error', (err) => {
      console.error('Busboy error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'File upload error', details: err.message });
      }
    });

    req.on('error', (err) => {
      console.error('Request error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Request error', details: err.message });
      }
    });

    req.pipe(bb);
  } catch (error) {
    console.error('Route error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Server error', details: error.message });
    }
  }
});

// Get top 100 songs
app.get('/api/history/top-songs', async (req, res) => {
  try {
    const sessionId = req.sessionID;
    console.log('Top songs request - Session ID:', sessionId);
    const session = await dbHelpers.getSession(sessionId);
    
    if (!session || !session.user_id) {
      console.log('No session or user_id found');
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    console.log('Fetching top songs for user_id:', session.user_id);
    const songs = await dbHelpers.getTopSongs(session.user_id, 100);
    console.log(`Found ${songs.length} songs for user ${session.user_id}`);
    res.json({ songs });
  } catch (error) {
    console.error('Error fetching top songs:', error);
    res.status(500).json({ error: 'Failed to fetch top songs', details: error.message });
  }
});

// Get top 100 artists
app.get('/api/history/top-artists', async (req, res) => {
  try {
    const sessionId = req.sessionID;
    const session = await dbHelpers.getSession(sessionId);
    
    if (!session || !session.user_id) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    const artists = await dbHelpers.getTopArtists(session.user_id, 100);
    res.json({ artists });
  } catch (error) {
    console.error('Error fetching top artists:', error);
    res.status(500).json({ error: 'Failed to fetch top artists', details: error.message });
  }
});

// Search for songs or artists
app.get('/api/history/search', async (req, res) => {
  try {
    const sessionId = req.sessionID;
    const session = await dbHelpers.getSession(sessionId);
    
    if (!session || !session.user_id) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    const query = req.query.q;
    if (!query || query.trim().length === 0) {
      return res.status(400).json({ error: 'Search query required' });
    }
    
    const [songs, artists] = await Promise.all([
      dbHelpers.searchSong(session.user_id, query),
      dbHelpers.searchArtist(session.user_id, query)
    ]);
    
    res.json({ songs, artists });
  } catch (error) {
    console.error('Error searching:', error);
    res.status(500).json({ error: 'Search failed', details: error.message });
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

// Error handling middleware (must be last)
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  if (!res.headersSent) {
    res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

// 404 handler for API routes
app.use((req, res, next) => {
  if (req.path.startsWith('/api/') && req.method !== 'OPTIONS') {
    return res.status(404).json({ error: 'API endpoint not found', path: req.path });
  }
  next();
});

app.listen(port, () => console.info(`Listening on port ${port}`));