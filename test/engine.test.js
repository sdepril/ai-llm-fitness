import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compute, computeScenario, defaultsFor, selectModel, toBomJson, toArchitectureMarkdown, ARCHETYPES } from "../public/engine.js";

const cfg = JSON.parse(readFileSync(new URL("../public/config.json", import.meta.url)));
const models = [
  { name: "Cheap", slug: "cheap", intelligence_index: 45, usd_per_1m_input: 0.2, usd_per_1m_output: 0.8, usd_per_1m_cache_hit: 0.1, output_tokens_per_sec: 150 },
  { name: "Mid", slug: "mid", intelligence_index: 60, usd_per_1m_input: 1.0, usd_per_1m_output: 4.0, usd_per_1m_cache_hit: 0.5, output_tokens_per_sec: 80 },
  { name: "Top", slug: "top", intelligence_index: 75, usd_per_1m_input: 5.0, usd_per_1m_output: 20.0, usd_per_1m_cache_hit: 2.5, output_tokens_per_sec: 40 },
];

test("every archetype computes three scenarios with monotone cost", () => {
  for (const a of Object.keys(ARCHETYPES)) {
    const r = compute(a, defaultsFor(a), cfg, models);
    const { low, base, high } = r.scenarios;
    assert.ok(low.cost.model_usd_month <= base.cost.model_usd_month, `${a}: low ≤ base`);
    assert.ok(base.cost.model_usd_month <= high.cost.model_usd_month, `${a}: base ≤ high`);
    assert.ok(base.bom.length >= 2, `${a}: has BOM`);
  }
});

test("assistant: quadratic history term — doubling turns roughly quadruples history tokens", () => {
  const p = { ...defaultsFor("assistant"), rag: false, history_max: 0, system_tokens: 0 };
  const t10 = computeScenario("assistant", { ...p, turns: 10 }, cfg, "base", []);
  const t20 = computeScenario("assistant", { ...p, turns: 20 }, cfg, "base", []);
  const tpw = cfg.defaults.tpw[p.language];
  const perTurn = (p.user_words + p.answer_words) * tpw;
  const hist10 = perTurn * 10 * 9 / 2, hist20 = perTurn * 20 * 19 / 2;
  assert.ok(Math.abs(hist20 / hist10 - 4.22) < 0.05);
  assert.ok(t20.per_unit.input > 3.5 * t10.per_unit.input);
});

test("assistant: history cap bounds the input", () => {
  const p = { ...defaultsFor("assistant"), rag: false, turns: 30 };
  const full = computeScenario("assistant", { ...p, history_max: 0 }, cfg, "base", []);
  const capped = computeScenario("assistant", { ...p, history_max: 2000 }, cfg, "base", []);
  assert.ok(capped.per_unit.input < full.per_unit.input);
});

test("document: long documents trigger map-reduce chunking", () => {
  const p = { ...defaultsFor("document"), pages: 400 };
  const r = computeScenario("document", p, cfg, "base", []);
  assert.ok(r.notes.some(n => n.includes("map-reduce")));
});

test("attempts and success rate act on different sides", () => {
  const p = defaultsFor("document");
  const r1 = computeScenario("document", { ...p, retry_rate: 0, eval_fraction: 0 }, cfg, "base", models);
  const r2 = computeScenario("document", { ...p, retry_rate: 0.5, eval_fraction: 0 }, cfg, "base", models);
  assert.equal(r1.cost.outcomes_month, r2.cost.outcomes_month); // q unchanged
  assert.ok(r2.month.input > r1.month.input);                   // a on tokens
});

test("model selection: cheapest above threshold, respects latency", () => {
  const s = selectModel(models, { quality_bar: "medium", latency: "batch", contextNeeded: 1000 }, cfg);
  assert.equal(s.recommended.slug, "mid");
  const s2 = selectModel(models, { quality_bar: "high", latency: "interactive", contextNeeded: 1000 }, cfg);
  assert.equal(s2.recommended, null); // Top is too slow for interactive (40 < 60)
  assert.equal(s.defaultAlternative.slug, "top");
});

test("agentic: no hard stop flags unbounded; hard stop caps", () => {
  const p = defaultsFor("agentic");
  const un = computeScenario("agentic", { ...p, max_tokens_per_task: 0 }, cfg, "high", []);
  assert.ok(un.flags.unbounded);
  const cap = computeScenario("agentic", { ...p, max_tokens_per_task: 20000 }, cfg, "high", []);
  assert.ok(cap.flags.capped);
  assert.ok(cap.per_unit.input + cap.per_unit.output <= 20000 + 1);
});

