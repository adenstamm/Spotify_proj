var redirect = "http://127.0.0.1:8888/logged"; // Must match SPOTIFY_REDIRECT_URI in .env

var client_id = "be0e6280dd0545b6a67f660345b25628";

const AUTHORIZE = "https://accounts.spotify.com/authorize";
const ARTISTS = "https://api.spotify.com/v1/me/top/artists?offset=0&limit=10&time_range=long_term";
const TRACKS  = "https://api.spotify.com/v1/me/top/tracks?offset=0&limit=10&time_range=long_term";
const PLAYLISTS = "https://api.spotify.com/v1/me/playlists"

// Global variables for playlist pagination
let allPlaylistTracks = [];
let currentPlaylistId = null;
let currentPlaylistName = null;

// Global variable for extended history files
let selectedHistoryJsonFiles = [];

// Get DOM elements safely (only available on logged.html)
function getList() {
  return document.getElementById('list');
}

function getCover() {
  return document.getElementById('cover');
}

function authorize() {
  let url = AUTHORIZE
  url += "?client_id=" + client_id;
  url += "&response_type=code";
  url += "&redirect_uri=" + encodeURI(redirect);
  url += "&show_dialog=true";
  url += "&scope=user-read-private user-read-email user-read-playback-state user-top-read playlist-read-private playlist-read-collaborative";
  window.location.href = url;
}

function onPageLoad() {
  const urlParams = new URLSearchParams(window.location.search);
  const view = urlParams.get("view");
  
  // Check if we should load a specific view from extended history
  if (view === "top-songs") {
    getTopSongs();
    return;
  } else if (view === "top-artists") {
    getTopArtists();
    return;
  }
  
  // Default behavior
  if (window.location.search.length > 0) {
    handleRedirect(); // first time user has allowed access
  }
  else {
    getSongs(); // user has already been on this page
  }
}

function handleRedirect() {
  let code = getCode();
  if (code) {
    fetchAccessToken(code);
    window.history.pushState("", "", redirect);
  }
}

function handleFolderUpload(event) {
  const files = event.target.files;
  const status = document.getElementById("extended-history-status");

  if (!files || files.length === 0) {
    console.log("No files selected");
    selectedHistoryJsonFiles = [];
    if (status) status.textContent = "No folder selected.";
    return;
  }

  const fileArray = Array.from(files);
  
  // Filter JSON files (case-insensitive)
  const jsonFiles = fileArray.filter(f => f.name.toLowerCase().endsWith(".json"));
  
  // Calculate total size
  const totalBytes = jsonFiles.reduce((sum, f) => sum + f.size, 0);
  const totalMB = (totalBytes / (1024 * 1024)).toFixed(2);
  
  console.log(`Selected folder: ${fileArray.length} files total`);
  console.log(`JSON files: ${jsonFiles.length}, total ${totalMB} MB`);
  
  // Store files globally
  selectedHistoryJsonFiles = jsonFiles;
  
  // Update UI with status
  if (status) {
    if (jsonFiles.length === 0) {
      status.textContent = "No .json files found in that folder.";
    } else {
      status.textContent = `Ready: ${jsonFiles.length} JSON files (${totalMB} MB). Processing...`;
      // Automatically process after a short delay to show the status
      setTimeout(() => {
        parseExtendedHistory();
      }, 500);
    }
  }
}

