import { test } from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword, signSession, verifySession, credentialFrom, tokenMatches } from "../lib/auth.js";

const { salt, hash } = hashPassword("correct horse battery");
process.env.AUTH_SECRET = "test-secret-please-rotate";
process.env.AUTH_USERS = `Stijn@costra.io:${salt}:${hash}:2099-01-01, old@costra.io:${salt}:${hash}:2020-01-01`;

test("password verify: ok / wrong / unknown / expired", () => {
  assert.equal(verifyPassword("stijn@costra.io", "correct horse battery").ok, true);
  assert.equal(verifyPassword("stijn@costra.io", "wrong").ok, false);
  assert.equal(verifyPassword("nobody@costra.io", "correct horse battery").ok, false);
  const r = verifyPassword("old@costra.io", "correct horse battery");
  assert.equal(r.ok, false); assert.equal(r.expired, true);
});

test("session round-trip, tamper, removed user", () => {
  const s = signSession("stijn@costra.io");
  assert.equal(verifySession(s).email, "stijn@costra.io");
  assert.equal(verifySession(s.slice(0, -2) + "xx"), null);
  const keep = process.env.AUTH_USERS; process.env.AUTH_USERS = "";
  assert.equal(verifySession(s), null); process.env.AUTH_USERS = keep;
});

test("credentialFrom distinguishes session from machine token", () => {
  const s = signSession("stijn@costra.io");
  const req = (h, u = "https://x.test/api/models") => ({ url: u, headers: new Headers(h) });
  assert.ok(credentialFrom(req({ authorization: "Bearer " + s })).session);
  assert.equal(credentialFrom(req({ authorization: "Bearer abc" })).token, "abc");
  assert.equal(credentialFrom(req({}, "https://x.test/api/models?token=abc")).token, "abc");
  assert.deepEqual(credentialFrom(req({})), {});
  assert.equal(tokenMatches("abc", undefined, "abc"), true);
  assert.equal(tokenMatches("abd", "abc"), false);
});
