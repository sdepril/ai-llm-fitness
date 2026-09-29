// Artificial Analysis (free tier) client + MCP tool logic.
// Free tier: 100 requests / 24h → aggressive in-memory caching.

const BASE = "https://artificialanalysis.ai/api/v2";
const TTL_MS = 6 * 60 * 60 * 1000; // 6h
const ATTRIBUTION = "Data: Artificial Analysis (https://artificialanalysis.ai)";

const cache = new Map(); // path -> { at, data }
let lastRateLimit = null;

export function _resetCache() { cache.clear(); lastRateLimit = null; }

async function aaGet(path, fetchImpl = fetch) {
  const hit = cache.get(path);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data;

  const key = process.env.AA_API_KEY;
  if (!key) throw new Error("AA_API_KEY is niet ingesteld op de server (Vercel env var).");

  const res = await fetchImpl(BASE + path, { headers: { "x-api-key": key } });
  lastRateLimit = {
    limit: res.headers.get("x-ratelimit-limit"),
    remaining: res.headers.get("x-ratelimit-remaining"),
    reset: res.headers.get("x-ratelimit-reset"),
  };
  if (!res.ok) {
    // Serve stale cache rather than failing when rate-limited
    if (hit && (res.status === 429 || res.status >= 500)) return hit.data;
    const body = await res.text().catch(() => "");
    throw new Error(`Artificial Analysis API ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  cache.set(path, { at: Date.now(), data });
  return data;
}

export async function getModels(fetchImpl = fetch) {
  return (await allLlms(fetchImpl)).map(flat);
}

async function allLlms(fetchImpl) {
  const out = [];
  for (let page = 1; page <= 10; page++) {
    const r = await aaGet(`/language/models/free?page=${page}`, fetchImpl);
    out.push(...(r.data || []));
    if (!r.pagination?.has_more) break;
  }
  return out;
}

const r2 = (x, d = 2) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d);

function flat(m) {
  const p = m.pricing || {};
  const pin = p.price_1m_input_tokens, pout = p.price_1m_output_tokens;
  const blended = pin != null && pout != null ? (3 * pin + pout) / 4 : null;
  const ii = m.evaluations?.artificial_analysis_intelligence_index ?? null;
  return {
    name: m.name,
    slug: m.slug,
    creator: m.model_creator?.name ?? null,
    release_date: m.release_date ?? null,
    intelligence_index: ii,
    coding_index: m.evaluations?.artificial_analysis_coding_index ?? null,
    agentic_index: m.evaluations?.artificial_analysis_agentic_index ?? null,
    usd_per_1m_input: pin ?? null,
    usd_per_1m_output: pout ?? null,
    usd_per_1m_cache_hit: p.price_1m_cache_hit_tokens ?? null,
    usd_per_1m_cache_write: p.price_1m_cache_write_tokens ?? null,
    usd_per_1m_blended_3to1: r2(blended, 3),
    cost_to_run_intelligence_index_usd: m.artificial_analysis_intelligence_index_cost?.total_cost ?? null,
    cost_per_task_usd: m.artificial_analysis_intelligence_index_cost?.cost_per_task?.total_cost ?? null,
    intelligence_per_dollar_of_index_run:
      ii != null && m.artificial_analysis_intelligence_index_cost?.total_cost
        ? r2(ii / m.artificial_analysis_intelligence_index_cost.total_cost, 3) : null,
    output_tokens_per_sec: r2(m.performance?.median_output_tokens_per_second, 1),
    ttft_sec: r2(m.performance?.median_time_to_first_token_seconds),
    time_to_first_answer_token_sec: r2(m.performance?.median_time_to_first_answer_token_seconds),
    end_to_end_sec_500_tokens: r2(m.performance?.median_end_to_end_response_time_seconds),
  };
}

const SORTS = {
  intelligence: ["intelligence_index", "desc"],
  coding: ["coding_index", "desc"],
  agentic: ["agentic_index", "desc"],
  price_input: ["usd_per_1m_input", "asc"],
  price_output: ["usd_per_1m_output", "asc"],
  price_blended: ["usd_per_1m_blended_3to1", "asc"],
  speed: ["output_tokens_per_sec", "desc"],
  ttft: ["ttft_sec", "asc"],
  release_date: ["release_date", "desc"],
  value: ["intelligence_per_dollar_of_index_run", "desc"],
  cost_per_task: ["cost_per_task_usd", "asc"],
};

function match(m, q) {
  if (!q) return true;
  const s = q.toLowerCase();
  return [m.name, m.slug, m.creator].some((v) => v && v.toLowerCase().includes(s));
}

function findModel(models, ref) {
  const s = String(ref).toLowerCase();
  return models.find((m) => m.slug?.toLowerCase() === s)
    || models.find((m) => m.name?.toLowerCase() === s)
    || models.find((m) => m.slug?.toLowerCase().includes(s) || m.name?.toLowerCase().includes(s));
}

const MEDIA = {
  "text-to-image": "/media/text-to-image/models/free",
  "image-editing": "/media/image-editing/models/free",
  "text-to-video": "/media/text-to-video/models/free",
  "image-to-video": "/media/image-to-video/models/free",
  "text-to-video-audio": "/media/text-to-video-audio/models/free",
  "image-to-video-audio": "/media/image-to-video-audio/models/free",
  "text-to-speech": "/media/text-to-speech/models/free",
  "speech-to-speech": "/media/speech-to-speech/models/free",
  "speech-to-text": "/media/speech-to-text/models/free",
  "music-instrumental": "/media/music/instrumental/models/free",
  "music-with-vocals": "/media/music/with-vocals/models/free",
};

export const TOOLS = [
  {
    name: "list_llms",
    description:
      "List/rank language models from Artificial Analysis (free tier): intelligence/coding/agentic indices, USD price per 1M tokens (input, output, cache, blended 3:1), cost to run the AA Intelligence Index, and median speed/latency. Filter by creator or name, sort by a metric. Use for 'cheapest model above X intelligence', 'fastest Anthropic model', 'best value' questions.",
    inputSchema: {
      type: "object",
      properties: {
        search: { type: "string", description: "Substring on model name, slug or creator (e.g. 'anthropic', 'gpt', 'llama')." },
        creator: { type: "string", description: "Filter on creator name (substring, e.g. 'OpenAI')." },
        sort_by: { type: "string", enum: Object.keys(SORTS), default: "intelligence" },
        min_intelligence: { type: "number", description: "Only models with intelligence index >= this." },
        max_price_blended: { type: "number", description: "Only models with blended (3:1) USD/1M tokens <= this." },
        released_after: { type: "string", description: "ISO date, e.g. 2026-01-01." },
        limit: { type: "integer", default: 20, minimum: 1, maximum: 100 },
      },
    },
  },
  {
    name: "get_llm",
    description: "Get all free-tier data for one language model by slug or name (fuzzy match).",
    inputSchema: { type: "object", properties: { model: { type: "string" } }, required: ["model"] },
  },
  {
    name: "compare_llms",
    description: "Side-by-side comparison of 2-10 language models (slugs or names).",
    inputSchema: {
      type: "object",
      properties: { models: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 10 } },
      required: ["models"],
    },
  },
  {
    name: "estimate_llm_cost",
    description:
      "FinOps cost estimate: price a token workload (input/output/cache-hit tokens per month) across one or more models using Artificial Analysis list prices (USD). Returns monthly cost per model, sorted cheapest first. List prices only — excludes discounts, batch pricing, commitments and provider markups.",
    inputSchema: {
      type: "object",
      properties: {
        models: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 20 },
        input_tokens: { type: "number", description: "Uncached input tokens per month." },
        output_tokens: { type: "number", description: "Output tokens per month (incl. reasoning tokens)." },
        cache_hit_tokens: { type: "number", default: 0, description: "Cached input tokens per month." },
      },
      required: ["models", "input_tokens", "output_tokens"],
    },
  },
  {
    name: "list_media_models",
    description: "Arena Elo rankings (free tier) for image, video, speech and music models.",
    inputSchema: {
      type: "object",
      properties: {
        modality: { type: "string", enum: Object.keys(MEDIA) },
        limit: { type: "integer", default: 20, minimum: 1, maximum: 100 },
      },
      required: ["modality"],
    },
  },
  {
    name: "api_status",
    description: "Show Artificial Analysis rate-limit status (free tier: 100 requests/24h) and cache state of this server.",
    inputSchema: { type: "object", properties: {} },
  },
];

function wrap(obj) {
  return { attribution: ATTRIBUTION, ...obj };
}

export async function callTool(name, args = {}, fetchImpl = fetch) {
  switch (name) {
    case "list_llms": {
      const all = (await allLlms(fetchImpl)).map(flat);
      const [field, dir] = SORTS[args.sort_by || "intelligence"] || SORTS.intelligence;
      let rows = all.filter((m) => match(m, args.search))
        .filter((m) => !args.creator || (m.creator || "").toLowerCase().includes(args.creator.toLowerCase()))
        .filter((m) => args.min_intelligence == null || (m.intelligence_index ?? -1) >= args.min_intelligence)
        .filter((m) => args.max_price_blended == null || (m.usd_per_1m_blended_3to1 != null && m.usd_per_1m_blended_3to1 <= args.max_price_blended))
        .filter((m) => !args.released_after || (m.release_date && m.release_date >= args.released_after));
      rows = rows.filter((m) => m[field] != null).concat(rows.filter((m) => m[field] == null));
      rows.sort((a, b) => {
        if (a[field] == null || b[field] == null) return 0;
        return dir === "asc" ? (a[field] > b[field] ? 1 : -1) : (a[field] < b[field] ? 1 : -1);
      });
      return wrap({ total_matches: rows.length, sorted_by: field, models: rows.slice(0, args.limit || 20) });
    }
    case "get_llm": {
      const all = (await allLlms(fetchImpl)).map(flat);
      const m = findModel(all, args.model);
      if (!m) return wrap({ error: `Geen model gevonden voor '${args.model}'. Probeer list_llms met search.` });
      return wrap({ model: m });
    }
    case "compare_llms": {
      const all = (await allLlms(fetchImpl)).map(flat);
      const found = [], missing = [];
      for (const ref of args.models || []) { const m = findModel(all, ref); m ? found.push(m) : missing.push(ref); }
      return wrap({ models: found, not_found: missing });
    }
    case "estimate_llm_cost": {
      const all = (await allLlms(fetchImpl)).map(flat);
      const inT = args.input_tokens || 0, outT = args.output_tokens || 0, cT = args.cache_hit_tokens || 0;
      const rows = [], missing = [];
      for (const ref of args.models || []) {
        const m = findModel(all, ref);
        if (!m) { missing.push(ref); continue; }
        const cacheRate = m.usd_per_1m_cache_hit ?? m.usd_per_1m_input;
        const input = (inT / 1e6) * (m.usd_per_1m_input ?? 0);
        const output = (outT / 1e6) * (m.usd_per_1m_output ?? 0);
        const cache = (cT / 1e6) * (cacheRate ?? 0);
        rows.push({
          model: m.name, slug: m.slug, intelligence_index: m.intelligence_index,
          usd_input: r2(input), usd_output: r2(output), usd_cache_hit: r2(cache),
          usd_total_per_month: r2(input + output + cache),
          price_missing: m.usd_per_1m_input == null || m.usd_per_1m_output == null,
        });
      }
      rows.sort((a, b) => a.usd_total_per_month - b.usd_total_per_month);
      return wrap({
        workload: { input_tokens: inT, output_tokens: outT, cache_hit_tokens: cT },
        note: "List prices (USD). Excludes batch/commitment discounts, provider markups and taxes.",
        estimates: rows, not_found: missing,
      });
    }
    case "list_media_models": {
      const path = MEDIA[args.modality];
      if (!path) throw new Error(`Onbekende modality: ${args.modality}`);
      const r = await aaGet(path, fetchImpl);
      const rows = (r.data || []).map((m) => ({
        name: m.name, slug: m.slug ?? null, creator: m.model_creator?.name ?? null,
        ...(m.elo != null ? { elo: m.elo, ci_95: m.ci_95 ?? null } : {}),
        ...(m.aa_wer_index !== undefined ? { aa_wer_index: m.aa_wer_index } : {}),
        ...(m.bba_score !== undefined ? { bba_score: m.bba_score, fdb_score: m.fdb_score, tau_voice_score: m.tau_voice_score } : {}),
      }));
      if (rows.length && rows[0].elo != null) rows.sort((a, b) => (b.elo ?? 0) - (a.elo ?? 0));
      return wrap({ modality: args.modality, models: rows.slice(0, args.limit || 20) });
    }
    case "api_status": {
      return wrap({
        rate_limit: lastRateLimit || "Nog geen call gedaan sinds deze instance startte.",
        cache_ttl_hours: TTL_MS / 3600000,
        cached_paths: [...cache.entries()].map(([p, v]) => ({ path: p, age_min: Math.round((Date.now() - v.at) / 60000) })),
      });
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
