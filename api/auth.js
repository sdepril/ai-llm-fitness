// POST /api/auth  {email, password}  → { session, email, expires }     (login)
// GET  /api/auth  (Bearer session)   → { email, exp }                   (who am I)
import { verifyPassword, signSession, credentialFrom, parseUsers, json } from "../lib/auth.js";

const attempts = new Map(); // ip → { n, at }  — crude brute-force brake per instance
function throttled(ip) {
  const now = Date.now(), a = attempts.get(ip) || { n: 0, at: now };
  if (now - a.at > 15 * 60 * 1000) { a.n = 0; a.at = now; }
  attempts.set(ip, a);
  return a.n >= 10;
}

export async function POST(req) {
  const ip = req.headers.get("x-forwarded-for") || "?";
  if (throttled(ip)) return json({ error: "Too many attempts — try again in 15 minutes." }, 429);
  let body; try { body = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
  const r = verifyPassword(body.email, body.password);
  if (!r.ok) { const a = attempts.get(ip); a.n++; return json({ error: r.expired ? r.reason : "Invalid email or password." }, 401); }
  attempts.delete(ip);
  try { return json({ session: signSession(r.email), email: r.email, expires: r.expires }); }
  catch (e) { return json({ error: "Server not configured: " + e.message }, 500); }
}

export async function GET(req) {
  const c = credentialFrom(req);
  // unauthenticated: a harmless config check (is the server set up?) so a failing login can be diagnosed
  if (!c.session) return json({ error: "unauthorized", configured: { users: parseUsers().length, secret: !!process.env.AUTH_SECRET } }, 401);
  return json({ email: c.session.email, exp: c.session.exp });
}
