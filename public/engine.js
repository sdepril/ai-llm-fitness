// AI Use-Case Capture → BOM — deterministic engine (spec v0.1).
// Single source of truth: runs unchanged in the browser (ES module) and in Node (tests, CLI).
// No prices live here except what the caller passes in (model list from Artificial Analysis).

export const ARCHETYPES = {
  document: {
    label: "Document processing (extraction / summarisation)",
    unit: "document",
    bigT: "T(n)",
    fields: [
      { id: "docs_per_day", label: "Documents per day", type: "number", default: 200, help: 'How many documents flow through per working day. Drives every monthly number (× working days).' },
      { id: "pages", label: "Pages per document", type: "number", default: 12, help: 'Average length. Pages × words per page × tokens per word = input tokens per document — the biggest cost driver here.' },
      { id: "doc_type", label: "Document type", type: "select", options: ["prose", "legal", "form", "slides"], default: "legal", help: 'Sets the words-per-page default (prose 500, legal 600, form 250, slides 120). Override if you know your real density.' },
      { id: "language", label: "Language", type: "select", options: ["en", "nl", "fr", "de"], default: "nl", help: 'Tokenisers split Dutch/French/German heavier than English, so the same text costs more tokens. Verify the factor on your own documents.' },
      { id: "scanned", label: "Source is scanned (needs OCR)", type: "bool", default: false, help: 'Scanned PDFs need OCR (Document Intelligence) before the model sees text — adds a per-page cost line to the BOM.' },
      { id: "output_kind", label: "Output", type: "select", options: ["extraction", "summary", "both"], default: "extraction", help: 'What comes out: structured fields (short, cheap output), a summary (longer output), or both.' },
      { id: "fields", label: "Fields to extract", type: "number", default: 25, showIf: { output_kind: ["extraction", "both"], help: 'Number of fields in the JSON you extract. Each field ≈ 15 output tokens (key + value + syntax).' } },
      { id: "summary_words", label: "Summary length (words)", type: "number", default: 300, showIf: { output_kind: ["summary", "both"], help: 'Target length of the summary. Output tokens are usually 3–5× the price of input tokens — keep summaries short on purpose.' } },
      { id: "system_tokens", label: "Prompt overhead S (tokens)", type: "number", default: 600, help: 'Instructions, schema and examples sent with every request. Stable across requests, so it is the cacheable part.' },
      { id: "batch", label: "Batch processing allowed (SLA > 1h)", type: "bool", default: true, help: "If results may wait (SLA > 1 hour), the Batch API typically halves the model price. Interactive use cases can't use it." },
      { id: "retry_rate", label: "Retry rate", type: "number", default: 0.15, step: 0.01, help: 'Fraction of documents that need a second attempt (parse errors, rejected output). Multiplies tokens, not outcomes.' },
      { id: "eval_fraction", label: "Automated eval calls (fraction)", type: "number", default: 0.1, step: 0.01, help: 'Fraction of outputs checked by an automated evaluator — those checks are model calls too and cost tokens.' },
      { id: "success_rate", label: "Success rate q (quality floor)", type: "number", default: 0.85, step: 0.01, help: 'Share of outputs that clear your quality floor. Only these count as valued outcomes (the denominator of cost per outcome).' },
      { id: "baseline_minutes", label: "Baseline: manual minutes per document", type: "number", default: 20, help: 'What the same outcome costs today without AI, in staff minutes. Gives the comparison that makes this a business case.' },
      { id: "baseline_rate", label: "Baseline: hourly rate (EUR)", type: "number", default: 65, help: 'Fully loaded hourly cost of the people doing it today (EUR).' },
    ],
  },
  assistant: {
    label: "Assistant / chat (optionally with knowledge base)",
    unit: "conversation",
    bigT: "T(n·k)",
    fields: [
      { id: "conv_per_day", label: "Conversations per day", type: "number", default: 400, help: 'Conversations started per working day.' },
      { id: "turns", label: "Turns per conversation", type: "number", default: 6, help: 'Back-and-forth exchanges per conversation. Cost grows roughly with the square of this number because history is re-sent every turn.' },
      { id: "user_words", label: "User words per turn", type: "number", default: 40, help: 'Typical length of what the user types per turn.' },
      { id: "answer_words", label: "Answer words per turn", type: "number", default: 150, help: 'Typical answer length. Output tokens are the expensive ones — shorter answers are the cheapest optimisation.' },
      { id: "language", label: "Language", type: "select", options: ["en", "nl", "fr", "de"], default: "nl", help: 'Tokenisers split Dutch/French/German heavier than English, so the same text costs more tokens. Verify the factor on your own documents.' },
      { id: "system_tokens", label: "System prompt S (tokens)", type: "number", default: 800, help: 'Instructions, schema and examples sent with every request. Stable across requests, so it is the cacheable part.' },
      { id: "history_max", label: "History cap H_max (tokens, 0 = full history)", type: "number", default: 0, help: 'Cap on conversation history sent with each turn. 0 = full history (worst case). Most frameworks trim; enter the cap to model that.' },
      { id: "rag", label: "Uses a knowledge base (RAG)", type: "bool", default: true, help: 'Does the assistant pull chunks from a knowledge base each turn? Adds retrieved text to every request plus an embedding/index component.' },
      { id: "chunks", label: "Chunks per turn k", type: "number", default: 5, showIf: { rag: [true], help: 'Retrieved passages injected per turn (k). Each one is re-billed as input.' } },
      { id: "chunk_tokens", label: "Chunk size c (tokens)", type: "number", default: 400, showIf: { rag: [true], help: 'Size of each retrieved passage (c). k × c tokens are added to every turn.' } },
      { id: "corpus_pages", label: "Corpus size (pages)", type: "number", default: 20000, showIf: { rag: [true], help: 'Size of the knowledge base. Sizes the vector index and the one-off embedding job.' } },
      { id: "reindex_fraction", label: "Re-index per month (fraction of corpus)", type: "number", default: 0.1, step: 0.01, showIf: { rag: [true], help: 'Share of the corpus re-embedded per month (content changes). Drives recurring embedding cost.' } },
      { id: "guardrails", label: "Guardrail / moderation calls", type: "bool", default: true, help: 'Moderation or validation calls on requests/answers. They are model calls too — quality and cost are one budget.' },
      { id: "latency", label: "Latency requirement", type: "select", options: ["interactive", "background", "batch"], default: "interactive", help: 'Interactive needs fast models (tokens/second); background or batch can use slower, cheaper ones — and batch pricing.' },
      { id: "retry_rate", label: "Retry rate", type: "number", default: 0.1, step: 0.01, help: 'Fraction of documents that need a second attempt (parse errors, rejected output). Multiplies tokens, not outcomes.' },
      { id: "success_rate", label: "Success rate q", type: "number", default: 0.8, step: 0.01, help: 'Share of outputs that clear your quality floor. Only these count as valued outcomes (the denominator of cost per outcome).' },
      { id: "baseline_minutes", label: "Baseline: staff minutes per conversation", type: "number", default: 8, help: 'What the same outcome costs today without AI, in staff minutes. Gives the comparison that makes this a business case.' },
      { id: "baseline_rate", label: "Baseline: hourly rate (EUR)", type: "number", default: 55, help: 'Fully loaded hourly cost of the people doing it today (EUR).' },
    ],
  },
  rag: {
    label: "RAG / question answering on a corpus",
    unit: "question",
    bigT: "T(n·k)",
    fields: [
      { id: "q_per_day", label: "Questions per day", type: "number", default: 1000, help: 'Questions asked per working day.' },
      { id: "user_words", label: "Question words", type: "number", default: 25, help: 'Typical length of what the user types per turn.' },
      { id: "answer_words", label: "Answer words", type: "number", default: 120, help: 'Typical answer length. Output tokens are the expensive ones — shorter answers are the cheapest optimisation.' },
      { id: "language", label: "Language", type: "select", options: ["en", "nl", "fr", "de"], default: "nl", help: 'Tokenisers split Dutch/French/German heavier than English, so the same text costs more tokens. Verify the factor on your own documents.' },
      { id: "system_tokens", label: "System prompt S (tokens)", type: "number", default: 500, help: 'Instructions, schema and examples sent with every request. Stable across requests, so it is the cacheable part.' },
      { id: "chunks", label: "Chunks per answer k", type: "number", default: 5, help: 'Retrieved passages injected per turn (k). Each one is re-billed as input.' },
      { id: "chunk_tokens", label: "Chunk size c (tokens)", type: "number", default: 400, help: 'Size of each retrieved passage (c). k × c tokens are added to every turn.' },
      { id: "corpus_pages", label: "Corpus size (pages)", type: "number", default: 50000, help: 'Size of the knowledge base. Sizes the vector index and the one-off embedding job.' },
      { id: "reindex_fraction", label: "Re-index per month (fraction)", type: "number", default: 0.05, step: 0.01, help: 'Share of the corpus re-embedded per month (content changes). Drives recurring embedding cost.' },
      { id: "latency", label: "Latency requirement", type: "select", options: ["interactive", "background", "batch"], default: "interactive", help: 'Interactive needs fast models (tokens/second); background or batch can use slower, cheaper ones — and batch pricing.' },
      { id: "retry_rate", label: "Retry rate", type: "number", default: 0.1, step: 0.01, help: 'Fraction of documents that need a second attempt (parse errors, rejected output). Multiplies tokens, not outcomes.' },
      { id: "success_rate", label: "Success rate q (groundedness)", type: "number", default: 0.85, step: 0.01, help: 'Share of outputs that clear your quality floor. Only these count as valued outcomes (the denominator of cost per outcome).' },
      { id: "baseline_minutes", label: "Baseline: minutes to find the answer manually", type: "number", default: 10, help: 'What the same outcome costs today without AI, in staff minutes. Gives the comparison that makes this a business case.' },
      { id: "baseline_rate", label: "Baseline: hourly rate (EUR)", type: "number", default: 55, help: 'Fully loaded hourly cost of the people doing it today (EUR).' },
    ],
  },
  agentic: {
    label: "Agentic workflow",
    unit: "task",
    bigT: "T(n·k·a)",
    fields: [
      { id: "tasks_per_day", label: "Tasks per day", type: "number", default: 100, help: 'Tasks started per working day.' },
      { id: "steps", label: "Steps per task s", type: "number", default: 8, help: 'Planner iterations per task (s). Context accumulates each step, so cost grows with s² — the agentic cost explosion.' },
      { id: "tools_per_step", label: "Tool calls per step m", type: "number", default: 2, help: 'Tool calls per step (m). Each tool result is fed back into the context.' },
      { id: "tool_result_tokens", label: "Tool result size r (tokens)", type: "number", default: 800, help: 'Average size of what a tool returns (r). Large API/DB responses are a hidden cost driver — trim them.' },
      { id: "step_output_tokens", label: "Model output per step (tokens)", type: "number", default: 300, help: 'What the model writes per step (reasoning + action). Output tokens are the expensive ones.' },
      { id: "system_tokens", label: "System prompt S (tokens)", type: "number", default: 1500, help: 'Instructions, schema and examples sent with every request. Stable across requests, so it is the cacheable part.' },
      { id: "sub_agents", label: "Sub-agent depth d", type: "number", default: 1, help: 'Depth of delegation (d): agents calling agents. Each level multiplies the token bill.' },
      { id: "sub_fraction", label: "Fraction of steps that delegate", type: "number", default: 0.3, step: 0.05, help: 'Share of steps that delegate to a sub-agent.' },
      { id: "max_tokens_per_task", label: "Hard stop: max tokens per task (0 = none!)", type: "number", default: 200000, help: 'Hard stop per task. Without it, cost per task is unbounded — T(∞). The tool refuses to call that a plan.' },
      { id: "retry_rate", label: "Retry rate", type: "number", default: 0.25, step: 0.01, help: 'Fraction of documents that need a second attempt (parse errors, rejected output). Multiplies tokens, not outcomes.' },
      { id: "eval_fraction", label: "Automated eval calls (fraction)", type: "number", default: 0.2, step: 0.01, help: 'Fraction of outputs checked by an automated evaluator — those checks are model calls too and cost tokens.' },
      { id: "success_rate", label: "Success rate q", type: "number", default: 0.7, step: 0.01, help: 'Share of outputs that clear your quality floor. Only these count as valued outcomes (the denominator of cost per outcome).' },
      { id: "latency", label: "Latency requirement", type: "select", options: ["background", "interactive", "batch"], default: "background", help: 'Interactive needs fast models (tokens/second); background or batch can use slower, cheaper ones — and batch pricing.' },
      { id: "baseline_minutes", label: "Baseline: manual minutes per task", type: "number", default: 45, help: 'What the same outcome costs today without AI, in staff minutes. Gives the comparison that makes this a business case.' },
      { id: "baseline_rate", label: "Baseline: hourly rate (EUR)", type: "number", default: 70, help: 'Fully loaded hourly cost of the people doing it today (EUR).' },
    ],
  },
  classification: {
    label: "Classification / batch processing",
    unit: "item",
    bigT: "T(n)",
    fields: [
      { id: "items_per_day", label: "Items per day", type: "number", default: 20000, help: 'Items classified per working day. Volumes here are typically large — batch and small models matter most.' },
      { id: "item_words", label: "Words per item", type: "number", default: 80, help: 'Length of one item (ticket, message, record).' },
      { id: "language", label: "Language", type: "select", options: ["en", "nl", "fr", "de"], default: "nl", help: 'Tokenisers split Dutch/French/German heavier than English, so the same text costs more tokens. Verify the factor on your own documents.' },
      { id: "system_tokens", label: "Prompt S incl. label set / few-shot (tokens)", type: "number", default: 1200, help: 'Instructions, schema and examples sent with every request. Stable across requests, so it is the cacheable part.' },
      { id: "label_tokens", label: "Output tokens per item", type: "number", default: 8, help: 'Output per item — a label or short JSON. Tiny, which is why input (and the shared prompt) dominates.' },
      { id: "batch", label: "Batch window ≥ 24h", type: "bool", default: true, help: "If results may wait (SLA > 1 hour), the Batch API typically halves the model price. Interactive use cases can't use it." },
      { id: "retry_rate", label: "Retry rate", type: "number", default: 0.05, step: 0.01, help: 'Fraction of documents that need a second attempt (parse errors, rejected output). Multiplies tokens, not outcomes.' },
      { id: "success_rate", label: "Success rate q (accuracy)", type: "number", default: 0.92, step: 0.01, help: 'Share of outputs that clear your quality floor. Only these count as valued outcomes (the denominator of cost per outcome).' },
      { id: "baseline_minutes", label: "Baseline: manual minutes per item", type: "number", default: 1, help: 'What the same outcome costs today without AI, in staff minutes. Gives the comparison that makes this a business case.' },
      { id: "baseline_rate", label: "Baseline: hourly rate (EUR)", type: "number", default: 45, help: 'Fully loaded hourly cost of the people doing it today (EUR).' },
    ],
  },
};

