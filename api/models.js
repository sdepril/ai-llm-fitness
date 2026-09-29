// Model data for the app (session- or token-protected, server-side key).
import { authorizedUser } from "../lib/auth.js";
import { getModels } from "../lib/aa.js";

export async function GET(req) {
  const headers = { "content-type": "application/json", "cache-control": "private, no-store" };
  if (!authorizedUser(req)) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers });
  try {
    const models = await getModels();
    return new Response(JSON.stringify({ attribution: "Data: Artificial Analysis (https://artificialanalysis.ai)", fetched_at: new Date().toISOString(), models }), { headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e.message || e) }), { status: 502, headers });
  }
}
