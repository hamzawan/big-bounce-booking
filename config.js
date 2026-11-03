// Deployment config. On localhost the pages talk to the backend directly
// (its CORS allows 127.0.0.1:5502). Anywhere else (e.g. Vercel) they use their
// own origin; vercel.json proxies /api and /media to the backend, so the
// browser makes same-origin requests and CORS does not apply.
if (!/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
  window.PAYMENT_API_BASE = "";
}