export function defaultsFor(archetype) {
  const out = {};
  for (const f of ARCHETYPES[archetype].fields) out[f.id] = f.default;
  return out;
}

const ceil = Math.ceil, max = Math.max, min = Math.min;

// ---------- per-archetype token math (per unit) ----------
function tokensDocument(p, cfg, sc) {
  const tpw = cfg.defaults.tpw[p.language] * sc.tpw;
  const wpp = cfg.defaults.wpp[p.doc_type];
  const S = p.system_tokens;
  const docTokens = p.pages * wpp * tpw;
  let o = 0;
  if (p.output_kind !== "summary") o += p.fields * cfg.defaults.tokens_per_field;
  if (p.output_kind !== "extraction") o += p.summary_words * tpw;
  const W = cfg.defaults.default_context_window;
  const notes = [];
  let input, output, chunks = 1;
  if (docTokens + S + o <= W) {
    input = S + docTokens; output = o;
  } else {
    const oc = cfg.defaults.o_chunk;
    chunks = ceil(docTokens / (W - S - oc));
    input = chunks * (S + docTokens / chunks) + (S + chunks * oc);
    output = chunks * oc + o;
    notes.push(`Document exceeds the context window: map-reduce in ${chunks} chunks (adds ${chunks} intermediate outputs).`);
  }
  return { input, output, cacheable: S * chunks, docTokens, chunks, notes, contextNeeded: chunks > 1 ? W : docTokens + S + o };
}