async function parseExtendedHistory() {
  const status = document.getElementById("extended-history-status");
  const out = document.getElementById("extended-history-result");

  if (!selectedHistoryJsonFiles || selectedHistoryJsonFiles.length === 0) {
    alert("No files selected. Please choose a folder first.");
    return;
  }

  const formData = new FormData();
  for (const file of selectedHistoryJsonFiles) {
    formData.append("files", file, file.name);
  }

  // UI feedback
  if (status) status.textContent = `Uploading ${selectedHistoryJsonFiles.length} JSON files...`;
  if (out) out.textContent = "";

  try {
    const resp = await fetch("/api/upload/history", {
      method: "POST",
      body: formData,
      credentials: "include"
    });

    const text = await resp.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (parseError) {
      console.error("Server returned non-JSON:", text);
      console.error("Response status:", resp.status);
      console.error("Response headers:", resp.headers);
      // Show the actual response in the output area
      if (out) out.textContent = `Server Error (Status ${resp.status}):\n${text.substring(0, 500)}`;
      if (status) status.textContent = `Error: Server returned non-JSON (Status ${resp.status})`;
      throw new Error(`Server returned non-JSON (Status ${resp.status}). Check your server logs. Response: ${text.substring(0, 100)}`);
    }

    if (!resp.ok) {
      console.error("Upload failed:", data);
      if (status) status.textContent = "Upload failed.";
      if (out) out.textContent = JSON.stringify(data, null, 2);
      return;
    }

    if (status) status.textContent = "Upload complete. (Pass 1 summary below)";
    if (out) out.textContent = JSON.stringify(data, null, 2);

    // Show the history section after successful upload
    const historySection = document.getElementById("history-section");
    if (historySection && data.successful > 0) {
      historySection.style.display = "block";
      console.log("History section is now visible");
    } else {
      console.log("History section not shown. Upload data:", data);
    }

    console.log("Upload summary:", data);
  } catch (err) {
    console.error(err);
    if (status) status.textContent = `Error: ${err.message}`;
    if (out) out.textContent = err.stack || String(err);
    alert(err.message);
  }
}


function getCode() {
  let code = null;
  const queryString = window.location.search;
  if (queryString.length > 0){
    const urlParams = new URLSearchParams(queryString);
    code = urlParams.get('code');
  }
  return code;
}

// Exchange code for token via backend
async function fetchAccessToken(code) {
  try {
    const response = await fetch('/api/auth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ code: code })
    });

    const data = await response.json();

    if (response.ok && data.success) {
      // Store access token in localStorage
      localStorage.setItem("access_token", data.access_token);
      localStorage.setItem("expires_at", Date.now() + (data.expires_in * 1000));
      getSongs();
    } else {
      console.error('Token exchange failed:', data);
      alert('Failed to authenticate. Please try again.');
    }
  } catch (error) {
    console.error('Error:', error);
    alert('An error occurred. Please try again.');
  }
}

// Refresh token via backend
async function refreshAccessToken() {
  try {
    const response = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include' // include cookies for session
    });

    const data = await response.json();

    if (response.ok && data.success) {
      localStorage.setItem("access_token", data.access_token);
      localStorage.setItem("expires_at", Date.now() + (data.expires_in * 1000));
      return data.access_token;
    } else {
      throw new Error('Failed to refresh token');
    }
  } catch (error) {
    console.error('Token refresh error:', error);
    // Redirect to login if refresh fails
    window.location.href = '/';
    throw error;
  }
}

// Check if token is expired
function isTokenExpired() {
  const expiresAt = localStorage.getItem("expires_at");
  if (!expiresAt) return true;
  return Date.now() >= parseInt(expiresAt);
}

// Get valid access token (refresh if needed)
async function getValidAccessToken() {
  let accessToken = localStorage.getItem("access_token");
  
  if (!accessToken || isTokenExpired()) {
    accessToken = await refreshAccessToken();
  }
  
  return accessToken;
}

// Get songs
async function getSongs() {
  try {
    const token = await getValidAccessToken();
    callApi("GET", TRACKS, null, handleSongResponse);
  } catch (error) {
    console.error('Error getting access token:', error);
  }
}

