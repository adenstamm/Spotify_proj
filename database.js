const sqlite3 = require('sqlite3').verbose();
const path = require('path');
require('dotenv').config();

const dbPath = process.env.DATABASE_PATH || path.join(__dirname, 'database.sqlite');

// Create/connect to database
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    console.log('Connected to SQLite database');
    initializeDatabase();
  }
});

// Initialize database tables
function initializeDatabase() {
  db.serialize(() => {
    // Users table - stores Spotify user info
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        spotify_id TEXT UNIQUE NOT NULL,
        display_name TEXT,
        email TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Sessions table - stores user sessions and tokens
    db.run(`
      CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        session_id TEXT UNIQUE NOT NULL,
        access_token TEXT NOT NULL,
        refresh_token TEXT,
        expires_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id)
      )
    `);

    // Create index for faster lookups
    db.run(`
      CREATE INDEX IF NOT EXISTS idx_session_id ON sessions(session_id)
    `);

    db.run(`
      CREATE INDEX IF NOT EXISTS idx_user_id ON sessions(user_id)
    `);

    // Listening history tables
    db.run(`
      CREATE TABLE IF NOT EXISTS listening_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        track_name TEXT NOT NULL,
        artist_name TEXT NOT NULL,
        play_count INTEGER DEFAULT 1,
        total_ms_played INTEGER DEFAULT 0,
        last_played DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id),
        UNIQUE(user_id, track_name, artist_name)
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS artist_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        artist_name TEXT NOT NULL,
        total_plays INTEGER DEFAULT 0,
        total_tracks INTEGER DEFAULT 0,
        last_played DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id),
        UNIQUE(user_id, artist_name)
      )
    `);

    db.run(`
      CREATE INDEX IF NOT EXISTS idx_listening_user_id ON listening_history(user_id)
    `);

    db.run(`
      CREATE INDEX IF NOT EXISTS idx_artist_user_id ON artist_history(user_id)
    `);

    console.log('Database tables initialized');
  });
}