function tokensAssistant(p, cfg, sc) {
  const tpw = cfg.defaults.tpw[p.language] * sc.tpw;
  const u = p.user_words * tpw, o = p.answer_words * tpw, S = p.system_tokens, t = p.turns;
  let history = 0;
  for (let i = 1; i <= t; i++) {
    const h = (i - 1) * (u + o);
    history += p.history_max > 0 ? min(h, p.history_max) : h;
  }
  const quadratic = (u + o) * t * (t - 1) / 2;
  let input = t * S + t * u + history;
  const ragTokens = p.rag ? t * p.chunks * p.chunk_tokens : 0;
  input += ragTokens;
  const notes = [`Quadratic history term (full re-billing): ${Math.round(quadratic).toLocaleString()} tokens per conversation${p.history_max > 0 ? ` — capped to H_max=${p.history_max}` : ""}.`];
  return { input, output: t * o, cacheable: t * S, notes, contextNeeded: S + (p.history_max > 0 ? p.history_max : (t - 1) * (u + o)) + u + (p.rag ? p.chunks * p.chunk_tokens : 0) + o, embeddingPerUnit: p.rag ? t * u : 0, quadratic };
}

function tokensRag(p, cfg, sc) {
  const tpw = cfg.defaults.tpw[p.language] * sc.tpw;
  const u = p.user_words * tpw, o = p.answer_words * tpw, S = p.system_tokens;
  const input = S + u + p.chunks * p.chunk_tokens;
  return { input, output: o, cacheable: S, notes: [], contextNeeded: input + o, embeddingPerUnit: u };
}

