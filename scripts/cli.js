#!/usr/bin/env node
// CLI: node scripts/cli.js <archetype> [--set key=value ...] [--models models.json] [--name "Use case"] [--out dir]
// Prints the base-scenario summary and writes bom.json + architecture.md (for the Azure estimator).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { compute, defaultsFor, toBomJson, toArchitectureMarkdown, ARCHETYPES } from "../public/engine.js";

const args = process.argv.slice(2);
const archetype = args[0];
if (!archetype || !ARCHETYPES[archetype]) {
  console.error(`Usage: cli.js <${Object.keys(ARCHETYPES).join("|")}> [--set key=value] [--models file.json] [--name "…"] [--out dir]`);
  process.exit(1);
}
const opt = { set: {}, models: null, name: "", out: "out" };
for (let i = 1; i < args.length; i++) {
  const a = args[i];
  if (a === "--set") { const [k, v] = args[++i].split("="); opt.set[k] = v === "true" ? true : v === "false" ? false : isNaN(+v) ? v : +v; }
  else if (a === "--models") opt.models = args[++i];
  else if (a === "--name") opt.name = args[++i];
  else if (a === "--out") opt.out = args[++i];
}
const cfg = JSON.parse(readFileSync(new URL("../public/config.json", import.meta.url)));
const models = opt.models ? (JSON.parse(readFileSync(opt.models)).models || []) : [];
const params = { ...defaultsFor(archetype), ...opt.set };
const result = compute(archetype, params, cfg, models);
const b = result.scenarios.base;
const f = n => n == null ? "—" : Math.round(n).toLocaleString("en-US");
console.log(`${result.label} · ${result.bigT}`);
console.log(`per ${result.unit}: in ${f(b.per_unit.input)} / out ${f(b.per_unit.output)} / cacheable ${f(b.per_unit.cacheable)} tokens`);
for (const s of ["low", "base", "high"]) {
  const r = result.scenarios[s];
  console.log(`${s.padEnd(5)} month: in ${f(r.month.input)} · cached ${f(r.month.cached)} · out ${f(r.month.output)} · model ${r.cost.model_usd_month == null ? "n/a (no model data)" : "$" + f(r.cost.model_usd_month)} · cost/outcome ${r.cost.cost_per_outcome_eur ?? "—"} EUR (baseline ${r.cost.baseline_per_outcome_eur})`);
}
if (b.model.used) console.log(`model: ${b.model.used.name} — ${b.model.selection.note}`);
for (const n of b.notes) console.log(`note: ${n}`);
mkdirSync(opt.out, { recursive: true });
writeFileSync(`${opt.out}/bom.json`, JSON.stringify(toBomJson(result, { name: opt.name }), null, 2));
writeFileSync(`${opt.out}/architecture.md`, toArchitectureMarkdown(result, { name: opt.name }));
console.log(`written ${opt.out}/bom.json and ${opt.out}/architecture.md`);