// Call API with proper token handling
function callApi(method, url, body, callback) {
  getValidAccessToken().then(token => {
    let xhr = new XMLHttpRequest();
    xhr.open(method, url, true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.setRequestHeader('Authorization', 'Bearer ' + token);
    xhr.send(body);
    xhr.onload = callback;
  }).catch(error => {
    console.error('Error getting token for API call:', error);
  });
}

function handleSongResponse() {
  if (this.status == 200){
    var data = JSON.parse(this.responseText);
    console.log(data);
    songList(data);
  }
  else if (this.status == 401) {
    // Token expired, try to refresh
    refreshAccessToken().then(() => {
      getSongs(); // Retry the request
    }).catch(() => {
      alert('Session expired. Please log in again.');
    });
  }
  else{
    console.log(this.responseText);
    alert('Error loading songs: ' + this.responseText);
  }
}

function handleArtistResponse() {
  if (this.status == 200){
    var data = JSON.parse(this.responseText);
    artistList(data);
  }
  else if (this.status == 401) {
    // Token expired, try to refresh
    refreshAccessToken().then(() => {
      getArtists(); // Retry the request
    }).catch(() => {
      alert('Session expired. Please log in again.');
    });
  }
  else{
    console.log(this.responseText);
    alert('Error loading artists: ' + this.responseText);
  }
}

function songList(data) {
  removeItem();
  const cover = getCover();
  if (cover) cover.classList.remove('hide');
  
  for(i=0;i<data.items.length;i++){
    const list_item = document.createElement('div');
    const list_text = document.createElement('div');
    const song = document.createElement('div');
    const artist_album = document.createElement('div');
    const img = document.createElement('img');
    const span = document.createElement('span');
    const popu = document.createElement('div');
    const ref = document.createElement('a');
    const link = document.createTextNode("Link to Spotify");

    ref.appendChild(link);
    ref.title = "Link to Spotify";
    ref.href = data.items[i].external_urls.spotify;

    list_item.classList.add("list-item");
    list_text.classList.add("list-text");
    song.classList.add("song");
    artist_album.classList.add("artist-album");
    ref.classList.add("links");
    ref.setAttribute("target", "_blank");
    popu.classList.add("popu");
    img.classList.add("resize");

    var li = document.createElement('li');
    var number = document.createElement('span');
    number.textContent = (i+1) + ".";
    number.style.fontWeight = "bold";
    number.style.marginRight = "10px";
    img.src = data.items[i].album.images[1].url;

    popu.innerHTML = "Popularity Rating: " + data.items[i].popularity;
    span.innerHTML = data.items[i].name;
    artist_album.innerHTML = data.items[i].album.name + " • " + data.items[i].artists[0].name;

    song.appendChild(span);

    list_text.appendChild(song);
    list_text.appendChild(artist_album);
    list_text.appendChild(popu);
    list_text.appendChild(ref);
    
    list_item.insertBefore(number, list_item.firstChild);
    list_item.appendChild(list_text);
    list_item.appendChild(img); 
    li.appendChild(list_item);

    const list = getList();
    if (list) list.appendChild(li);
  }
}

function removeItem() {
  const list = getList();
  if (list) list.innerHTML = '';
}

async function getArtists() {
  try {
    const token = await getValidAccessToken();
    callApi("GET", ARTISTS, null, handleArtistResponse);
  } catch (error) {
    console.error('Error getting access token:', error);
  }
}

function artistList(data) { 
  removeItem();
  const cover = getCover();
  if (cover) cover.classList.remove('hide');
  
  for(i=0;i<data.items.length;i++){
    const list_item = document.createElement('div');
    const list_text = document.createElement('div');
    const song = document.createElement('div');
    const artist_album = document.createElement('div');
    const img = document.createElement('img');
    const span = document.createElement('span');
    const popu = document.createElement('div');
    const ref = document.createElement('a');
    const link = document.createTextNode("Link to Spotify");

    ref.appendChild(link);
    ref.title = "Link to Spotify";
    ref.href = data.items[i].external_urls.spotify;

    list_item.classList.add("list-item");
    list_text.classList.add("list-text");
    song.classList.add("artist");
    artist_album.classList.add("genre");
    ref.classList.add("links");
    ref.setAttribute("target", "_blank");
    popu.classList.add("popu");
    img.classList.add("resize");

    var li = document.createElement('li');
    var number = document.createElement('span');
    number.textContent = (i+1) + ".";
    number.style.fontWeight = "bold";
    number.style.marginRight = "10px";
    img.src = data.items[i].images[1].url;

    popu.innerHTML = "Popularity Rating: " + data.items[i].popularity;
    span.innerHTML = data.items[i].name;
    
    let genres = "";
    for(j=0;j<data.items[i].genres.length; j++){
      if(j>1) {
        break;
      }
      else if(j==1){
        genres = genres + " * " + data.items[i].genres[j];
      }
      else {
        genres = data.items[i].genres[j];
      }
    }
    artist_album.innerHTML = genres;

    song.appendChild(span);

    list_text.appendChild(song);
    list_text.appendChild(artist_album);
    list_text.appendChild(popu);
    list_text.appendChild(ref);
    
    list_item.insertBefore(number, list_item.firstChild);
    list_item.appendChild(list_text);
    list_item.appendChild(img); 
    li.appendChild(list_item);

    const list = getList();
    if (list) list.appendChild(li);
  }
}

async function getPlaylists() {
  try {
    const token = await getValidAccessToken();
    callApi("GET", PLAYLISTS, null, handlePlaylistResponse) //passing reference to method, calls immi when request is done 
  }
  catch (error) {
    console.error('Error getting access token:', error);
}
}

function handlePlaylistResponse(){
  if (this.status == 200){
    var data = JSON.parse(this.responseText);
    playlistList(data);
  }
  else if (this.status == 401) {
    // Token expired
    refreshAccessToken().then(() => {
      getPlaylists(); // retry request
    }).catch(() => {
      alert('Session expired. Please log in again.');
    });
  }
  else{
    console.log(this.responseText);
    alert('Error loading playlists: ' + this.responseText);
  }
}

function playlistList(data){
  removeItem();
  const cover = getCover();
  if (cover) cover.classList.remove('hide');
  for(i=0;i<data.items.length;i++){
    const list_item= document.createElement("div")
    const list_text= document.createElement("div")
    const song = document.createElement("div") //name of playlist
    const img = document.createElement('img')
    const span = document.createElement('span');

    list_item.classList.add("list-item")
    list_text.classList.add("list-text")
    song.classList.add("playlist-name")
    img.classList.add("resize");

    var li = document.createElement("li")
    var number = document.createElement('span');
    number.textContent = (i+1) + ".";

    number.textContent = (i+1) + ".";
    number.style.fontWeight = "bold";
    number.style.marginRight = "10px";
    if (data.items[i].images && data.items[i].images.length > 1) {
      img.src = data.items[i].images[1].url;
    } else if (data.items[i].images && data.items[i].images.length > 0) {
      img.src = data.items[i].images[0].url;  
    } else {
      img.src = ''; 
      img.alt = 'No image';
    }

    span.innerHTML = data.items[i].name;
    song.appendChild(span);

    list_text.appendChild(song);

    list_item.insertBefore(number, list_item.firstChild);
    list_item.appendChild(list_text);
    list_item.appendChild(img);  // Image on the right side
    li.appendChild(list_item);

    const playlistId = data.items[i].id;
    const playlistName = data.items[i].name;
    
    // Make the playlist item clickable
    list_item.style.cursor = 'pointer';
    list_item.addEventListener('click', function() {
      handlePlaylistClick(playlistId, playlistName);
    });

    const list = getList();
    if (list) list.appendChild(li);
  }
}

async function getPlaylistTracks(playlistId){
  try {
    const token = await getValidAccessToken();
    callApi("GET", `https://api.spotify.com/v1/playlists/${playlistId}/tracks`, null, handlePlaylistTracksResponse);
  } catch (error) {
    console.error('Error getting access token:', error);
  }
}

// Handler function for when a playlist is clicked
function handlePlaylistClick(playlistId, playlistName) {
  allPlaylistTracks = [];
  currentPlaylistId = playlistId;
  currentPlaylistName = playlistName;

  getPlaylistTracks(playlistId);
}

function handlePlaylistTracksResponse(){
  if (this.status == 200){
    var data = JSON.parse(this.responseText);
    allPlaylistTracks = allPlaylistTracks.concat(data.items);
    if (data.next){
      callApi("GET", data.next, null, handlePlaylistTracksResponse);
    }
    else{
      getAverageAge(allPlaylistTracks);
    }
  }
  else if (this.status == 401){
    // Token expired
    refreshAccessToken().then(() => {
      handlePlaylistClick(playlistId, playlistName);
    }).catch(() => {
      alert('Session expired. Please log in again.');
    });
  }
}

function getAverageAge(tracks){
  if (!Array.isArray(tracks) || tracks.length === 0) {
    console.log('No tracks to average');
    return null;
  }
  
  let totalTimestamp = 0;
  let validTracks = 0;
  const dates = []; // Store dates for averaging
  
  for(let i = 0; i < tracks.length; i++){
    if (tracks[i] && tracks[i].track && tracks[i].track.album) {
      const releaseDate = tracks[i].track.album.release_date;
      
      if (releaseDate) {
        
        let dateObj;
        if (releaseDate.length === 4) {
          dateObj = new Date(parseInt(releaseDate), 0, 1);
        } else {
          // Full date
          dateObj = new Date(releaseDate);
        }
        
        // Check if date is valid
        if (!isNaN(dateObj.getTime())) {
          dates.push(dateObj);
          totalTimestamp += dateObj.getTime(); // Add timestamp
          validTracks++;
          console.log(`Track: ${tracks[i].track.name}, Release: ${releaseDate}`);
        }
      }
    }
  }
  
  if (validTracks === 0) {
    console.log('No tracks with valid release dates found');
    return null;
  }
  
  // Calculate average date from timestamps
  const averageTimestamp = totalTimestamp / validTracks;
  const averageDate = new Date(averageTimestamp);
  
  // Calculate how many years ago the average date was
  const currentDate = new Date();
  const yearsAgo = (currentDate - averageDate) / (1000 * 60 * 60 * 24 * 365.25);
  
  console.log(`Average date: ${averageDate.toLocaleDateString()}, ${yearsAgo.toFixed(2)} years ago`);
  
  displayAverageAge(currentPlaylistName, averageDate, yearsAgo, validTracks, tracks.length);
  
  return { date: averageDate, yearsAgo: yearsAgo };
}

function displayAverageAge(playlistName, averageDate, yearsAgo, validTracks, totalTracks) {
  removeItem();
  const cover = getCover();
  if (cover) cover.classList.remove('hide');
  
  const list = getList();
  if (!list) return;
  
  // Format the date nicely
  const monthNames = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];
  
  const day = averageDate.getDate();
  const month = monthNames[averageDate.getMonth()];
  const year = averageDate.getFullYear();
  const formattedDate = `${month} ${day}, ${year}`;
  
  // Create a result display
  const resultItem = document.createElement('li');
  resultItem.style.padding = '30px';
  resultItem.style.textAlign = 'center';
  resultItem.style.background = 'rgba(29, 185, 84, 0.1)';
  resultItem.style.border = '2px solid #1db954';
  resultItem.style.borderRadius = '12px';
  
  const title = document.createElement('h2');
  title.textContent = playlistName;
  title.style.color = '#ffffff';
  title.style.marginBottom = '20px';
  title.style.fontSize = '24px';
  
  const averageText = document.createElement('div');
  averageText.innerHTML = `
    <div style="font-size: 36px; font-weight: 700; color: #1db954; margin: 20px 0;">
      ${formattedDate}
    </div>
    <div style="font-size: 24px; color: #b3b3b3; margin-top: 15px;">
      ${yearsAgo.toFixed(2)} years ago
    </div>
    <div style="font-size: 16px; color: #b3b3b3; margin-top: 20px;">
      Average release date of songs in this playlist
    </div>
    <div style="font-size: 14px; color: #b3b3b3; margin-top: 10px;">
      Calculated from ${validTracks} of ${totalTracks} tracks
    </div>
  `;
  
  resultItem.appendChild(title);
  resultItem.appendChild(averageText);
  list.appendChild(resultItem);
}