function tokensAgentic(p, cfg, sc) {
  const s = max(1, Math.round(p.steps * sc.steps)), S = p.system_tokens;
  const perStep = p.step_output_tokens + p.tools_per_step * p.tool_result_tokens;
  let input = s * S + perStep * s * (s - 1) / 2;
  let output = s * p.step_output_tokens;
  const subMult = 1 + p.sub_agents * p.sub_fraction;
  input *= subMult; output *= subMult;
  const notes = [`Context grows per step: ${s} steps × (S + accumulated ${perStep} tokens/step) × sub-agent factor ${subMult.toFixed(2)}.`];
  let capped = false;
  if (p.max_tokens_per_task > 0 && input + output > p.max_tokens_per_task) {
    const f = p.max_tokens_per_task / (input + output);
    input *= f; output *= f; capped = true;
    notes.push(`Hard stop reached in this scenario: task truncated at ${p.max_tokens_per_task.toLocaleString()} tokens — expect lower success rate.`);
  }
  if (p.max_tokens_per_task <= 0) notes.push("No hard stop: cost per task is unbounded — T(∞). Set a max tokens per task before this goes to production.");
  return { input, output, cacheable: s * S, notes, contextNeeded: S + perStep * (s - 1), steps: s, capped, unbounded: p.max_tokens_per_task <= 0 };
}

function tokensClassification(p, cfg, sc) {
  const tpw = cfg.defaults.tpw[p.language] * sc.tpw;
  const item = p.item_words * tpw, S = p.system_tokens;
  return { input: S + item, output: p.label_tokens, cacheable: S, notes: [], contextNeeded: S + item + p.label_tokens };
}

const TOKENS = { document: tokensDocument, assistant: tokensAssistant, rag: tokensRag, agentic: tokensAgentic, classification: tokensClassification };
const UNITS_PER_DAY = { document: "docs_per_day", assistant: "conv_per_day", rag: "q_per_day", agentic: "tasks_per_day", classification: "items_per_day" };

// ---------- scenario helpers ----------
function attempts(p, cfg, sc) {
  const base = 1 + (p.retry_rate ?? 0) + (p.eval_fraction ?? 0);
  if (sc.a_override != null) return sc.a_override;
  return base * (sc.a_mult ?? 1);
}
function cacheHit(cfg, sc) {
  return min(0.95, max(0, cfg.defaults.cache_hit_system_prompt + (sc.h_delta ?? 0)));
}

// ---------- model selection ----------
// Maps the step-2 "Intelligence" priority (0-100, same scale as WEIGHT_LEVELS) onto a minimum Artificial
// Analysis intelligence index, by linear interpolation across cfg.defaults.intelligence_floor_by_weight.
// This replaces the old quality_bar dropdown: the model that actually gets priced now tracks the same
// priority weight shown (and editable) in step 2, instead of a separate, coarser control.
export function intelligenceFloor(weight, cfg) {
  const table = cfg.defaults.intelligence_floor_by_weight;
  const levels = Object.keys(table).map(Number).sort((a, b) => a - b);
  const w = Math.max(levels[0], Math.min(levels[levels.length - 1], weight ?? 0));
  for (let i = 0; i < levels.length - 1; i++) {
    const a = levels[i], b = levels[i + 1];
    if (w >= a && w <= b) return Math.round(table[a] + (w - a) / (b - a) * (table[b] - table[a]));
  }
  return Math.round(table[levels[levels.length - 1]]);
}
// Picks the model that actually gets priced (BOM, cost, business case): the top fit-score row from
// rankModels() — the same weighted ranking step 3's table shows, using ALL of step 2's priority
// categories, not just intelligence — filtered by the same hard floors as the table (min intelligence,
// max $/month, released-after, only-complete, providers) plus a latency-driven tokens/sec floor.
export function selectModel(models, opts, cfg) {
  const { weights, profile, minIntelligence = 0, maxCost = null, since = "", onlyComplete = false, providers = null,
    latency, contextNeeded, inTokens = 0, outTokens = 0, cachedTokens = 0, batchFactor = 1 } = opts;
  if (!models || !models.length) return { recommended: null, defaultAlternative: null, candidates: [], note: "No model data loaded — enter prices manually." };
  const minTps = cfg.defaults.latency_min_tps[latency ?? "batch"];
  const ranked = rankModels(models, { weights, profile, minInt: minIntelligence, maxCost, since, onlyComplete, providers, minTps, inTokens, outTokens, cachedTokens, batchFactor });
  const priced = ranked.rows.filter(m => m.usd_per_1m_input != null && m.usd_per_1m_output != null);
  const priceOnly = models.filter(m => m.usd_per_1m_input != null && m.usd_per_1m_output != null);
  const smartest = [...priceOnly].sort((a, b) => (b.intelligence_index ?? 0) - (a.intelligence_index ?? 0))[0] || null;
  return {
    recommended: priced[0] || null,
    defaultAlternative: smartest,
    candidates: priced.slice(0, 8),
    threshold: minIntelligence, minTps,
    note: `Best fit for this workload's priorities (step 2), intelligence index ≥ ${minIntelligence}${maxCost != null ? `, ≤ $${maxCost}/mo` : ""}${minTps ? `, ≥ ${minTps} tokens/s` : ""}. Context window not in free-tier data — verify ≥ ${Math.round((contextNeeded ?? 0) * cfg.defaults.context_margin).toLocaleString()} tokens.`,
  };
}

