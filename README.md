# big-bounce-frontend
Static booking + Stripe payment frontend (copied from ts-frontend). No build step, no npm deps.

Run: `npm start` (or `node server.js`) -> http://127.0.0.1:5502/events.html (use 127.0.0.1, not localhost: the backend CORS allows 127.0.0.1:5502/5500 and localhost:3000)
Tests: `npm test`

Flow: events.html -> booking.html?event_id=<uuid> -> stripe_payment.html?booking_id=<uuid>
index.html is the organizer/ticket page.

Config (no env vars): the backend defaults to https://146.190.141.95. Override per page with `?api=https://host`
(passed along between pages), or set `window.PAYMENT_API_BASE` in a script loaded before the page script.
The Stripe publishable key is returned by the backend's /api/v1/payments/stripe/intent/; none is stored here.
Add-on listing needs an organizer token, prompted at runtime (sessionStorage).