test("exports: BOM json and markdown render", () => {
  const r = compute("rag", defaultsFor("rag"), cfg, models);
  const j = toBomJson(r, { name: "Policy Q&A", outcome_unit: "answered question" });
  assert.equal(j.use_case.bigT, "T(n·k)");
  assert.ok(j.bom.some(b => b.component.includes("AI Search")));
  const md = toArchitectureMarkdown(r, { name: "Policy Q&A" });
  assert.ok(md.includes("| Component |") && md.includes("Cost per outcome"));
});

test("task-fit deep link carries workload, quality bar and tokenomics inputs", async () => {
  const { toTaskFitUrl } = await import("../public/engine.js");
  const r = compute("assistant", defaultsFor("assistant"), cfg, models);
  const u = new URL(toTaskFitUrl(r, cfg, { name: "Helpdesk bot" }));
  const q = u.searchParams;
  assert.equal(q.get("profile"), "chat");
  assert.equal(q.get("minInt"), "55");
  assert.equal(q.get("tkK"), "6");
  assert.ok(+q.get("in") > 0 && +q.get("out") > 0);
  assert.equal(u.hash, "#tokenomics");
});

test("task-fit ranking: bulk profile prefers cheap-and-fast above the intelligence floor", async () => {
  const { taskFitRank } = await import("../public/engine.js");
  const ms = models.map(m => ({ ...m, usd_per_1m_blended_3to1: (3 * m.usd_per_1m_input + m.usd_per_1m_output) / 4, ttft_sec: 0.5, coding_index: 50, agentic_index: 50, cost_per_task_usd: m.usd_per_1m_output / 100 }));
  const r = taskFitRank(ms, { profile: "bulk", minInt: 50, inTokens: 1e8, outTokens: 1e7, cachedTokens: 0 });
  assert.equal(r.rows[0].slug, "mid");             // cheap is below the floor, top is expensive and slow
  assert.ok(r.rows[0].monthly < r.rows[1].monthly);
});

test("rankModels: full table respects filters (minInt, maxCost, creator, onlyComplete) with no cap", async () => {
  const { rankModels } = await import("../public/engine.js");
  const ms = models.map(m => ({ ...m, creator: m.slug === "top" ? "Acme" : "Other", coding_index: 50, agentic_index: 50, ttft_sec: 0.5, cost_per_task_usd: m.usd_per_1m_output / 100 }));
  const all = rankModels(ms, { profile: "bulk" });
  assert.equal(all.total, 3);
  assert.equal(all.rows.length, 3); // no implicit cap
  const floored = rankModels(ms, { profile: "bulk", minInt: 50 });
  assert.equal(floored.total, 2);
  const cheap = rankModels(ms, { profile: "bulk", inTokens: 1e8, outTokens: 1e7, maxCost: 50 });
  assert.ok(cheap.rows.every(r => r.monthly <= 50));
  const acme = rankModels(ms, { profile: "bulk", providers: new Set(["Acme"]) });
  assert.equal(acme.rows.length, 1);
  assert.equal(acme.rows[0].slug, "top");
  const byName = rankModels(ms, { profile: "bulk", creatorQuery: "mid" });
  assert.equal(byName.rows.length, 1);
  assert.equal(byName.rows[0].slug, "mid");
});

test("tuneScenario: cache/trim/shorten levers reduce cost and re-price with the same math as sizing", async () => {
  const { tuneScenario, priceTokens } = await import("../public/engine.js");
  const r = tuneScenario("classification", defaultsFor("classification"), cfg, models, models[1], "base",
    { cacheTarget: 0.9, trimPct: 0.3, shortenPct: 0.2 });
  assert.ok(r.optimized.cost.model_eur_month < r.today.cost.model_eur_month);
  const manual = priceTokens(models[1], r.optimized.month, r.today.assumptions.batch_factor);
  assert.ok(Math.abs(manual - r.optimized.cost.model_usd_month) < 0.05);
});

test("tuneScenario: agent-depth cap re-runs the real quadratic step formula, not a linear approximation", async () => {
  const { tuneScenario } = await import("../public/engine.js");
  const p = { ...defaultsFor("agentic"), steps: 10 };
  const r = tuneScenario("agentic", p, cfg, models, models[1], "base", { agentDepth: 3 });
  assert.equal(r.steps_capped, 3);
  assert.ok(r.today.month.output > r.optimized.month.output * 2); // fewer steps costs much less than proportionally, since context growth is quadratic
});