// ---------- BOM ----------
function bom(archetype, p, cfg, month, extra) {
  const D = cfg.defaults.working_days;
  const units = p[UNITS_PER_DAY[archetype]] * D;
  const rows = [];
  const add = (component, role, sku_hint, quantity, unit, source, condition = true) => { if (condition) rows.push({ component, role, sku_hint, quantity: quantity < 100 ? Math.round(quantity * 100) / 100 : Math.round(quantity), unit, source }); };
  add("Azure OpenAI / AI Foundry model deployment", "inference", month.ptuSignal ? "PAYG now; evaluate PTU at Run" : "PAYG", month.input + month.cached + month.output, "tokens/month (see token_profile)", "token_profile");
  if (archetype === "document") {
    add("Azure OpenAI Batch API", "discounted inference", "Global Batch", month.input + month.output, "tokens/month", "batch=true", !!p.batch);
    add("Azure AI Document Intelligence", "OCR", "Read / Layout", units * p.pages, "pages/month", "docs × pages", !!p.scanned);
    add("Blob Storage", "document store", "Hot LRS", units * cfg.defaults.avg_doc_mb / 1024, "GB/month (retention 1 month)", "docs × avg_doc_mb");
    add("Azure Functions", "orchestration", "Consumption", units * (extra.chunks || 1), "executions/month", "docs × chunks");
  }
  if (archetype === "assistant" || archetype === "rag") {
    const turns = archetype === "assistant" ? p.turns : 1;
    add("Embeddings model", "query embedding + (re)indexing", "text-embedding", extra.embeddingMonth, "tokens/month", "queries × u + reindex × corpus", !!(p.rag ?? true));
    const chunksIdx = (p.corpus_pages * cfg.defaults.wpp.prose * cfg.defaults.tpw.en) / (p.chunk_tokens || cfg.defaults.chunk_tokens);
    add("Azure AI Search (vector index)", "retrieval", chunksIdx > 2e6 ? "Standard S2+" : chunksIdx > 3e5 ? "Standard S1" : "Basic", chunksIdx * (cfg.defaults.vector_dims * 4 + p.chunk_tokens * 4) / 1e9, "GB index (≈ chunks × (dims×4B + text))", "corpus_pages", !!(p.rag ?? true));
    add("App Service / Container Apps", "chat backend", "P1v3 (size on peak sessions)", units * turns, "requests/month", "units × turns");
    add("API Management (gateway)", "identity per use case, token logging", "Standard v2", units * turns, "requests/month", "units × turns");
    add("Guardrail / moderation model calls", "safety", "small model", units * turns * cfg.defaults.guardrail_fraction, "calls/month", "guardrail_fraction", !!p.guardrails);
  }
  if (archetype === "agentic") {
    add("Second model deployment (worker)", "cheap worker model for tool steps", "small model", month.output, "tokens/month (share of output)", "planner/worker split — refine");
    add("API Management (gateway)", "per-task identity + token budget", "Standard v2", units * (extra.steps || p.steps) * (1 + p.tools_per_step), "requests/month", "tasks × steps × (1 + tools)");
    add("Container Apps / Durable Functions", "orchestration", "Consumption", units, "task runs/month", "tasks");
    add("Service Bus / Storage Queue", "task queue", "Standard", units, "messages/month", "tasks");
    add("Eval model calls", "automated quality checks", "small model", units * (p.eval_fraction ?? 0), "calls/month", "eval_fraction");
  }
  if (archetype === "classification") {
    add("Azure OpenAI Batch API", "discounted inference", "Global Batch", month.input + month.output, "tokens/month", "batch=true", !!p.batch);
    add("Azure Functions", "orchestration", "Consumption", units / 1000, "batch jobs/month (1k items per job)", "items / 1000");
    add("Blob Storage", "input/output store", "Hot LRS", units * 0.002, "GB/month", "items × 2 KB");
  }
  add("Log Analytics", "observability (usage + cost + quality per request)", "PAYG", units * (extra.requestsPerUnit || 1) * cfg.defaults.log_kb_per_request / 1e6, "GB/month", "requests × log_kb");
  return rows;
}

// ---------- pricing (single source of truth: scenario cost math and the tokenomics-lever what-ifs both call this) ----------
export function priceTokens(model, tokens, batchFactor = 1) {
  if (!model) return null;
  const pin = model.usd_per_1m_input, pout = model.usd_per_1m_output, pc = model.usd_per_1m_cache_hit ?? pin;
  if (pin == null || pout == null) return null;
  return ((tokens.input * pin + tokens.cached * pc + tokens.output * pout) / 1e6) * batchFactor;
}

