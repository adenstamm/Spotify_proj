var redirect = "http://127.0.0.1:8888/logged"; // Must match SPOTIFY_REDIRECT_URI in .env

var client_id = "be0e6280dd0545b6a67f660345b25628";

const AUTHORIZE = "https://accounts.spotify.com/authorize";
const ARTISTS = "https://api.spotify.com/v1/me/top/artists?offset=0&limit=10&time_range=long_term";
const TRACKS  = "https://api.spotify.com/v1/me/top/tracks?offset=0&limit=10&time_range=long_term";

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
  url += "&scope=user-read-private user-read-email user-read-playback-state user-top-read";
  window.location.href = url;
}

function onPageLoad() {
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
      credentials: 'include' // Important: include cookies for session
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
    
    // Add number first, then text, then image (image on right)
    list_item.insertBefore(number, list_item.firstChild);
    list_item.appendChild(list_text);
    list_item.appendChild(img);  // Image on the right side
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
    
    // Add number first, then text, then image (image on right)
    list_item.insertBefore(number, list_item.firstChild);
    list_item.appendChild(list_text);
    list_item.appendChild(img);  // Image on the right side
    li.appendChild(list_item);

    const list = getList();
    if (list) list.appendChild(li);
  }
}