// Extended History Functions
async function getTopSongs() {
  const list = getList();
  const cover = getCover();
  if (!list || !cover) return;

  // Clear previous results completely
  list.innerHTML = '';
  
  // Add a loading message
  const loadingItem = document.createElement('li');
  loadingItem.style.cssText = 'color: #b3b3b3; padding: 20px; text-align: center;';
  loadingItem.textContent = 'Loading your top songs...';
  list.appendChild(loadingItem);
  
  try {
    const response = await fetch('/api/history/top-songs', {
      credentials: 'include'
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    
    // Clear loading message
    list.innerHTML = '';
    
    if (!data.songs || data.songs.length === 0) {
      list.innerHTML = '<li style="color: #b3b3b3; padding: 20px; text-align: center;">No listening history found. Please upload your extended history files first.</li>';
      return;
    }
    
    // Add header
    const headerItem = document.createElement('li');
    headerItem.style.cssText = 'font-weight: bold; font-size: 24px; color: #1db954; padding: 20px 0 15px 0; text-align: center; border-bottom: 2px solid #1db954; margin-bottom: 10px;';
    headerItem.textContent = 'Your Top 100 Songs (All Time)';
    list.appendChild(headerItem);
    
    // Display top songs
    data.songs.forEach((song, index) => {
      const listItem = document.createElement('li');
      listItem.className = 'list-item';
      
      const listText = document.createElement('div');
      listText.className = 'list-text';
      listText.innerHTML = `
        <span style="font-weight: bold; color: #1db954;">${index + 1}.</span>
        <span style="font-weight: bold;">${song.track_name}</span>
        <span style="color: #b3b3b3;">by ${song.artist_name}</span>
        <span style="color: #1db954; margin-left: 10px;">(${song.play_count} ${song.play_count === 1 ? 'play' : 'plays'})</span>
      `;
      
      listItem.appendChild(listText);
      list.appendChild(listItem);
    });
  } catch (error) {
    console.error('Error fetching top songs:', error);
    list.innerHTML = `<li style="color: #ff6b6b; padding: 20px;">Error: ${error.message}</li>`;
  }
}

async function getTopArtists() {
  const list = getList();
  const cover = getCover();
  if (!list || !cover) return;

  // Clear previous results completely
  list.innerHTML = '';
  
  // Add a loading message
  const loadingItem = document.createElement('li');
  loadingItem.style.cssText = 'color: #b3b3b3; padding: 20px; text-align: center;';
  loadingItem.textContent = 'Loading your top artists...';
  list.appendChild(loadingItem);
  
  try {
    const response = await fetch('/api/history/top-artists', {
      credentials: 'include'
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    
    // Clear loading message
    list.innerHTML = '';
    
    if (!data.artists || data.artists.length === 0) {
      list.innerHTML = '<li style="color: #b3b3b3; padding: 20px; text-align: center;">No listening history found. Please upload your extended history files first.</li>';
      return;
    }
    
    // Add header
    const headerItem = document.createElement('li');
    headerItem.style.cssText = 'font-weight: bold; font-size: 24px; color: #1db954; padding: 20px 0 15px 0; text-align: center; border-bottom: 2px solid #1db954; margin-bottom: 10px;';
    headerItem.textContent = 'Your Top 100 Artists (All Time)';
    list.appendChild(headerItem);
    
    // Display top artists
    data.artists.forEach((artist, index) => {
      const listItem = document.createElement('li');
      listItem.className = 'list-item';
      
      const listText = document.createElement('div');
      listText.className = 'list-text';
      listText.innerHTML = `
        <span style="font-weight: bold; color: #1db954;">${index + 1}.</span>
        <span style="font-weight: bold;">${artist.artist_name}</span>
        <span style="color: #1db954; margin-left: 10px;">(${artist.total_plays} ${artist.total_plays === 1 ? 'play' : 'plays'}, ${artist.total_tracks} ${artist.total_tracks === 1 ? 'song' : 'songs'})</span>
      `;
      
      listItem.appendChild(listText);
      list.appendChild(listItem);
    });
  } catch (error) {
    console.error('Error fetching top artists:', error);
    list.innerHTML = `<li style="color: #ff6b6b; padding: 20px;">Error: ${error.message}</li>`;
  }
}

async function searchHistory() {
  const list = getList();
  const cover = getCover();
  const searchInput = document.getElementById('history-search-input');
  
  if (!list || !cover) return;
  
  const query = searchInput ? searchInput.value.trim() : '';
  
  if (!query) {
    alert('Please enter a search query');
    return;
  }
  
  // Clear previous results completely
  list.innerHTML = '<li style="color: #b3b3b3; padding: 10px; text-align: center;">Searching...</li>';
  
  try {
    const response = await fetch(`/api/history/search?q=${encodeURIComponent(query)}`, {
      credentials: 'include'
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    
    // Clear loading message
    list.innerHTML = '';
    
    if ((!data.songs || data.songs.length === 0) && (!data.artists || data.artists.length === 0)) {
      list.innerHTML = `<li style="color: #b3b3b3; padding: 20px; text-align: center;">No results found for "${query}"</li>`;
      return;
    }
    
    // Add header
    const headerItem = document.createElement('li');
    headerItem.style.cssText = 'font-weight: bold; font-size: 24px; color: #1db954; padding: 20px 0 15px 0; text-align: center; border-bottom: 2px solid #1db954; margin-bottom: 10px;';
    headerItem.textContent = `Search Results for "${query}"`;
    list.appendChild(headerItem);
    
    // Display songs
    if (data.songs && data.songs.length > 0) {
      const songsHeader = document.createElement('li');
      songsHeader.style.cssText = 'font-weight: bold; font-size: 18px; color: #1db954; padding: 15px 0 10px 0; border-bottom: 1px solid #333;';
      songsHeader.textContent = 'Songs:';
      list.appendChild(songsHeader);
      
      data.songs.forEach((song) => {
        const listItem = document.createElement('li');
        listItem.className = 'list-item';
        
        const listText = document.createElement('div');
        listText.className = 'list-text';
        listText.innerHTML = `
          <span style="font-weight: bold;">${song.track_name}</span>
          <span style="color: #b3b3b3;">by ${song.artist_name}</span>
          <span style="color: #1db954; margin-left: 10px;">(${song.play_count} ${song.play_count === 1 ? 'play' : 'plays'})</span>
        `;
        
        listItem.appendChild(listText);
        list.appendChild(listItem);
      });
    }
    
    // Display artists
    if (data.artists && data.artists.length > 0) {
      const artistsHeader = document.createElement('li');
      artistsHeader.style.cssText = 'font-weight: bold; font-size: 18px; color: #1db954; padding: 15px 0 10px 0; margin-top: 20px; border-bottom: 1px solid #333;';
      artistsHeader.textContent = 'Artists:';
      list.appendChild(artistsHeader);
      
      data.artists.forEach((artist) => {
        const listItem = document.createElement('li');
        listItem.className = 'list-item';
        
        const listText = document.createElement('div');
        listText.className = 'list-text';
        listText.innerHTML = `
          <span style="font-weight: bold;">${artist.artist_name}</span>
          <span style="color: #1db954; margin-left: 10px;">(${artist.total_plays} ${artist.total_plays === 1 ? 'play' : 'plays'}, ${artist.total_tracks} ${artist.total_tracks === 1 ? 'song' : 'songs'})</span>
        `;
        
        listItem.appendChild(listText);
        list.appendChild(listItem);
      });
    }
  } catch (error) {
    console.error('Error searching:', error);
    list.innerHTML = `<li style="color: #ff6b6b; padding: 20px;">Error: ${error.message}</li>`;
  }
}