// ---------- main ----------
export function computeScenario(archetype, params, cfg, scenarioName, models, priceOverride, selection = {}) {
  const sc = cfg.scenarios[scenarioName];
  const p = { ...defaultsFor(archetype), ...params };
  const T = TOKENS[archetype](p, cfg, sc);
  const D = cfg.defaults.working_days;
  const unitsPerDay = p[UNITS_PER_DAY[archetype]];
  const a = attempts(p, cfg, sc);
  const h = cacheHit(cfg, sc);
  const unitsMonth = unitsPerDay * D;
  const attemptsMonth = unitsMonth * a;
  const cached = h * T.cacheable * attemptsMonth;
  const input = T.input * attemptsMonth - cached;
  const output = T.output * attemptsMonth;
  const batchFactor = p.batch ? cfg.defaults.batch_factor : 1;
  const ptuSignal = input + cached + output >= cfg.defaults.ptu_breakeven_tokens_month;

  const chosenProfile = selection.profile || TASKFIT_PROFILE_OF[archetype] || "bulk";
  const defaultWeights = TASKFIT_PROFILES[chosenProfile]?.w || TASKFIT_PROFILES.bulk.w;
  const weights = selection.weights || defaultWeights;
  const intelligenceWeight = selection.intelligenceWeight ?? p.intelligence_weight ?? (weights.intelligence_index ?? 0);
  const minIntelligence = selection.minIntelligence ?? intelligenceFloor(intelligenceWeight, cfg);
  const sel = selectModel(models, {
    weights, profile: chosenProfile,
    minIntelligence, maxCost: selection.maxCost ?? null, since: selection.since ?? "",
    onlyComplete: selection.onlyComplete ?? false, providers: selection.providers ?? null,
    latency: p.latency, contextNeeded: T.contextNeeded,
    inTokens: input, outTokens: output, cachedTokens: cached, batchFactor,
  }, cfg);
  const model = priceOverride || sel.recommended;
  const modelCostUsd = priceTokens(model, { input, cached, output }, batchFactor);
  const priceSource = !model ? "none" : priceOverride ? (priceOverride.slug === "manual" ? "manual" : "task-fit") : "artificial-analysis";
  const embeddingMonth = (T.embeddingPerUnit || 0) * attemptsMonth + (p.reindex_fraction && p.corpus_pages ? p.reindex_fraction * p.corpus_pages * cfg.defaults.wpp.prose * cfg.defaults.tpw[p.language || "en"] : 0);
  const embeddingUsd = (archetype === "assistant" && !p.rag) ? 0 : embeddingMonth / 1e6 * cfg.defaults.embedding_usd_per_1m;

  const outcomes = unitsMonth * p.success_rate;
  const fx = cfg.defaults.usd_to_eur;
  const modelCostEur = modelCostUsd == null ? null : (modelCostUsd + embeddingUsd) * fx;
  const cpoModel = modelCostEur == null ? null : modelCostEur / outcomes;
  const baselineEur = (p.baseline_minutes / 60) * p.baseline_rate;

  const month = { input: Math.round(input), cached: Math.round(cached), output: Math.round(output), attempts: attemptsMonth, units: unitsMonth, ptuSignal };
  const extra = { chunks: T.chunks, steps: T.steps, embeddingMonth, requestsPerUnit: archetype === "assistant" ? p.turns : archetype === "agentic" ? (T.steps || p.steps) : 1 };
  return {
    scenario: scenarioName,
    assumptions: { a: +a.toFixed(3), h: +h.toFixed(2), q: p.success_rate, D, tpw_factor: sc.tpw, batch_factor: batchFactor },
    per_unit: { input: Math.round(T.input), output: Math.round(T.output), cacheable: Math.round(T.cacheable), context_needed: Math.round(T.contextNeeded) },
    month,
    model: { selection: sel, used: model ? { name: model.name, slug: model.slug, usd_per_1m_input: model.usd_per_1m_input, usd_per_1m_output: model.usd_per_1m_output, usd_per_1m_cache_hit: model.usd_per_1m_cache_hit ?? null, intelligence_index: model.intelligence_index ?? null } : null, price_source: priceSource },
    cost: { model_usd_month: modelCostUsd == null ? null : +modelCostUsd.toFixed(2), embedding_usd_month: +embeddingUsd.toFixed(2), model_eur_month: modelCostEur == null ? null : +modelCostEur.toFixed(2), cost_per_outcome_eur: cpoModel == null ? null : +cpoModel.toFixed(4), baseline_per_outcome_eur: +baselineEur.toFixed(2), outcomes_month: Math.round(outcomes) },
    bom: bom(archetype, p, cfg, month, extra),
    notes: T.notes,
    flags: { ptu_signal: ptuSignal, unbounded: !!T.unbounded, capped: !!T.capped },
  };
}

export function compute(archetype, params, cfg, models, priceOverride, selectedScenario = "base", selection = {}) {
  const scenarios = {};
  for (const s of ["low", "base", "high"]) scenarios[s] = computeScenario(archetype, params, cfg, s, models, priceOverride, selection);
  const selected = ["low", "base", "high"].includes(selectedScenario) ? selectedScenario : "base";
  return { archetype, label: ARCHETYPES[archetype].label, unit: ARCHETYPES[archetype].unit, bigT: ARCHETYPES[archetype].bigT, params: { ...defaultsFor(archetype), ...params }, scenarios, selected };
}

// ---------- export formats ----------
export const selectedOf = (result) => result.scenarios[result.selected || "base"];

export function toBomJson(result, meta = {}) {
  const b = selectedOf(result);
  return {
    use_case: { name: meta.name || "", archetype: result.archetype, outcome_unit: meta.outcome_unit || result.unit, count_source: meta.count_source || "", quality_floor: meta.quality_floor || "", bigT: result.bigT },
    scenario_used: result.selected || "base",
    assumptions: b.assumptions,
    token_profile_month: { low: result.scenarios.low.month, base: b.month, high: result.scenarios.high.month },
    model: b.model.used ? { ...b.model.used, intelligence_floor: b.model.selection.threshold ?? null, latency: result.params.latency || "batch", context_needed: b.per_unit.context_needed, note: b.model.selection.note } : { note: b.model.selection.note },
    bom: b.bom,
    cost_per_outcome_eur: { low: result.scenarios.low.cost.cost_per_outcome_eur, base: b.cost.cost_per_outcome_eur, high: result.scenarios.high.cost.cost_per_outcome_eur, baseline: b.cost.baseline_per_outcome_eur, note: "Model + embedding cost only; infra from Azure estimator, labour from ledger." },
    flags: b.flags, notes: b.notes,
    generated: new Date().toISOString().slice(0, 10), spec_version: "0.1",
    attribution: "Model prices: Artificial Analysis (https://artificialanalysis.ai). Formulas: Costra AI Use-Case Capture spec v0.1.",
  };
}

