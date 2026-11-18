(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const audio = $('audio');
  let db;
  let tracks = [];
  let current = -1;
  let view = 'all';
  let busy = false;

  const paths = {
    play: '<path d="m8 5 11 7-11 7z"/>',
    pause: '<path d="M8 5h3v14H8zM15 5h3v14h-3z"/>',
    prev: '<path d="M6 5v14M19 6l-9 6 9 6z"/>',
    next: '<path d="M18 5v14M5 6l9 6-9 6z"/>',
    heart: '<path d="M20.8 8.7c0 5.1-8.8 10-8.8 10S3.2 13.8 3.2 8.7A4.2 4.2 0 0 1 11 6.4l1 1 1-1a4.2 4.2 0 0 1 7.8 2.3Z"/>',
    trash: '<path d="M4 7h16M10 11v6m4-6v6M6 7l1 14h10l1-14M9 7V4h6v3"/>',
    library: '<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H20v15H5.5A1.5 1.5 0 0 1 4 17.5zM4 7h16M8 4v15"/>',
    music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
    plus: '<path d="M12 5v14M5 12h14"/>'
  };

  const icon = (name, size) => '<svg aria-hidden="true" width="' + (size || 18) + '" height="' + (size || 18) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + (paths[name] || '') + '</svg>';
  const formatTime = value => Number.isFinite(value) ? Math.floor(value / 60) + ':' + String(Math.floor(value % 60)).padStart(2, '0') : '0:00';
  const escapeHTML = value => String(value || '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

  function notify(message) {
    const notice = $('notice');
    notice.textContent = message;
    notice.classList.add('show');
    clearTimeout(notify.timer);
    notify.timer = setTimeout(() => notice.classList.remove('show'), 2600);
  }

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('wave-personal', 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('tracks')) {
          request.result.createObjectStore('tracks', { keyPath: 'id', autoIncrement: true });
        }
      };
      request.onsuccess = () => { db = request.result; resolve(); };
      request.onerror = () => reject(request.error);
    });
  }

  function saveTrack(track) {
    return new Promise((resolve, reject) => {
      const request = db.transaction('tracks', 'readwrite').objectStore('tracks').put(track);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function getAllTracks() {
    return new Promise((resolve, reject) => {
      const request = db.transaction('tracks').objectStore('tracks').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function updateMediaSession() {
    if (!('mediaSession' in navigator)) return;
    const track = tracks[current];
    if (!track) {
      navigator.mediaSession.metadata = null;
      return;
    }
    if ('MediaMetadata' in window) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.name,
        artist: track.artist || 'Unknown artist',
        album: 'Wave Music Library'
      });
    }
    navigator.mediaSession.playbackState = audio.paused ? 'paused' : 'playing';
    if (Number.isFinite(audio.duration) && audio.duration > 0 && 'setPositionState' in navigator.mediaSession) {
      try {
        navigator.mediaSession.setPositionState({
          duration: audio.duration,
          playbackRate: audio.playbackRate,
          position: Math.min(audio.currentTime, audio.duration)
        });
      } catch (_) {}
    }
  }

  function updatePlayer() {
    const track = tracks[current];
    $('song').textContent = track ? track.name : 'No track selected';
    $('artist').textContent = track ? (track.artist || 'Unknown artist') : 'Choose a track to start listening';
    $('play').innerHTML = icon(audio.paused ? 'play' : 'pause', 17);
    $('play').setAttribute('aria-label', audio.paused ? 'Play' : 'Pause');
    updateMediaSession();
  }

  if ('mediaSession' in navigator) {
    const mediaActions = {
      play: () => audio.play().catch(() => {}),
      pause: () => audio.pause(),
      previoustrack: () => { if (tracks.length) selectTrack((current - 1 + tracks.length) % tracks.length); },
      nexttrack: () => { if (tracks.length) selectTrack((current + 1) % tracks.length); },
      seekbackward: details => { audio.currentTime = Math.max(0, audio.currentTime - (details.seekOffset || 10)); },
      seekforward: details => { audio.currentTime = Math.min(audio.duration || Infinity, audio.currentTime + (details.seekOffset || 10)); },
      seekto: details => { if (Number.isFinite(details.seekTime)) audio.currentTime = details.seekTime; }
    };
    Object.entries(mediaActions).forEach(([action, handler]) => {
      try { navigator.mediaSession.setActionHandler(action, handler); } catch (_) {}
    });
  }

  function render() {
    const query = $('search').value.trim().toLowerCase();
    const list = tracks
      .map((track, index) => ({ ...track, index }))
      .filter(track => (view !== 'fav' || track.favorite) &&
        (track.name + ' ' + (track.artist || '')).toLowerCase().includes(query));

    $('heading').textContent = view === 'fav' ? 'Favorites' : 'Your Library';
    $('libraryTab').classList.toggle('active', view === 'all');
    $('favTab').classList.toggle('active', view === 'fav');
    $('libraryTab').setAttribute('aria-pressed', String(view === 'all'));
    $('favTab').setAttribute('aria-pressed', String(view === 'fav'));

    if (list.length) {
      $('tracks').innerHTML = list.map(track =>
        '<article class="track ' + (track.index === current ? 'current' : '') + '">' +
          '<span class="track-index">' + String(track.index + 1).padStart(2, '0') + '</span>' +
          '<div class="meta"><strong>' + escapeHTML(track.name) + '</strong><small>' + escapeHTML(track.artist || 'Unknown artist') + '</small></div>' +
          '<button class="icon-btn" type="button" data-play="' + track.index + '" aria-label="Play ' + escapeHTML(track.name) + '">' + icon(track.index === current && !audio.paused ? 'pause' : 'play') + '</button>' +
          '<button class="icon-btn favorite ' + (track.favorite ? 'selected' : '') + '" type="button" data-fav="' + track.id + '" aria-label="' + (track.favorite ? 'Remove from favorites' : 'Add to favorites') + '">' + icon('heart') + '</button>' +
          '<button class="icon-btn remove" type="button" data-remove="' + track.id + '" aria-label="Remove ' + escapeHTML(track.name) + '">' + icon('trash') + '</button>' +
        '</article>'
      ).join('');
    } else {
      let title = 'Your library is empty';
      let description = 'Add audio files from this device to get started.';
      if (query) {
        title = 'No matches found';
        description = 'Try a different track title or artist.';
      } else if (view === 'fav') {
        title = 'No favorites yet';
        description = 'Use the heart icon on a track to save it here.';
      }
      $('tracks').innerHTML =
        '<div class="empty">' +
          '<span class="empty-icon">' + icon(view === 'fav' ? 'heart' : 'music', 24) + '</span>' +
          '<strong>' + title + '</strong>' +
          '<small>' + description + '</small>' +
          (!query && view === 'all' ? '<button class="empty-action" type="button" data-add-empty>' + icon('plus', 15) + 'Add music</button>' : '') +
        '</div>';
    }

    updatePlayer();
  }

  function selectTrack(index) {
    if (index < 0 || index >= tracks.length) return;
    current = index;
    audio.src = tracks[index].url;
    audio.load();
    render();
    audio.play().catch(() => notify('This audio file could not be played in your browser.'));
  }

  async function addFiles(files) {
    let count = 0;
    for (const file of files) {
      if (!file.type || !file.type.startsWith('audio/')) continue;
      const track = {
        name: file.name.replace(/\.[^.]+$/, ''),
        artist: '',
        type: file.type,
        blob: file,
        favorite: false
      };
      const request = db.transaction('tracks', 'readwrite').objectStore('tracks').add(track);
      const id = await new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      tracks.push({ ...track, id, url: URL.createObjectURL(file) });
      count++;
    }
    render();
    notify(count ? 'Added ' + count + (count === 1 ? ' track.' : ' tracks.') : 'No supported audio files were selected.');
  }

  $('tracks').addEventListener('click', async event => {
    const playButton = event.target.closest('[data-play]');
    const favoriteButton = event.target.closest('[data-fav]');
    const removeButton = event.target.closest('[data-remove]');
    const emptyAddButton = event.target.closest('[data-add-empty]');

    if (emptyAddButton) $('files').click();
    if (playButton) selectTrack(Number(playButton.dataset.play));

    if (favoriteButton) {
      const track = tracks.find(item => item.id === Number(favoriteButton.dataset.fav));
      if (track) {
        track.favorite = !track.favorite;
        await saveTrack({
          id: track.id,
          name: track.name,
          artist: track.artist,
          type: track.type,
          blob: track.blob,
          favorite: track.favorite
        });
        render();
      }
    }

    if (removeButton) {
      const id = Number(removeButton.dataset.remove);
      const index = tracks.findIndex(item => item.id === id);
      if (index >= 0 && window.confirm('Remove this track from your library?')) {
        await new Promise((resolve, reject) => {
          const request = db.transaction('tracks', 'readwrite').objectStore('tracks').delete(id);
          request.onsuccess = resolve;
          request.onerror = () => reject(request.error);
        });
        URL.revokeObjectURL(tracks[index].url);
        tracks.splice(index, 1);
        if (index === current) {
          audio.pause();
          audio.removeAttribute('src');
          current = -1;
        } else if (index < current) {
          current--;
        }
        render();
        notify('Track removed.');
      }
    }
  });

  $('add').onclick = () => $('files').click();
  $('files').onchange = async event => {
    try {
      await addFiles(Array.from(event.target.files));
    } catch (error) {
      notify('Could not add the selected music.');
    }
    event.target.value = '';
  };

  $('libraryTab').onclick = () => { view = 'all'; render(); };
  $('favTab').onclick = () => { view = 'fav'; render(); };
  $('search').oninput = render;

  $('play').onclick = () => {
    if (current < 0) {
      if (tracks.length) selectTrack(0);
      else notify('Add music to your library first.');
    } else if (audio.paused) {
      audio.play().catch(() => notify('Playback could not be started.'));
    } else {
      audio.pause();
    }
  };

  $('prev').onclick = () => {
    if (tracks.length) selectTrack((current - 1 + tracks.length) % tracks.length);
  };
  $('next').onclick = () => {
    if (tracks.length) selectTrack((current + 1) % tracks.length);
  };

  audio.onplay = () => { updatePlayer(); render(); };
  audio.onpause = () => { updatePlayer(); render(); };
  audio.onended = () => { if (tracks.length) selectTrack((current + 1) % tracks.length); };
  audio.ontimeupdate = () => {
    $('elapsed').textContent = formatTime(audio.currentTime);
    $('duration').textContent = formatTime(audio.duration);
    $('seek').value = audio.duration ? audio.currentTime / audio.duration * 1000 : 0;
  };
  $('seek').oninput = event => {
    if (audio.duration) audio.currentTime = Number(event.target.value) / 1000 * audio.duration;
  };
  $('volume').oninput = event => { audio.volume = Number(event.target.value); };
  audio.volume = 0.8;

  const blobToBase64 = blob => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

  $('backup').onclick = async () => {
    if (busy) return;
    busy = true;
    try {
      const data = {
        app: 'Wave',
        version: 1,
        tracks: await Promise.all(tracks.map(async track => ({
          name: track.name,
          artist: track.artist || '',
          type: track.type || 'audio/mpeg',
          favorite: !!track.favorite,
          audio: await blobToBase64(track.blob)
        })))
      };
      const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'wave-backup.json';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1200);
      notify('Library backup created.');
    } catch (error) {
      notify('Could not create a library backup.');
    } finally {
      busy = false;
    }
  };

  $('restore').onclick = () => $('backupFile').click();
  $('backupFile').onchange = async event => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (data.app !== 'Wave' || !Array.isArray(data.tracks)) throw new Error('Invalid backup');
      if (!window.confirm('Restoring this backup will replace all tracks in your library. Continue?')) return;

      audio.pause();
      audio.removeAttribute('src');
      tracks.forEach(track => URL.revokeObjectURL(track.url));
      await new Promise((resolve, reject) => {
        const request = db.transaction('tracks', 'readwrite').objectStore('tracks').clear();
        request.onsuccess = resolve;
        request.onerror = () => reject(request.error);
      });

      tracks = [];
      current = -1;
      for (const item of data.tracks) {
        const raw = atob(item.audio);
        const bytes = Uint8Array.from(raw, char => char.charCodeAt(0));
        const blob = new Blob([bytes], { type: item.type || 'audio/mpeg' });
        const track = {
          name: item.name || 'Untitled track',
          artist: item.artist || '',
          type: blob.type,
          blob,
          favorite: !!item.favorite
        };
        const request = db.transaction('tracks', 'readwrite').objectStore('tracks').add(track);
        const id = await new Promise((resolve, reject) => {
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        tracks.push({ ...track, id, url: URL.createObjectURL(blob) });
      }

      render();
      notify('Library restored successfully.');
    } catch (error) {
      notify('Could not restore this backup. Check that the file is valid.');
    } finally {
      event.target.value = '';
    }
  };

  (async () => {
    try {
      await openDatabase();
      tracks = (await getAllTracks()).map(track => ({ ...track, url: URL.createObjectURL(track.blob) }));
      render();
    } catch (error) {
      notify('Could not open your music library in this browser.');
    }
  })();
})();