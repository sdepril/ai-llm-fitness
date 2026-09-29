// Minimal stateless MCP server (Streamable HTTP, JSON responses) for Vercel.
import { authorized } from "../lib/auth.js";
import { TOOLS, callTool } from "../lib/aa.js";

const SERVER_INFO = { name: "artificial-analysis", version: "1.0.0" };
const SUPPORTED = ["2025-06-18", "2025-03-26", "2024-11-05"];
const INSTRUCTIONS =
  "Independent AI model benchmarks, pricing (USD per 1M tokens) and speed from Artificial Analysis (free tier, cached 6h, max 100 upstream calls/day). Always credit Artificial Analysis as the source when presenting this data.";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const rpcError = (id, code, message) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

async function handle(msg) {
  const { id, method, params } = msg || {};
  if (id === undefined || id === null) return null; // notification → no response
  switch (method) {
    case "initialize": {
      const v = params?.protocolVersion;
      return {
        jsonrpc: "2.0", id,
        result: {
          protocolVersion: SUPPORTED.includes(v) ? v : SUPPORTED[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions: INSTRUCTIONS,
        },
      };
    }
    case "ping":
      return { jsonrpc: "2.0", id, result: {} };
    case "tools/list":
      return { jsonrpc: "2.0", id, result: { tools: TOOLS } };
    case "tools/call": {
      const tool = TOOLS.find((t) => t.name === params?.name);
      if (!tool) return rpcError(id, -32602, `Unknown tool: ${params?.name}`);
      try {
        const out = await callTool(params.name, params.arguments || {});
        return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(out) }] } };
      } catch (e) {
        return { jsonrpc: "2.0", id, result: { isError: true, content: [{ type: "text", text: String(e.message || e) }] } };
      }
    }
    default:
      return rpcError(id, -32601, `Method not found: ${method}`);
  }
}

export async function POST(req) {
  if (!authorized(req)) return json({ error: "unauthorized" }, 401);
  let body;
  try { body = await req.json(); } catch { return json(rpcError(null, -32700, "Parse error"), 400); }
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map(handle))).filter(Boolean);
    return out.length ? json(out) : new Response(null, { status: 202 });
  }
  const out = await handle(body);
  return out ? json(out) : new Response(null, { status: 202 });
}

// No server-initiated SSE stream; stateless server.
export function GET() { return new Response("Method Not Allowed", { status: 405, headers: { allow: "POST" } }); }
export function DELETE() { return new Response("Method Not Allowed", { status: 405, headers: { allow: "POST" } }); }
