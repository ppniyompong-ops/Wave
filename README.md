# Wave — Personal Music Library

Wave is a browser-based music player with a private local library and an optional Navidrome connection.

## Local library
- Add audio files from your device and play them in Wave.
- Tracks and audio files are stored in this browser's IndexedDB database.
- Favorites, search, backup, and restore apply to the local library.
- Local music is not uploaded to Wave or synchronized between devices.

## Navidrome
- Connect to a Navidrome server using its Subsonic-compatible API.
- Search the server's music collection, view track metadata and cover art, and stream tracks through the Wave player.
- Wave does not provide a hosted music catalog or a Navidrome server. You must have access to a running Navidrome instance that contains your music.
- The Navidrome server must be reachable from the browser over HTTPS (localhost is allowed for local development). Navidrome enables CORS for its API; a reverse proxy in front of it must preserve the CORS response headers.
- Wave stores the server URL and username in this browser. The password is not saved; it remains in memory for the current page session and is used to create Subsonic token-authenticated requests.

## Hosting and privacy
- The Wave website is deployed as a static site. It does not upload or store your music on Render.
- Navidrome data and music files remain on the Navidrome server you configure.
- Browser storage is specific to the device and browser. Back up your local library before clearing site data.

## Playback
Background playback and operating-system media controls depend on browser and device support.