// Deployment config. On localhost the pages talk to the backend directly
// (its CORS allows 127.0.0.1:5502). Anywhere else (e.g. Vercel) they use their
// own origin; vercel.json proxies /api and /media to the backend, so the
// browser makes same-origin requests and CORS does not apply.
if (!/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
  window.PAYMENT_API_BASE = "";
}

// Address of the "Acknowledgement, Waiver and Release from Liability" document.
// When set, the waiver text on the booking page links to it.
window.WAIVER_URL = window.WAIVER_URL ||
  "https://www.thebigbounceamerica.com/wp-content/uploads/2023/06/waiver-usa.pdf";
