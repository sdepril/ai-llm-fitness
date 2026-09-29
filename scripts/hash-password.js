#!/usr/bin/env node
// Make an AUTH_USERS entry:  node scripts/hash-password.js <email> [expires YYYY-MM-DD]
// Prompts for the password (hidden). Paste the printed entry into AUTH_USERS in Vercel (comma-separated for several users).
import { hashPassword } from "../lib/auth.js";
import readline from "node:readline";

const email = (process.argv[2] || "").toLowerCase();
const expires = process.argv[3] || (() => { const d = new Date(); d.setDate(d.getDate() + 90); return d.toISOString().slice(0, 10); })();
if (!email.includes("@")) { console.error("Usage: node scripts/hash-password.js <email> [expires YYYY-MM-DD]"); process.exit(1); }

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
rl.stdoutMuted = true;
rl._writeToOutput = function (s) { if (!rl.stdoutMuted || /Password/.test(s)) process.stdout.write(s); };
rl.question("Password (min 12 chars, hidden): ", (pw) => {
  rl.close(); process.stdout.write("\n");
  if ((pw || "").length < 12) { console.error("Too short — use at least 12 characters."); process.exit(1); }
  const { salt, hash } = hashPassword(pw);
  console.log(`\nAUTH_USERS entry (expires ${expires}):\n${email}:${salt}:${hash}:${expires}\n`);
});
