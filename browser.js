/* ============================================================
   Hits — browser.js
   A-Z → Artist → Album → Track browser
   Audio served from audio.iatebreakfast.com/aloha/
   Art fetched from Last.fm API
   ============================================================ */

const AUDIO_BASE = 'https://audio.iatebreakfast.com/aloha';
const LASTFM_KEY = 'e44eff34c786df9f96c58920764bbd43';
const LASTFM_API = 'https://ws.audioscrobbler.com/2.0/';

const ART_FALLBACK = 'data:image/svg+xml,' + encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300">
    <rect width="300" height="300" fill="#001500"/>
    <text x="150" y="165" font-size="80" text-anchor="middle" fill="#006600">♬</text>
  </svg>`);

// ─────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────

let allArtists   = [];   // [{name, encoded}]
let activeLetter = null;
let activeArtist = null;
let activeAlbum  = null;
let tracks       = [];
let currentTrack = -1;

const artCache = {};
const audio    = new Audio();
audio.preload  = 'none';

// ─────────────────────────────────────────────────────────────
// DOM refs
// ─────────────────────────────────────────────────────────────

const alphaSection     = document.getElementById('alphaSection');
const alphaNav         = document.getElementById('alphaNav');
const artistSection    = document.getElementById('artistSection');
const artistSectionTitle = document.getElementById('artistSectionTitle');
const artistGrid       = document.getElementById('artistGrid');
const albumSection     = document.getElementById('albumSection');
const albumSectionTitle  = document.getElementById('albumSectionTitle');
const albumGrid        = document.getElementById('albumGrid');
const trackSection     = document.getElementById('trackSection');
const trackSectionTitle  = document.getElementById('trackSectionTitle');
const trackList        = document.getElementById('trackList');
const hero             = document.getElementById('hero');
const breadcrumb       = document.getElementById('breadcrumb');
const stickyBar        = document.getElementById('stickyBar');
const stickyArt        = document.getElementById('stickyArt');
const stickyTitle      = document.getElementById('stickyTitle');
const stickyArtist     = document.getElementById('stickyArtist');

// ─────────────────────────────────────────────────────────────
// Fetch helpers
// ─────────────────────────────────────────────────────────────

async function fetchDir(path) {
  const url = path ? `${AUDIO_BASE}/${path}/` : `${AUDIO_BASE}/`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${url}`);
  return res.json();
}

function isAudioFile(name) {
  return /\.(mp3|m4a|aac|flac|ogg|wav|wma)$/i.test(name);
}

function isDir(item) { return item.type === 'directory'; }

function enc(name) { return encodeURIComponent(name); }

// ─────────────────────────────────────────────────────────────
// Last.fm art helpers
// ─────────────────────────────────────────────────────────────

async function getArtistArt(artist) {
  const key = `artist:${artist}`;
  if (artCache[key] !== undefined) return artCache[key];
  try {
    const p = new URLSearchParams({ method: 'artist.getInfo', api_key: LASTFM_KEY, artist, format: 'json', autocorrect: 1 });
    const data = await fetch(`${LASTFM_API}?${p}`).then(r => r.json());
    const images = data?.artist?.image;
    const url = pickImage(images);
    artCache[key] = url;
    return url;
  } catch(_) { artCache[key] = null; return null; }
}

async function getAlbumArt(artist, album) {
  const key = `album:${artist}:${album}`;
  if (artCache[key] !== undefined) return artCache[key];
  try {
    const p = new URLSearchParams({ method: 'album.getInfo', api_key: LASTFM_KEY, artist, album, format: 'json', autocorrect: 1 });
    const data = await fetch(`${LASTFM_API}?${p}`).then(r => r.json());
    const images = data?.album?.image;
    const url = pickImage(images);
    artCache[key] = url;
    return url;
  } catch(_) { artCache[key] = null; return null; }
}

function pickImage(images) {
  if (!images || !images.length) return null;
  const pref = ['extralarge', 'large', 'medium'];
  for (const size of pref) {
    const img = images.find(i => i.size === size);
    if (img?.['#text']) return img['#text'];
  }
  return images[images.length - 1]?.['#text'] || null;
}

// ─────────────────────────────────────────────────────────────
// Init — load artist list, build alphabet nav
// ─────────────────────────────────────────────────────────────

