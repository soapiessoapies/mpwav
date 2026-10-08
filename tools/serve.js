// A tiny no-cache static server for testing: `npm run serve`, then open
// http://localhost:5173 (or the LAN address it prints, from a phone on the
// same Wi-Fi). No caching, so every reload gets the latest code.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.env.PORT) || 5173;
const TYPES = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml", ".png": "image/png",
  ".ico": "image/x-icon", ".wav": "audio/wav", ".ogg": "audio/ogg", ".mp3": "audio/mpeg",
};

http.createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const file = path.join(ROOT, url.endsWith("/") ? url + "index.html" : url);
  if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end("Not found"); return; }
    res.writeHead(200, {
      "Content-Type": TYPES[path.extname(file)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(data);
  });
}).listen(PORT, () => {
  console.log(`mpwav: http://localhost:${PORT}`);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list) if (a.family === "IPv4" && !a.internal) console.log(`  on your network: http://${a.address}:${PORT}`);
  }
});