export function toArchitectureMarkdown(result, meta = {}) {
  const b = selectedOf(result), j = toBomJson(result, meta);
  const fmt = n => n == null ? "—" : Math.round(n).toLocaleString();
  const L = [];
  L.push(`# ${meta.name || "AI use case"} — architecture & volumes for cost estimation`, "");
  L.push(`Archetype: **${result.label}** · unit: ${result.unit} · Big-T: ${result.bigT} · sizing scenario: **${j.scenario_used}** · generated ${j.generated}`, "");
  L.push(`## Volumes (base scenario, per month)`, "", `- Units: ${fmt(b.month.units)} ${result.unit}s (${fmt(b.month.attempts)} attempts, a = ${b.assumptions.a})`);
  L.push(`- Tokens: ${fmt(b.month.input)} input (uncached), ${fmt(b.month.cached)} cached input, ${fmt(b.month.output)} output`);
  L.push(`- Context needed per request: ~${fmt(b.per_unit.context_needed)} tokens`, "");
  if (b.model.used) L.push(`## Model`, "", `- ${b.model.used.name} (AA intelligence ${b.model.used.intelligence_index ?? "—"}); list price ${b.model.used.usd_per_1m_input}/${b.model.used.usd_per_1m_output} USD per 1M in/out`, `- ${b.model.selection.note}`, "");
  L.push(`## Components (BOM)`, "", "| Component | Role | SKU hint | Quantity | Unit |", "|---|---|---|---:|---|");
  for (const r of b.bom) L.push(`| ${r.component} | ${r.role} | ${r.sku_hint} | ${fmt(r.quantity)} | ${r.unit} |`);
  L.push("", `## Assumptions`, "", `- tokens/word factor ${b.assumptions.tpw_factor}, cache hit ${b.assumptions.h}, success rate ${b.assumptions.q}, working days ${b.assumptions.D}, batch factor ${b.assumptions.batch_factor}`);
  for (const n of b.notes) L.push(`- ${n}`);
  L.push("", `## Cost per outcome (model + embeddings only, EUR)`, "", `low ${j.cost_per_outcome_eur.low ?? "—"} · base ${j.cost_per_outcome_eur.base ?? "—"} · high ${j.cost_per_outcome_eur.high ?? "—"} · baseline today ${j.cost_per_outcome_eur.baseline}`, "");
  L.push(`Region and SKU sizing to be priced with the Azure estimator. ${j.attribution}`);
  return L.join("\n");
}

// ---------- Task-Fit ranking (single source of truth: the same weights back the compact "top model" pick
// during use-case sizing and the full sortable model table). ----------
export const TASKFIT_METRICS = [
  { key: "intelligence_index", label: "Intelligence", scale: "lin", dir: 1, help: "How much must the model reason well and get things right?" },
  { key: "coding_index", label: "Coding", scale: "lin", dir: 1, help: "Does the task involve writing or fixing code?" },
  { key: "agentic_index", label: "Agentic", scale: "lin", dir: 1, help: "Must the model use tools and work through steps on its own?" },
  { key: "usd_per_1m_blended_3to1", label: "Low price", scale: "log", dir: -1, help: "At high volume, how much does price per token matter?" },
  { key: "cost_per_task_usd", label: "Low cost per task", scale: "log", dir: -1, help: "How much does the real cost to finish one task matter (reasoning tokens included)?" },
  { key: "output_tokens_per_sec", label: "Speed", scale: "log", dir: 1, help: "Do users wait for long answers to stream in?" },
  { key: "ttft_sec", label: "Low latency", scale: "log", dir: -1, help: "Must the first words appear fast, as in live chat or voice?" },
];
export const WEIGHT_LEVELS = [
  { v: 0, label: "Not needed" }, { v: 25, label: "A little" }, { v: 50, label: "Matters" }, { v: 75, label: "A lot" }, { v: 100, label: "Critical" },
];
export const TASKFIT_PROFILES = {
  chat: { name: "Speed & price first", desc: "For high-volume, user-facing use cases. Fast first response and low price matter most; enough agentic ability to call tools (order lookup, ticketing) — capability itself is secondary.",
    w: { intelligence_index: 15, agentic_index: 15, usd_per_1m_blended_3to1: 25, output_tokens_per_sec: 15, ttft_sec: 30 } },
  code: { name: "Coding accuracy first", desc: "For generating, reviewing or refactoring code. Coding capability leads, but understanding the requirement and the existing codebase matters too — not just isolated code-gen benchmarks.",
    w: { coding_index: 35, intelligence_index: 22, agentic_index: 18, cost_per_task_usd: 15, output_tokens_per_sec: 10 } },
  agent: { name: "Tool-use reliability first", desc: "For multi-step automation with tools (back-office, IT ops, research agents). Reliable tool calling and task completion lead, with a firm eye on what a completed task really costs.",
    w: { agentic_index: 40, intelligence_index: 25, cost_per_task_usd: 25, output_tokens_per_sec: 10 } },
  bulk: { name: "Cheapest at scale", desc: "For summarizing, classifying or extracting at volume, often in batch. Price per token dominates; a minimum intelligence keeps quality acceptable.",
    w: { usd_per_1m_blended_3to1: 60, output_tokens_per_sec: 20, intelligence_index: 20 } },
  analysis: { name: "Deep reasoning first", desc: "For advisory, reasoning-heavy, low-volume work (strategy, legal or financial analysis). Capability leads; cost is secondary.",
    w: { intelligence_index: 60, cost_per_task_usd: 20, agentic_index: 10, usd_per_1m_blended_3to1: 10 } },
};
export const TASKFIT_PROFILE_OF = { document: "bulk", classification: "bulk", assistant: "chat", rag: "chat", agentic: "agent" };