async function init() {
  try {
    const items = await fetchDir('');
    allArtists = items
      .filter(isDir)
      .map(i => ({ name: i.name, encoded: enc(i.name) }))
      .sort((a, b) => a.name.localeCompare(b.name));

    buildAlphaNav();
  } catch(err) {
    console.error('Could not load artist list:', err);
    alphaNav.innerHTML = '<p style="color:#e87038;font-size:.85rem">Could not connect to audio server.</p>';
  }
}

function buildAlphaNav() {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ#'.split('');

  // Which letters have artists
  const available = new Set(allArtists.map(a => {
    const ch = a.name[0].toUpperCase();
    return /[A-Z]/.test(ch) ? ch : '#';
  }));

  alphaNav.innerHTML = '';
  letters.forEach(letter => {
    const btn = document.createElement('button');
    btn.className = 'alpha-btn';
    btn.textContent = letter;
    btn.dataset.letter = letter;
    if (!available.has(letter)) btn.disabled = true;
    btn.addEventListener('click', () => selectLetter(letter));
    alphaNav.appendChild(btn);
  });
}

// ─────────────────────────────────────────────────────────────
// Letter selection → show artist grid
// ─────────────────────────────────────────────────────────────

function selectLetter(letter) {
  activeLetter = letter;
  activeArtist = null;
  activeAlbum  = null;
  stopAudio();

  document.querySelectorAll('.alpha-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.letter === letter));

  const filtered = allArtists.filter(a => {
    const ch = a.name[0].toUpperCase();
    return letter === '#' ? !/[A-Z]/.test(ch) : ch === letter;
  });

  artistSectionTitle.textContent = `Artists — ${letter}`;
  artistGrid.innerHTML = '';

  filtered.forEach(artist => {
    const card = makeCard(artist.name, '', () => selectArtist(artist));
    artistGrid.appendChild(card);
  });

  artistSection.hidden  = false;
  albumSection.hidden   = true;
  trackSection.hidden   = true;
  hero.hidden           = true;

  updateBreadcrumb();
  artistSection.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // Load artist art progressively
  loadProgressiveArt(filtered, async (artist, img) => {
    const url = await getArtistArt(artist.name);
    if (url && img) { img.src = url; img.classList.add('loaded'); }
  });
}

// ─────────────────────────────────────────────────────────────
// Artist selection → show album grid (or tracks if no albums)
// ─────────────────────────────────────────────────────────────

async function selectArtist(artist) {
  activeArtist = artist;
  activeAlbum  = null;
  stopAudio();

  // Mark active card
  document.querySelectorAll('#artistGrid .music-card').forEach(c =>
    c.classList.toggle('active', c.dataset.name === artist.name));

  albumSectionTitle.textContent = artist.name;
  albumGrid.innerHTML = `<div class="loading-state"><div class="spinner"></div></div>`;
  albumSection.hidden  = false;
  trackSection.hidden  = true;
  albumSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  updateBreadcrumb();

  try {
    const items = await fetchDir(artist.encoded);
    const dirs  = items.filter(isDir);
    const files = items.filter(i => i.type === 'file' && isAudioFile(i.name));

    albumGrid.innerHTML = '';

    if (dirs.length === 0 && files.length > 0) {
      // No albums — artist folder has tracks directly
      showTracks(files, artist.name, null, `${AUDIO_BASE}/${artist.encoded}`);
      albumSection.hidden = true;
      return;
    }

    // Show albums
    dirs.forEach(dir => {
      const card = makeCard(dir.name, '', () => selectAlbum(artist, dir.name));
      albumGrid.appendChild(card);
    });

    // If there are also loose files, add a virtual "Singles" album
    if (files.length > 0) {
      const card = makeCard('Singles & Extras', `${files.length} tracks`, () =>
        showTracks(files, artist.name, 'Singles & Extras', `${AUDIO_BASE}/${artist.encoded}`));
      albumGrid.appendChild(card);
    }

    // Load album art
    const albumItems = dirs.map(d => ({ name: d.name }));
    loadProgressiveArt(albumItems, async (item, img) => {
      const url = await getAlbumArt(artist.name, item.name);
      if (url && img) { img.src = url; img.classList.add('loaded'); }
    });

  } catch(err) {
    albumGrid.innerHTML = `<p style="color:#e87038;padding:24px">Could not load albums.</p>`;
    console.error(err);
  }
}

// ─────────────────────────────────────────────────────────────
// Album selection → show track list
// ─────────────────────────────────────────────────────────────

async function selectAlbum(artist, albumName) {
  activeAlbum = albumName;

  document.querySelectorAll('#albumGrid .music-card').forEach(c =>
    c.classList.toggle('active', c.dataset.name === albumName));

  trackSection.hidden = false;
  trackSectionTitle.textContent = albumName;
  trackList.innerHTML = `<li class="loading-state"><div class="spinner"></div></li>`;
  trackSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  updateBreadcrumb();

  try {
    const path  = `${artist.encoded}/${enc(albumName)}`;
    const items = await fetchDir(path);
    const files = items.filter(i => i.type === 'file' && isAudioFile(i.name));
    showTracks(files, artist.name, albumName, `${AUDIO_BASE}/${path}`);
  } catch(err) {
    trackList.innerHTML = `<li style="color:#e87038;padding:24px">Could not load tracks.</li>`;
    console.error(err);
  }
}

// ─────────────────────────────────────────────────────────────
// Show track list
// ─────────────────────────────────────────────────────────────

function showTracks(files, artistName, albumName, baseUrl) {
  files.sort((a, b) => a.name.localeCompare(b.name));

  tracks = files.map(f => ({
    name:   cleanTrackName(f.name),
    url:    `${baseUrl}/${enc(f.name)}`,
    artist: artistName,
    album:  albumName,
  }));

  trackList.innerHTML = tracks.map((t, i) => `
    <li class="track-row" data-index="${i}" role="button" tabindex="0">
      <span class="track-num">${String(i + 1).padStart(2, '0')}</span>
      <span class="track-name">${escHtml(t.name)}</span>
      <button class="track-play-btn" tabindex="-1">▶</button>
    </li>`).join('');

  trackSection.hidden = false;

  document.querySelectorAll('.track-row').forEach(row => {
    row.addEventListener('click', () => playTrack(Number(row.dataset.index)));
    row.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') playTrack(Number(row.dataset.index));
    });
  });
}

