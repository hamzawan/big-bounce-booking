// Dependency-free static file server for local development.
// Usage: node server.js   (PORT env var, default 5502)
const http = require("http"), fs = require("fs"), path = require("path");
const PORT = process.env.PORT || 5502;
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg",
  ".svg": "image/svg+xml", ".ico": "image/x-icon" };
http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p === "/") p = "/events.html";
  const file = path.normalize(path.join(__dirname, p));
  if (!file.startsWith(__dirname + path.sep) || file.includes(path.sep + "node_modules")) { res.writeHead(403); return res.end("Forbidden"); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end("Not found"); }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(data);
  });
}).listen(PORT, () => console.log("big-bounce-frontend on http://localhost:" + PORT));
