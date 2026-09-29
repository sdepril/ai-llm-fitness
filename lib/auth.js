// Costra tools — shared password auth (identical copy lives in each app; no dependencies).
//
// Users:    AUTH_USERS = "email:salt:hash:expires,email:salt:hash:expires"   (make entries with public/setup.html in the browser, or scripts/hash-password.js)
//           expires = YYYY-MM-DD; after that date the password is refused → rotate by generating a new entry.
// Sessions: AUTH_SECRET = long random string, the SAME in every Costra app → one login works across apps.
//           AUTH_SESSION_DAYS (default 30). Rotating AUTH_SECRET logs everyone out at once.
import { pbkdf2Sync, timingSafeEqual, createHmac, randomBytes } from "node:crypto";

export const PBKDF2_ITER = 600000; // OWASP 2023 for PBKDF2-HMAC-SHA256; same constant in public/setup.html

const b64u = (buf) => Buffer.from(buf).toString("base64url");
const fromB64u = (s) => Buffer.from(s, "base64url");

export function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  return { salt, hash: pbkdf2Sync(password.normalize("NFKC"), salt, PBKDF2_ITER, 32, "sha256").toString("hex") };
}

export function parseUsers(env = process.env.AUTH_USERS || "") {
  return env.split(",").map((e) => e.trim()).filter(Boolean).map((e) => {
    const [email, salt, hash, expires] = e.split(":");
    return { email: (email || "").toLowerCase(), salt, hash, expires: expires || null };
  }).filter((u) => u.email && u.salt && u.hash);
}

export function verifyPassword(email, password) {
  const u = parseUsers().find((x) => x.email === String(email || "").toLowerCase());
  if (!u) return { ok: false, reason: "unknown user" };
  const { hash } = hashPassword(password || "", u.salt);
  const a = Buffer.from(hash, "hex"), b = Buffer.from(u.hash, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: "wrong password" };
  if (u.expires && new Date(u.expires + "T23:59:59Z") < new Date()) return { ok: false, reason: "password expired — ask for a rotation", expired: true };
  return { ok: true, email: u.email, expires: u.expires };
}

export function signSession(email) {
  const secret = process.env.AUTH_SECRET; if (!secret) throw new Error("AUTH_SECRET not set");
  const days = +(process.env.AUTH_SESSION_DAYS || 30);
  const header = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64u(JSON.stringify({ sub: email, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + days * 86400, iss: "costra-tools" }));
  const sig = b64u(createHmac("sha256", secret).update(`${header}.${payload}`).digest());
  return `${header}.${payload}.${sig}`;
}

export function verifySession(token) {
  try {
    const secret = process.env.AUTH_SECRET; if (!secret || !token) return null;
    const [h, p, s] = String(token).split("."); if (!h || !p || !s) return null;
    const expect = createHmac("sha256", secret).update(`${h}.${p}`).digest();
    const got = fromB64u(s); if (got.length !== expect.length || !timingSafeEqual(got, expect)) return null;
    const payload = JSON.parse(fromB64u(p).toString("utf8"));
    if (payload.iss !== "costra-tools" || payload.exp < Date.now() / 1000) return null;
    // a user removed from AUTH_USERS loses access even with a valid session
    if (!parseUsers().some((u) => u.email === payload.sub)) return null;
    return { email: payload.sub, exp: payload.exp };
  } catch { return null; }
}

// Credential from a request: Bearer/?token= (a session JWT, or a machine token) — returns { session } | { token } | {}
export function credentialFrom(req) {
  const url = new URL(req.url);
  const auth = req.headers.get("authorization") || "";
  const given = url.searchParams.get("token") || (auth.startsWith("Bearer ") ? auth.slice(7) : "");
  if (!given) return {};
  const session = verifySession(given);
  return session ? { session, raw: given } : { token: given };
}

export function tokenMatches(given, ...expected) {
  if (!given) return false;
  const a = Buffer.from(given);
  return expected.filter(Boolean).some((e) => { const b = Buffer.from(e); return a.length === b.length && timingSafeEqual(a, b); });
}

export const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "private, no-store", ...extra } });

// Machine token only (the MCP endpoint used by the Claude connector): MCP_TOKEN.
export function authorized(req) {
  const c = credentialFrom(req);
  return tokenMatches(c.token || c.raw, process.env.MCP_TOKEN);
}
// Web app: a signed session (email + password) or the machine token.
export function authorizedUser(req) {
  const c = credentialFrom(req);
  return !!c.session || tokenMatches(c.token, process.env.MCP_TOKEN);
}