function cleanTrackName(filename) {
  return filename
    .replace(/\.(mp3|m4a|aac|flac|ogg|wav|wma)$/i, '')
    .replace(/^\d+[\s.\-_]+/, '')
    .trim();
}

// ─────────────────────────────────────────────────────────────
// Playback
// ─────────────────────────────────────────────────────────────

function playTrack(index) {
  if (index < 0 || index >= tracks.length) return;
  document.querySelectorAll('.track-row').forEach(r => r.classList.remove('active'));

  currentTrack = index;
  const t = tracks[index];
  audio.src = t.url;
  audio.play().catch(console.error);

  const row = document.querySelector(`.track-row[data-index="${index}"]`);
  if (row) { row.classList.add('active'); row.scrollIntoView({ block: 'nearest' }); }

  stickyTitle.textContent  = t.name;
  stickyArtist.textContent = t.artist + (t.album ? ` · ${t.album}` : '');
  stickyBar.hidden = false;

  // Set sticky art — try album art cache
  const artKey = t.album ? `album:${t.artist}:${t.album}` : `artist:${t.artist}`;
  const cachedArt = artCache[artKey];
  stickyArt.src = cachedArt || ART_FALLBACK;

  updatePlayPauseBtn();
}

function togglePlayPause() {
  if (currentTrack === -1 && tracks.length > 0) { playTrack(0); return; }
  if (audio.paused) audio.play().catch(console.error);
  else              audio.pause();
  updatePlayPauseBtn();
}

function playPrev() { if (currentTrack > 0) playTrack(currentTrack - 1); }
function playNext() { if (currentTrack < tracks.length - 1) playTrack(currentTrack + 1); }

function stopAudio() {
  audio.pause();
  audio.src = '';
  currentTrack = -1;
  tracks = [];
}

function updatePlayPauseBtn() {
  const btn = document.getElementById('playPauseBtn');
  if (btn) btn.textContent = audio.paused ? '▶' : '⏸';
}

