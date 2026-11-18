(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const storageKey = 'wave-navidrome';
  const API_VERSION = '1.16.1';
  const CLIENT_NAME = 'Wave';
  let serverUrl = '';
  let username = '';
  let password = '';
  let connected = false;
  let remoteTracks = [];
  let activeIndex = -1;
  let searchTimer = null;
  let requestCounter = 0;

  const escapeHTML = value => String(value || '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
  const formatTime = seconds => Number.isFinite(Number(seconds))
    ? Math.floor(Number(seconds) / 60) + ':' + String(Math.floor(Number(seconds) % 60)).padStart(2, '0')
    : '';

  function md5(input) {
    const bytes = new TextEncoder().encode(input);
    const bitLength = bytes.length * 8;
    const paddedLength = ((bytes.length + 8) >> 6) + 1;
    const data = new Uint8Array(paddedLength * 64);
    data.set(bytes);
    data[bytes.length] = 0x80;
    const view = new DataView(data.buffer);
    view.setUint32(data.length - 8, bitLength >>> 0, true);
    view.setUint32(data.length - 4, Math.floor(bitLength / 0x100000000), true);

    const shifts = [
      7,12,17,22,7,12,17,22,7,12,17,22,7,12,17,22,
      5,9,14,20,5,9,14,20,5,9,14,20,5,9,14,20,
      4,11,16,23,4,11,16,23,4,11,16,23,4,11,16,23,
      6,10,15,21,6,10,15,21,6,10,15,21,6,10,15,21
    ];
    const constants = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) | 0);
    let a0 = 0x67452301;
    let b0 = 0xefcdab89;
    let c0 = 0x98badcfe;
    let d0 = 0x10325476;
    const rotate = (x, amount) => (x << amount) | (x >>> (32 - amount));

    for (let offset = 0; offset < data.length; offset += 64) {
      const words = new Int32Array(16);
      for (let i = 0; i < 16; i++) words[i] = view.getInt32(offset + i * 4, true);
      let a = a0, b = b0, c = c0, d = d0;
      for (let i = 0; i < 64; i++) {
        let f, g;
        if (i < 16) { f = (b & c) | (~b & d); g = i; }
        else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) % 16; }
        else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) % 16; }
        else { f = c ^ (b | ~d); g = (7 * i) % 16; }
        const sum = (a + f + constants[i] + words[g]) | 0;
        const nextB = (b + rotate(sum, shifts[i])) | 0;
        a = d;
        d = c;
        c = b;
        b = nextB;
      }
      a0 = (a0 + a) | 0;
      b0 = (b0 + b) | 0;
      c0 = (c0 + c) | 0;
      d0 = (d0 + d) | 0;
    }

    return [a0, b0, c0, d0].map(word =>
      [0, 8, 16, 24].map(shift => ((word >>> shift) & 255).toString(16).padStart(2, '0')).join('')
    ).join('');
  }

  function randomSalt() {
    return Array.from(crypto.getRandomValues(new Uint8Array(12)), value => value.toString(16).padStart(2, '0')).join('');
  }

  function authParams() {
    const salt = randomSalt();
    return { u: username, t: md5(password + salt), s: salt, v: API_VERSION, c: CLIENT_NAME, f: 'json' };
  }

  function apiUrl(endpoint, extra = {}) {
    const base = serverUrl.endsWith('/') ? serverUrl : serverUrl + '/';
    const url = new URL('rest/' + endpoint + '.view', base);
    Object.entries({ ...authParams(), ...extra }).forEach(([key, value]) => {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    });
    return url.toString();
  }

  async function request(endpoint, extra = {}) {
    let response;
    try {
      response = await fetch(apiUrl(endpoint, extra), {
        method: 'GET',
        mode: 'cors',
        credentials: 'omit',
        cache: 'no-store'
      });
    } catch (_) {
      throw new Error('Could not reach the server. Check its HTTPS address and CORS configuration.');
    }

    if (!response.ok) throw new Error('Server returned HTTP ' + response.status + '.');

    let payload;
    try {
      payload = await response.json();
    } catch (_) {
      throw new Error('The server did not return a valid Subsonic API response.');
    }

    const result = payload['subsonic-response'];
    if (!result) throw new Error('This server did not respond as a Subsonic-compatible API.');

    if (result.status !== 'ok') {
      const code = result.error && result.error.code;
      const message = result.error && result.error.message;
      if (code === 10) throw new Error('Incorrect username or password.');
      if (code === 20) throw new Error('This account is not authorized to access the server.');
      throw new Error(message || 'The server rejected the request.');
    }

    return result;
  }

  function coverUrl(id) {
    return id ? apiUrl('getCoverArt', { id, size: 160 }) : '';
  }

  function streamUrl(id) {
    return apiUrl('stream', { id });
  }

  function showSetup(message, isError = false) {
    $('navidromeSetup').hidden = false;
    $('navidromeConnected').hidden = true;
    $('navidromeSetupMessage').textContent = message;
    $('navidromeSetupMessage').classList.toggle('error-text', isError);
  }

  function showConnected() {
    $('navidromeSetup').hidden = true;
    $('navidromeConnected').hidden = false;
    $('navidromeServerName').textContent = serverUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
    $('navidromeServerUser').textContent = 'Signed in as ' + username;
    $('navidromeMessage').textContent = 'Search your server to find music.';
    $('navidromeMessage').classList.remove('error-text');
  }

  function emptyResults(title, subtitle) {
    $('navidromeResults').innerHTML =
      '<div class="empty"><span class="empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 4 4"/></svg></span><strong>' +
      escapeHTML(title) + '</strong><small>' + escapeHTML(subtitle) + '</small></div>';
  }

  function renderResults() {
    if (!remoteTracks.length) {
      emptyResults('No tracks found', 'Try another song title or artist.');
      return;
    }

    $('navidromeResults').innerHTML = remoteTracks.map((track, index) => {
      const cover = track.coverUrl
        ? '<img class="remote-cover" src="' + escapeHTML(track.coverUrl) + '" alt="" loading="lazy">'
        : '<span class="remote-cover remote-cover-empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></span>';

      return '<article class="track remote-track ' + (index === activeIndex ? 'current' : '') + '">' +
        '<span class="remote-art">' + cover + '</span>' +
        '<div class="meta"><strong>' + escapeHTML(track.name) + '</strong><small>' +
          escapeHTML([track.artist, track.album].filter(Boolean).join(' · ') || 'Unknown artist') +
        '</small></div>' +
        '<span class="remote-duration">' + formatTime(track.duration) + '</span>' +
        '<button class="icon-btn" type="button" data-remote-play="' + index + '" aria-label="Play ' + escapeHTML(track.name) + '">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m8 5 11 7-11 7z"/></svg>' +
        '</button></article>';
    }).join('');
  }

  async function search(query) {
    if (!connected) return;
    const term = query.trim();
    const id = ++requestCounter;

    if (term.length < 2) {
      remoteTracks = [];
      emptyResults('Search your music server', 'Enter at least 2 characters to search tracks and artists.');
      $('navidromeMessage').textContent = 'Connected. Search by track, artist, or album.';
      return;
    }

    $('navidromeMessage').textContent = 'Searching your music library…';
    $('navidromeMessage').classList.remove('error-text');

    try {
      const result = await request('search3', {
        query: term,
        songCount: 50,
        albumCount: 0,
        artistCount: 0
      });
      if (id !== requestCounter) return;

      const songs = (result.searchResult3 && result.searchResult3.song) || [];
      remoteTracks = songs.map(song => ({
        id: song.id,
        name: song.title || 'Untitled track',
        artist: song.artist || 'Unknown artist',
        album: song.album || '',
        duration: Number(song.duration) || 0,
        coverUrl: coverUrl(song.coverArt)
      }));
      activeIndex = -1;
      renderResults();
      $('navidromeMessage').textContent = remoteTracks.length
        ? remoteTracks.length + (remoteTracks.length === 1 ? ' track found.' : ' tracks found.')
        : 'No matching tracks found.';
    } catch (error) {
      if (id !== requestCounter) return;
      $('navidromeMessage').textContent = error.message;
      $('navidromeMessage').classList.add('error-text');
      emptyResults('Search unavailable', error.message);
    }
  }

  function play(index) {
    const track = remoteTracks[index];
    if (!track || !connected || !window.WavePlayer) return;
    activeIndex = index;
    renderResults();
    window.WavePlayer.playRemote(track, streamUrl(track.id));
  }

  function move(delta) {
    if (!remoteTracks.length) return;
    let next = activeIndex + delta;
    if (next < 0) next = remoteTracks.length - 1;
    if (next >= remoteTracks.length) next = 0;
    play(next);
  }

  $('navidromeForm').addEventListener('submit', async event => {
    event.preventDefault();
    const rawUrl = $('navidromeUrl').value.trim();
    const user = $('navidromeUsername').value.trim();
    const pass = $('navidromePassword').value;
    let parsed;

    try {
      parsed = new URL(rawUrl);
    } catch (_) {
      showSetup('Enter a valid server URL.', true);
      return;
    }

    if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
      showSetup('Use HTTPS for secure server authentication.', true);
      return;
    }
    if (!user || !pass) {
      showSetup('Enter your Navidrome username and password.', true);
      return;
    }

    serverUrl = parsed.href.replace(/\/+$/, '');
    username = user;
    password = pass;
    $('navidromeConnect').disabled = true;
    $('navidromeSetupMessage').textContent = 'Connecting…';
    $('navidromeSetupMessage').classList.remove('error-text');

    try {
      await request('ping');
      connected = true;
      try {
        localStorage.setItem(storageKey, JSON.stringify({ url: serverUrl, username }));
      } catch (_) {}
      $('navidromePassword').value = '';
      $('search').value = '';
      showConnected();
      emptyResults('Search your music server', 'Enter at least 2 characters to search tracks and artists.');
      $('search').focus();
    } catch (error) {
      connected = false;
      password = '';
      $('navidromePassword').value = '';
      showSetup(error.message, true);
    } finally {
      $('navidromeConnect').disabled = false;
    }
  });

  $('navidromeResults').addEventListener('click', event => {
    const button = event.target.closest('[data-remote-play]');
    if (button) play(Number(button.dataset.remotePlay));
  });

  $('search').addEventListener('input', () => {
    if (!connected || $('navidromeView').hidden) return;
    clearTimeout(searchTimer);
    const query = $('search').value;
    searchTimer = setTimeout(() => search(query), 300);
  });

  $('navidromeChange').onclick = () => {
    connected = false;
    password = '';
    $('navidromePassword').value = '';
    const saved = (() => {
      try { return JSON.parse(localStorage.getItem(storageKey) || '{}'); }
      catch (_) { return {}; }
    })();
    $('navidromeUrl').value = saved.url || serverUrl;
    $('navidromeUsername').value = saved.username || username;
    showSetup('Enter your password to reconnect. Wave does not save it.');
  };

  $('navidromeDisconnect').onclick = () => {
    connected = false;
    password = '';
    remoteTracks = [];
    activeIndex = -1;
    requestCounter++;
    try { localStorage.removeItem(storageKey); } catch (_) {}
    if (window.WavePlayer && window.WavePlayer.isRemoteTrack()) {
      window.WavePlayer.clearRemote();
    }
    $('navidromeUrl').value = '';
    $('navidromeUsername').value = '';
    $('navidromePassword').value = '';
    $('search').value = '';
    showSetup('Server disconnected. Credentials have been cleared.');
  };

  window.WaveNavidrome = {
    next: () => move(1),
    previous: () => move(-1),
    search
  };

  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || '{}');
    if (saved.url) $('navidromeUrl').value = saved.url;
    if (saved.username) $('navidromeUsername').value = saved.username;
    if (saved.url || saved.username) {
      $('navidromeSetupMessage').textContent = 'Server details saved on this device. Enter your password to connect.';
    }
  } catch (_) {}
})();