// Server-side proxy for the backend API and media files.
// Vercel's edge cannot rewrite to a bare IP address (it answers NOT_FOUND), so
// vercel.json rewrites /api/* and /media/* to this function, which fetches the
// backend from the server side. Set BACKEND_URL in Vercel to override the default.
const BACKEND = (process.env.BACKEND_URL || "https://146.190.141.95").replace(/\/+$/, "");

const DROP_REQ = new Set(["host", "connection", "content-length", "transfer-encoding", "accept-encoding", "expect"]);
const DROP_RES = new Set(["content-encoding", "content-length", "transfer-encoding", "connection", "keep-alive"]);

module.exports = async (req, res) => {
  const url = new URL(req.url, "http://proxy.local");
  const target = url.searchParams.get("target") || "";
  url.searchParams.delete("target");
  if (!/^\/(api|media)\//.test(target)) {
    res.statusCode = 404;
    return res.end("Not found");
  }
  const qs = url.searchParams.toString();
  const dest = BACKEND + target + (qs ? "?" + qs : "");

  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (DROP_REQ.has(k) || k.startsWith("x-vercel-") || k.startsWith("x-forwarded-")) continue;
    headers[k] = v;
  }

  let body;
  if (req.method !== "GET" && req.method !== "HEAD") {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    body = Buffer.concat(chunks);
  }

  try {
    const upstream = await fetch(dest, { method: req.method, headers, body, redirect: "manual" });
    res.statusCode = upstream.status;
    upstream.headers.forEach((v, k) => { if (!DROP_RES.has(k)) res.setHeader(k, v); });
    res.end(Buffer.from(await upstream.arrayBuffer()));
  } catch (e) {
    res.statusCode = 502;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ code: "502", message: "Backend unreachable" }));
  }
};
