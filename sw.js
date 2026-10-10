// The service worker that lets mpwav install as an app and open
// offline. Network first: online, every file comes fresh (so a new push
// shows up on the next load) and the copy in the cache is refreshed;
// offline, the cached copy is used. SHELL is every file the app needs to
// start; a test checks it lists everything index.html loads.
const CACHE = "mpwav-v1";
const SHELL = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "styles/main.css",
  "styles/look.css",
  "assets/fonts/nunito-latin.woff2",
  "assets/fonts/pixelify-sans-latin.woff2",
  "assets/fonts/caveat-brush-latin.woff2",
  "assets/icons/icon.svg",
  "assets/icons/favicon-32.png",
  "assets/icons/apple-touch-icon.png",
  "assets/icons/icon-192.png",
  "assets/icons/icon-512.png",
  "assets/icons/maskable-512.png",
  "src/version.js",
  "src/ui/fill.js",
  "src/audio/notes.js",
  "src/audio/params.js",
  "src/audio/envelope.js",
  "src/audio/voices.js",
  "src/audio/engine.js",
  "src/audio/synth.js",
  "src/audio/mixer.js",
  "src/audio/transport.js",
  "src/audio/morph.js",
  "src/audio/wav.js",
  "src/audio/drums.js",
  "src/audio/render.js",
  "src/state/presets.js",
  "src/state/song.js",
  "src/state/history.js",
  "src/state/library.js",
  "src/state/samples.js",
  "src/state/song-files.js",
  "src/state/share-link.js",
  "src/ui/announce.js",
  "src/ui/controls.js",
  "src/ui/keyboard.js",
  "src/ui/chords.js",
  "src/ui/midi.js",
  "src/ui/meter.js",
  "src/ui/mixer-view.js",
  "src/ui/colors.js",
  "src/ui/piano-roll.js",
  "src/ui/zoombar.js",
  "src/ui/timeline.js",
  "src/ui/tabs.js",
  "src/ui/morph-pad.js",
  "src/ui/arrange.js",
  "src/ui/install.js",
  "src/ui/tour.js",
  "src/ui/app.js",
];

self.addEventListener("install", (e) => {
  // cache: "reload" skips the browser's HTTP cache, so the shell is current.
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: "reload" }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Offline or a very slow connection: the cached copy (query strings
// ignored), and the app page for any navigation.
const fromCache = (req) => caches.match(req, { ignoreSearch: true })
  .then((hit) => hit || (req.mode === "navigate" ? caches.match("index.html") : undefined));

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  const net = fetch(req).then((res) => {
    if (res.ok) {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy));
    }
    return res;
  });
  e.waitUntil(net.catch(() => {})); // keeps refreshing the cache after a slow answer
  // A slow network gets 3 s; then the cached copy is used if there is one.
  const slow = new Promise((ok) => setTimeout(ok, 3000)).then(() => fromCache(req)).then((hit) => hit || net);
  e.respondWith(
    Promise.race([net, slow])
      .catch(() => fromCache(req))
      .then((res) => res || Response.error()),
  );
});