// Full ranking with every filter the model table needs (used for both the compact top-N pick during sizing
// and the browsable table); weights may be a profile id (string) or a custom {key: 0-100} map.
export function rankModels(models, opts = {}) {
  const { weights, profile = "bulk", minInt = 0, maxCost = null, creatorQuery = "", since = "", onlyComplete = false,
    providers = null, minTps = 0, inTokens = 0, outTokens = 0, cachedTokens = 0, batchFactor = 1, limit = Infinity } = opts;
  const w = weights || (TASKFIT_PROFILES[profile] || TASKFIT_PROFILES.bulk).w;
  const active = TASKFIT_METRICS.filter((m) => (w[m.key] || 0) > 0);
  const ranges = {};
  for (const m of TASKFIT_METRICS) {
    const vals = models.map((x) => x[m.key]).filter((v) => v != null && (m.scale !== "log" || v > 0));
    if (!vals.length) continue;
    const t = m.scale === "log" ? vals.map(Math.log) : vals;
    ranges[m.key] = { min: Math.min(...t), max: Math.max(...t) };
  }
  const scaled = (model, m) => { const v = model[m.key], r = ranges[m.key]; if (v == null || !r || (m.scale === "log" && v <= 0)) return null; const t = m.scale === "log" ? Math.log(v) : v; if (r.max === r.min) return 100; const s = (t - r.min) / (r.max - r.min) * 100; return m.dir === 1 ? s : 100 - s; };
  const q = creatorQuery.trim().toLowerCase();
  const rows = [];
  for (const m of models) {
    if (minInt && (m.intelligence_index ?? -1) < minInt) continue;
    if (minTps && (m.output_tokens_per_sec ?? 0) < minTps) continue;
    if (providers && !providers.has(m.creator || "Unknown")) continue;
    if (q && ![m.name, m.slug].some((v) => v && v.toLowerCase().includes(q))) continue;
    if (since && (!m.release_date || m.release_date < since)) continue;
    let sum = 0, wsum = 0, missing = 0;
    for (const met of active) { const wt = w[met.key] || 0; const s = scaled(m, met); if (s == null) { missing++; continue; } sum += s * wt; wsum += wt; }
    if (!active.length || !wsum) continue;
    if (onlyComplete && missing) continue;
    const priced = m.usd_per_1m_input != null && m.usd_per_1m_output != null;
    const monthly = priced ? (inTokens * m.usd_per_1m_input + cachedTokens * (m.usd_per_1m_cache_hit ?? m.usd_per_1m_input) + outTokens * m.usd_per_1m_output) / 1e6 * batchFactor : null;
    if (maxCost != null && (monthly == null || monthly > maxCost)) continue;
    rows.push({ ...m, fit: sum / wsum, partial: missing > 0, monthly });
  }
  rows.sort((a, b) => b.fit - a.fit);
  return { profile: weights ? "Custom" : (TASKFIT_PROFILES[profile] || TASKFIT_PROFILES.bulk).name, rows: Number.isFinite(limit) ? rows.slice(0, limit) : rows, total: rows.length };
}

// ---------- Tokenomics levers: what-ifs applied on top of an already-sized scenario (computeScenario result).
// Cache/trim/shorten act on the monthly token pool; agent-depth-cap re-runs the real per-step formula (quadratic
// growth included) rather than approximating it linearly. Everything here re-prices with the same priceTokens()
// the sizing step uses, so the two never drift apart.
export function tuneScenario(archetype, params, cfg, models, priceOverride, selectedScenario, levers = {}, selection = {}) {
  const capSteps = archetype === "agentic" && levers.agentDepth != null;
  const cappedParams = capSteps ? { ...params, steps: Math.min(params.steps ?? defaultsFor("agentic").steps, levers.agentDepth) } : params;
  const today = computeScenario(archetype, params, cfg, selectedScenario, models, priceOverride, selection);
  const base = capSteps ? computeScenario(archetype, cappedParams, cfg, selectedScenario, models, priceOverride, selection) : today;

  const totalInput = base.month.input + base.month.cached;
  const h0 = base.assumptions.h;
  const hNew = Math.max(h0, levers.cacheTarget ?? 0);
  const trimmedTotal = totalInput * (1 - (levers.trimPct ?? 0));
  const newCached = trimmedTotal * hNew;
  const newInput = trimmedTotal - newCached;
  const newOutput = base.month.output * (1 - (levers.shortenPct ?? 0));
  const tokens = { input: newInput, cached: newCached, output: newOutput };

  const model = base.model.used;
  const batchFactor = base.assumptions.batch_factor;
  const fx = cfg.defaults.usd_to_eur;
  const usd = priceTokens(model, tokens, batchFactor);
  const eur = usd == null ? null : usd * fx;
  const outcomes = base.cost.outcomes_month;
  const optimized = {
    month: { input: Math.round(newInput), cached: Math.round(newCached), output: Math.round(newOutput), attempts: base.month.attempts, units: base.month.units },
    cost: { model_usd_month: usd == null ? null : +usd.toFixed(2), model_eur_month: eur == null ? null : +eur.toFixed(2), cost_per_outcome_eur: eur == null ? null : +(eur / outcomes).toFixed(4), outcomes_month: outcomes },
  };
  return { today, optimized, steps_capped: capSteps ? cappedParams.steps : null };
}