// Database helper functions
const dbHelpers = {
  // Get or create user
  getOrCreateUser: (spotifyId, displayName, email) => {
    return new Promise((resolve, reject) => {
      // First, try to get existing user
      db.get(
        'SELECT * FROM users WHERE spotify_id = ?',
        [spotifyId],
        (err, user) => {
          if (err) {
            reject(err);
          } else if (user) {
            // Update user info if needed
            db.run(
              'UPDATE users SET display_name = ?, email = ?, updated_at = CURRENT_TIMESTAMP WHERE spotify_id = ?',
              [displayName, email, spotifyId],
              (err) => {
                if (err) reject(err);
                else resolve(user);
              }
            );
          } else {
            // Create new user
            db.run(
              'INSERT INTO users (spotify_id, display_name, email) VALUES (?, ?, ?)',
              [spotifyId, displayName, email],
              function(err) {
                if (err) {
                  reject(err);
                } else {
                  resolve({ id: this.lastID, spotify_id: spotifyId, display_name: displayName, email: email });
                }
              }
            );
          }
        }
      );
    });
  },

  // Save session
  saveSession: (userId, sessionId, accessToken, refreshToken, expiresIn) => {
    return new Promise((resolve, reject) => {
      const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
      
      db.run(
        `INSERT OR REPLACE INTO sessions (user_id, session_id, access_token, refresh_token, expires_at)
         VALUES (?, ?, ?, ?, ?)`,
        [userId, sessionId, accessToken, refreshToken, expiresAt],
        function(err) {
          if (err) {
            reject(err);
          } else {
            resolve({ id: this.lastID });
          }
        }
      );
    });
  },

  // Get session by session ID
  getSession: (sessionId) => {
    return new Promise((resolve, reject) => {
      db.get(
        `SELECT s.*, u.spotify_id, u.display_name, u.email 
         FROM sessions s 
         JOIN users u ON s.user_id = u.id 
         WHERE s.session_id = ?`,
        [sessionId],
        (err, row) => {
          if (err) {
            reject(err);
          } else {
            resolve(row);
          }
        }
      );
    });
  },

  // Update access token
  updateAccessToken: (sessionId, accessToken, expiresIn) => {
    return new Promise((resolve, reject) => {
      const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
      
      db.run(
        'UPDATE sessions SET access_token = ?, expires_at = ? WHERE session_id = ?',
        [accessToken, expiresAt, sessionId],
        function(err) {
          if (err) {
            reject(err);
          } else {
            resolve({ changes: this.changes });
          }
        }
      );
    });
  },

  // Delete session (logout)
  deleteSession: (sessionId) => {
    return new Promise((resolve, reject) => {
      db.run(
        'DELETE FROM sessions WHERE session_id = ?',
        [sessionId],
        function(err) {
          if (err) {
            reject(err);
          } else {
            resolve({ changes: this.changes });
          }
        }
      );
    });
  },

  // Clean up expired sessions (run periodically)
  cleanupExpiredSessions: () => {
    return new Promise((resolve, reject) => {
      db.run(
        'DELETE FROM sessions WHERE expires_at < datetime("now")',
        function(err) {
          if (err) {
            reject(err);
          } else {
            resolve({ deleted: this.changes });
          }
        }
      );
    });
  },

  // Store or update listening history
  upsertListeningHistory: (userId, trackName, artistName, msPlayed, endTime) => {
    return new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO listening_history (user_id, track_name, artist_name, play_count, total_ms_played, last_played)
         VALUES (?, ?, ?, 1, ?, ?)
         ON CONFLICT(user_id, track_name, artist_name) 
         DO UPDATE SET 
           play_count = play_count + 1,
           total_ms_played = total_ms_played + ?,
           last_played = ?`,
        [userId, trackName, artistName, msPlayed, endTime, msPlayed, endTime],
        function(err) {
          if (err) {
            reject(err);
          } else {
            resolve({ id: this.lastID });
          }
        }
      );
    });
  },

  // Store or update artist history
  upsertArtistHistory: (userId, artistName, endTime) => {
    return new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO artist_history (user_id, artist_name, total_plays, total_tracks, last_played)
         VALUES (?, ?, 1, 0, ?)
         ON CONFLICT(user_id, artist_name) 
         DO UPDATE SET 
           total_plays = total_plays + 1,
           last_played = ?`,
        [userId, artistName, endTime, endTime],
        function(updateErr) {
          if (updateErr) {
            reject(updateErr);
          } else {
            resolve({ id: this.lastID });
          }
        }
      );
    });
  },

  // Get top songs for a user
  getTopSongs: (userId, limit = 100) => {
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT track_name, artist_name, play_count, total_ms_played, last_played
         FROM listening_history
         WHERE user_id = ?
         ORDER BY play_count DESC, last_played DESC
         LIMIT ?`,
        [userId, limit],
        (err, rows) => {
          if (err) {
            reject(err);
          } else {
            resolve(rows);
          }
        }
      );
    });
  },

  // Get top artists for a user
  getTopArtists: (userId, limit = 100) => {
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT 
           ah.artist_name, 
           ah.total_plays, 
           COUNT(DISTINCT lh.track_name) as total_tracks,
           ah.last_played
         FROM artist_history ah
         LEFT JOIN listening_history lh ON ah.user_id = lh.user_id AND ah.artist_name = lh.artist_name
         WHERE ah.user_id = ?
         GROUP BY ah.artist_name, ah.total_plays, ah.last_played
         ORDER BY ah.total_plays DESC, ah.last_played DESC
         LIMIT ?`,
        [userId, limit],
        (err, rows) => {
          if (err) {
            reject(err);
          } else {
            resolve(rows);
          }
        }
      );
    });
  },

  // Search for a song
  searchSong: (userId, query) => {
    return new Promise((resolve, reject) => {
      const searchQuery = `%${query}%`;
      db.all(
        `SELECT track_name, artist_name, play_count, total_ms_played, last_played
         FROM listening_history
         WHERE user_id = ? AND (track_name LIKE ? OR artist_name LIKE ?)
         ORDER BY play_count DESC`,
        [userId, searchQuery, searchQuery],
        (err, rows) => {
          if (err) {
            reject(err);
          } else {
            resolve(rows);
          }
        }
      );
    });
  },

  // Search for an artist
  searchArtist: (userId, query) => {
    return new Promise((resolve, reject) => {
      const searchQuery = `%${query}%`;
      db.all(
        `SELECT 
           ah.artist_name, 
           ah.total_plays, 
           COUNT(DISTINCT lh.track_name) as total_tracks,
           ah.last_played
         FROM artist_history ah
         LEFT JOIN listening_history lh ON ah.user_id = lh.user_id AND ah.artist_name = lh.artist_name
         WHERE ah.user_id = ? AND ah.artist_name LIKE ?
         GROUP BY ah.artist_name, ah.total_plays, ah.last_played
         ORDER BY ah.total_plays DESC`,
        [userId, searchQuery],
        (err, rows) => {
          if (err) {
            reject(err);
          } else {
            resolve(rows);
          }
        }
      );
    });
  },

  // Clear listening history for a user (optional, for re-uploading)
  clearListeningHistory: (userId) => {
    return new Promise((resolve, reject) => {
      db.run(
        'DELETE FROM listening_history WHERE user_id = ?',
        [userId],
        function(err) {
          if (err) {
            reject(err);
          } else {
            db.run(
              'DELETE FROM artist_history WHERE user_id = ?',
              [userId],
              function(deleteErr) {
                if (deleteErr) {
                  reject(deleteErr);
                } else {
                  resolve({ deleted: this.changes });
                }
              }
            );
          }
        }
      );
    });
  }
};

// Close database connection gracefully
process.on('SIGINT', () => {
  db.close((err) => {
    if (err) {
      console.error(err.message);
    } else {
      console.log('Database connection closed');
    }
    process.exit(0);
  });
});

module.exports = { db, dbHelpers };