audio.addEventListener('timeupdate', () => {
  const bar = document.getElementById('progressBar');
  const cur = document.getElementById('timeCur');
  if (!bar || !audio.duration) return;
  bar.value = (audio.currentTime / audio.duration) * 100;
  if (cur) cur.textContent = formatTime(audio.currentTime);
});

audio.addEventListener('loadedmetadata', () => {
  const dur = document.getElementById('timeDur');
  if (dur) dur.textContent = formatTime(audio.duration);
});

audio.addEventListener('ended', playNext);
audio.addEventListener('pause', updatePlayPauseBtn);
audio.addEventListener('play',  updatePlayPauseBtn);

document.getElementById('playPauseBtn').addEventListener('click', togglePlayPause);
document.getElementById('prevBtn').addEventListener('click', playPrev);
document.getElementById('nextBtn').addEventListener('click', playNext);

document.getElementById('progressBar').addEventListener('input', e => {
  if (audio.duration) audio.currentTime = (e.target.value / 100) * audio.duration;
});

document.getElementById('volumeBar').addEventListener('input', e => {
  audio.volume = e.target.value / 100;
});

// ─────────────────────────────────────────────────────────────
// Progressive art loading
// ─────────────────────────────────────────────────────────────

async function loadProgressiveArt(items, fetcher) {
  const cards = document.querySelectorAll('.music-card');
  const BATCH = 4;
  for (let i = 0; i < items.length; i += BATCH) {
    await Promise.all(items.slice(i, i + BATCH).map(async (item, offset) => {
      const idx = i + offset;
      const img = cards[idx]?.querySelector('.card-art');
      await fetcher(item, img);
    }));
    await new Promise(r => setTimeout(r, 100));
  }
}

// ─────────────────────────────────────────────────────────────
// Card factory
// ─────────────────────────────────────────────────────────────

function makeCard(title, sub, onClick) {
  const div = document.createElement('div');
  div.className = 'music-card';
  div.dataset.name = title;
  div.setAttribute('role', 'button');
  div.setAttribute('tabindex', '0');
  div.innerHTML = `
    <div class="card-art-wrap">
      <img class="card-art" src="${ART_FALLBACK}" alt="${escHtml(title)}" loading="lazy" />
      <div class="card-overlay"><div class="card-play-icon">▶</div></div>
    </div>
    <div class="card-info">
      <div class="card-title">${escHtml(title)}</div>
      ${sub ? `<div class="card-sub">${escHtml(sub)}</div>` : ''}
    </div>`;
  div.addEventListener('click', onClick);
  div.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') onClick(); });
  return div;
}

// ─────────────────────────────────────────────────────────────
// Breadcrumb
// ─────────────────────────────────────────────────────────────

function updateBreadcrumb() {
  breadcrumb.innerHTML = '';
  const add = (label, onClick, isCurrent) => {
    if (breadcrumb.children.length > 0) {
      const sep = document.createElement('span');
      sep.className = 'breadcrumb-sep';
      sep.textContent = '›';
      breadcrumb.appendChild(sep);
    }
    const span = document.createElement('span');
    span.className = 'breadcrumb-item' + (isCurrent ? ' current' : '');
    span.textContent = label;
    if (!isCurrent && onClick) span.addEventListener('click', onClick);
    breadcrumb.appendChild(span);
  };

  add('Library', () => goHome());

  if (activeLetter) {
    add(activeLetter, () => selectLetter(activeLetter), !activeArtist);
  }
  if (activeArtist) {
    add(activeArtist.name, () => selectArtist(activeArtist), !activeAlbum);
  }
  if (activeAlbum) {
    add(activeAlbum, null, true);
  }
}

function goHome() {
  activeLetter = null;
  activeArtist = null;
  activeAlbum  = null;
  stopAudio();

  document.querySelectorAll('.alpha-btn').forEach(b => b.classList.remove('active'));
  artistSection.hidden = true;
  albumSection.hidden  = true;
  trackSection.hidden  = true;
  hero.hidden          = false;
  updateBreadcrumb();
}

// ─────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────

function formatTime(secs) {
  if (!isFinite(secs)) return '0:00';
  return `${Math.floor(secs / 60)}:${String(Math.floor(secs % 60)).padStart(2, '0')}`;
}

function escHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ─────────────────────────────────────────────────────────────
// Start
// ─────────────────────────────────────────────────────────────

init();
