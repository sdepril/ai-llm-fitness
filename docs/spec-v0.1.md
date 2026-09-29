# AI Use-Case Capture → BOM — rekenlogica (spec v0.1)

**Doel.** Een klant beschrijft een AI-use case; de tool vertaalt dat deterministisch naar (1) een tokenprofiel, (2) een modelklasse, (3) een Big-T-klasse, (4) een BOM voor de Azure estimator en (5) een eerste cost-per-outcome met onzekerheidsband. Dezelfde vragen vormen de intake gate.

**Principes.**
- Rekenen is deterministisch en zichtbaar. Een LLM mag vrije tekst vertalen naar archetype + parameters; de gebruiker bevestigt; daarna alleen formules.
- Elke aanname is een configwaarde met bron en status (`verified` / `to-verify`). Nooit een hardcoded getal.
- Output altijd als low / base / high, nooit één cijfer.
- Geen klantdata opslaan; state in de browser, export als JSON + markdown.

---

## 0. Gemeenschappelijke bouwstenen

### 0.1 Notatie

| Symbool | Betekenis | Eenheid |
|---|---|---|
| `tpw` | tokens per woord | tokens/woord |
| `S` | vaste prompt-overhead (systeemprompt + instructies + schema) | tokens |
| `u` | gebruikersinput per beurt/eenheid | tokens |
| `o` | modeloutput per beurt/eenheid | tokens |
| `h` | cache-hit-aandeel van het cachebare deel (0–1) | – |
| `a` | pogingen per goede outcome (`1 + retry_rate + eval_calls`) | – |
| `q` | succes-aandeel van outputs dat de quality floor haalt (0–1) | – |
| `N_d` | eenheden per dag | – |
| `D` | werkdagen per maand | dagen |
| `p_in`, `p_out`, `p_cached` | prijs per 1M tokens (input / output / cached input) | €/1M |
| `W` | bruikbaar contextvenster van het model | tokens |

### 0.2 Kernformules (gelden voor elk archetype)

```
tokens_in_maand      = N_d × D × a × tokens_in_per_eenheid
tokens_out_maand     = N_d × D × a × tokens_out_per_eenheid
tokens_cached_maand  = h × cachebaar_deel_per_eenheid × N_d × D × a
tokens_in_betaald    = tokens_in_maand − tokens_cached_maand

modelkost_maand      = (tokens_in_betaald × p_in + tokens_cached_maand × p_cached + tokens_out_maand × p_out) / 1e6
                        × batch_factor                      (0.5 bij Batch API, anders 1 — to-verify per provider)

outcomes_maand       = N_d × D × q
cost_per_outcome     = (modelkost_maand + infra_maand + labor_maand_geamortiseerd) / outcomes_maand
```

`a` staat op de tokens (elke poging kost tokens), `q` staat op de noemer (alleen geslaagde outputs tellen). Dat zijn twee verschillende dingen; ze samenvoegen is de klassieke fout.

### 0.3 Onzekerheidsband

Low / base / high door drie factoren tegelijk te variëren:

| Factor | low | base | high |
|---|---|---|---|
| `tpw` | ×0.9 | ×1.0 | ×1.25 |
| `a` | 1.0 | config | config × 1.5 |
| `h` | config + 0.2 (cap 0.95) | config | config − 0.2 (floor 0) |
| agentic `s` (stappen) | ×0.7 | ×1.0 | ×2.0 |

### 0.4 Modelklasse-selectie

Input uit intake: quality bar (laag / midden / hoog), benodigde context (`max tokens_in_per_eenheid` + marge 20%), latency-eis (batch / achtergrond / interactief), modaliteit.

```
kandidaten = modellen waarvoor:
    kwaliteitsindex ≥ drempel(quality_bar)          (Artificial Analysis-index; drempels in config)
    contextvenster ≥ benodigde context × 1.2
    tokens/sec ≥ drempel(latency_eis)  (enkel interactief)
    modaliteit ⊇ vereiste modaliteit
aanbevolen = goedkoopste kandidaat op gewogen prijs (p_in × aandeel_in + p_out × aandeel_out)
```

Toon ook het duurste "default"-model ernaast: het verschil is het rightsizing-argument.

### 0.5 PAYG vs. provisioned throughput (enkel signaleren, niet beslissen)

```
signaal_PTU = tokens_maand_base ≥ ptu_breakeven_tokens  EN  variatie_dag < ptu_max_variatie
```
Tool toont enkel "overweeg PTU in Run-fase"; de beslissing volgt de commitment-policy (pas op gemeten baseline).

---

## 1. Archetype: Documentverwerking (extractie / samenvatting)

**Eenheid:** document. **Big-T:** T(n).

### Intake-vragen
1. Documenten per dag `N_d`; batch of realtime?
2. Pagina's per document `P`; woorden per pagina `wpp` (default per documenttype, zie config)
3. Bron: digitale tekst of scan (→ OCR-component)
4. Output: **extractie** (aantal velden `F`) of **samenvatting** (doelwoorden `o_w`) of beide
5. Taal (bepaalt `tpw`)
6. Quality floor: wat is een geslaagde output, wie keurt af, verwacht afkeurpercentage → `q`, `retry_rate`
7. Baseline: hoeveel minuten manueel per document × uurtarief

### Formules
```
tokens_doc          = P × wpp × tpw
tokens_in_eenheid   = S + tokens_doc                          (als tokens_doc + S + o ≤ W)

# Chunking als het document niet in het venster past (map-reduce):
chunks              = ceil(tokens_doc / (W − S − o_chunk))
tokens_in_eenheid   = chunks × (S + tokens_doc / chunks) + (S + chunks × o_chunk)     # map + reduce
tokens_out_eenheid  = chunks × o_chunk + o                                            # tussenoutputs + eindoutput

o (extractie)       = F × tokens_per_veld                     (JSON: ~15 tokens/veld — to-verify)
o (samenvatting)    = o_w × tpw
cachebaar_deel      = S                                       (systeemprompt/schema; het document zelf niet)
```

### BOM
| Component | Sizing | Conditie |
|---|---|---|
| Modeldeployment (PAYG) | tokens_in/out/cached per maand | altijd |
| Batch API | `batch_factor` | als batch toegestaan (SLA > 1u) |
| Document Intelligence / OCR | `N_d × D × P` pagina's/maand | als bron = scan |
| Blob Storage | `N_d × D × avg_size_MB` GB/maand, retentie | altijd |
| Compute (Functions consumption of Container Apps) | `N_d × D` executies × gem. looptijd | altijd |
| Log Analytics | `N_d × D × log_KB` | altijd |
| API Management / gateway | requests/maand | als gedeelde endpoints (identiteit per use case) |
| Eval-calls | `eval_fraction × N_d × D` extra modelcalls | als geautomatiseerde kwaliteitscheck |

---

## 2. Archetype: Assistent / chat (optioneel met kennisbron)

**Eenheid:** conversatie. **Big-T:** T(n·k) — k = beurten.

### Intake-vragen
1. Conversaties per dag `N_d`; beurten per conversatie `t`
2. Gebruikersinput per beurt `u_w` woorden; antwoord per beurt `o_w` woorden
3. Systeemprompt-grootte `S` (incl. instructies, persona, tools)
4. Kennisbron? → RAG-parameters (corpusgrootte, chunks `k`, chunkgrootte `c`)
5. Geschiedenis: volledig meegestuurd of getrimd tot `H_max` tokens
6. Latency-eis (interactief → tokens/sec-drempel)
7. Quality floor + baseline (bv. minuten per vraag aan een medewerker)

### Formules
```
u = u_w × tpw ;  o = o_w × tpw
# Elke beurt herbilt systeemprompt + volledige geschiedenis:
tokens_in_conv (volledige geschiedenis) = t × S + Σ_{i=1..t} [ (i−1) × (u + o) + u ]
                                        = t × S + t × u + (u + o) × t × (t − 1) / 2
# Met getrimde geschiedenis: vervang (i−1)×(u+o) door min((i−1)×(u+o), H_max)
tokens_out_conv                          = t × o
cachebaar_deel                           = t × S                 (systeemprompt is cachebaar; geschiedenis deels — conservatief: enkel S)

# RAG-toeslag per beurt:
tokens_in_conv += t × (k × c)                                     # opgehaalde chunks
embedding_tokens_maand = N_d × D × t × u                          # query-embedding (apart, goedkoop model)
```

De kwadratische term `t(t−1)/2 × (u+o)` is de reden dat lange gesprekken onevenredig duur zijn — toon hem apart in de UI.

### BOM
| Component | Sizing | Conditie |
|---|---|---|
| Modeldeployment | tokens per maand | altijd |
| Embeddings-model | `embedding_tokens_maand` + eenmalige corpus-embedding | RAG |
| AI Search / vector store | index-GB ≈ chunks × (dims × 4 B + tekst); tier op corpus en QPS | RAG |
| App Service / Container Apps | gelijktijdige sessies (piek = `N_d × t / uren × pieksfactor`) | altijd |
| API Management | requests = `N_d × D × t` | gedeeld endpoint |
| Log Analytics | per request | altijd |
| Guardrail-calls | `guardrail_fraction × requests` extra modelcalls (klein model) | als moderatie/validatie |

---

## 3. Archetype: RAG / vraag-antwoord op een corpus

**Eenheid:** vraag. **Big-T:** T(n·k) — k = chunks.

### Intake-vragen
Vragen per dag `N_d`; corpusgrootte (documenten × pagina's); chunkgrootte `c`, chunks per antwoord `k`; herindexeringsfrequentie `r` (aandeel corpus per maand); vraag `u_w`, antwoord `o_w`; quality floor (groundedness); baseline.

### Formules
```
tokens_in_vraag     = S + u + k × c
tokens_out_vraag    = o
cachebaar_deel      = S
corpus_tokens       = docs × P × wpp × tpw
embedding_eenmalig  = corpus_tokens
embedding_maand     = N_d × D × u + r × corpus_tokens
```
BOM = assistent-BOM zonder sessie-compute maar met batch-embedding-job voor de corpus.

---

## 4. Archetype: Agentic workflow

**Eenheid:** taak. **Big-T:** T(n·k·a) — k = calls per taak, a = agentdiepte.

### Intake-vragen
Taken per dag `N_d`; stappen per taak `s` (planner-iteraties); tools per stap `m`; gemiddelde toolresultaat `r_tok` tokens; sub-agents `d` (diepte); retry-rate; harde stop (max stappen / max tokens per taak — **verplicht veld**); mens-in-de-loop?; quality floor; baseline.

### Formules
```
# Context groeit per stap: elke stap ziet S + alle vorige stap-outputs + toolresultaten
tokens_in_taak  = Σ_{i=1..s} [ S + (i−1) × (o_step + m × r_tok) ]
                = s × S + (o_step + m × r_tok) × s × (s − 1) / 2
tokens_out_taak = s × o_step
# Sub-agents: vermenigvuldig met (1 + d × sub_fraction) — sub_fraction = aandeel stappen dat delegeert
cachebaar_deel  = s × S
cap_per_taak    = max_tokens_per_taak                                (uit intake; tool toont % taken dat de cap raakt bij high)
```

Onzekerheidsband hier standaard breder (zie 0.3). Zonder harde stop geeft de tool geen high-scenario maar een waarschuwing: "T(∞) — kost is niet begrensd".

### BOM
Modeldeployment (vaak 2: planner-model hoog, worker-model laag); gateway met per-taak-identiteit en token-budget; orchestratie (Container Apps / Durable Functions); queue; monitoring met trace per taak; eval-calls.

---

## 5. Archetype: Classificatie / batchverwerking

**Eenheid:** item. **Big-T:** T(n).

```
tokens_in_item  = S + item_tokens          (S bevat de labelset / few-shot voorbeelden → groot cachebaar deel)
tokens_out_item = label_tokens             (~5–20)
cachebaar_deel  = S ; h typisch hoog
batch_factor    = 0.5 als batch-window ≥ 24u (to-verify)
```
BOM: klein model, Batch API, storage, Functions, Log Analytics. Signaal: als volume > drempel, overweeg een fine-tuned klein model of klassieke ML (buiten scope tool, wel melden).

---

## 6. Config: defaults met bron en status

| Parameter | Default | Bron / opmerking | Status |
|---|---|---|---|
| `tpw` Engels | 1.33 | vuistregel 1 token ≈ 0.75 woord (OpenAI) | to-verify met tiktoken op eigen sample |
| `tpw` Nederlands | 1.8 | subword-tokenisers splitsen NL zwaarder; ordegrootte | **to-verify** — meet op 10 klantdocumenten |
| `wpp` (A4 lopende tekst) | 500 | conventie | ok als default, per documenttype overschrijfbaar |
| `wpp` (contract / juridisch) | 600 | dichter gezet | to-verify |
| `S` assistent | 800 | typische systeemprompt + instructies | invoerveld, geen default vertrouwen |
| `tokens_per_veld` (JSON-extractie) | 15 | key + waarde + syntax | to-verify |
| `o_chunk` (map-reduce tussenoutput) | 300 | – | to-verify |
| `retry_rate` | 0.15 | – | per use case invullen |
| `eval_fraction` | 0.10 | – | per use case invullen |
| `h` systeemprompt | 0.7 | vereist stabiele prefix ≥ min. cachelengte van provider | to-verify per provider |
| `p_cached / p_in` | 0.5 | providers geven ~50–90% korting op cached input; verschilt | **to-verify per provider en model** |
| `batch_factor` | 0.5 | Batch API ~50% korting | to-verify per provider |
| `D` | 22 | werkdagen | ok |
| `q` | 0.85 | – | per use case; is de quality-floor-vraag |
| AA-kwaliteitsdrempels | laag 40 / midden 55 / hoog 70 | Artificial Analysis Intelligence Index; schaal verandert per versie | to-verify bij elke AA-refresh |
| `ptu_breakeven_tokens` | config | uit PTU-break-even-calculator | koppelen |
| Vector index bytes/chunk | dims × 4 B + tekst | 1536 dims → ~6 KB + tekst | ok |

**Prijzen** (`p_in`, `p_out`, `p_cached`) komen nooit uit deze tabel maar uit de AI Analytics MCP (modelprijzen) en de Azure Pricing MCP (infra), met datum. Lijstprijs; EA/MACC-korting en onderhandelde tarieven als aparte factor in de ledger, niet in de tool.

---

## 7. BOM-uitvoerformaat

```json
{
  "use_case": { "name": "", "archetype": "document-processing", "outcome_unit": "verwerkt contract",
                "count_source": "DMS-status 'reviewed'", "quality_floor": "…", "bigT": "T(n)" },
  "assumptions": { "tpw": 1.8, "wpp": 600, "a": 1.25, "h": 0.7, "q": 0.85, "D": 22 },
  "token_profile_month": { "input": 0, "cached_input": 0, "output": 0, "scenario": "base" },
  "model": { "quality_bar": "hoog", "recommended": "", "default_alternative": "", "context_needed": 0, "latency": "batch" },
  "bom": [
    { "component": "Azure OpenAI deployment", "role": "inference", "sku_hint": "PAYG", "quantity": 0, "unit": "1M tokens (in/cached/out)", "source": "token_profile" },
    { "component": "Blob Storage", "role": "document store", "sku_hint": "Hot LRS", "quantity": 0, "unit": "GB-month", "source": "N_d × D × avg_size" },
    { "component": "Azure Functions", "role": "orchestration", "sku_hint": "Consumption", "quantity": 0, "unit": "executions", "source": "N_d × D" },
    { "component": "Log Analytics", "role": "observability", "sku_hint": "PAYG", "quantity": 0, "unit": "GB", "source": "requests × log_KB" }
  ],
  "cost_per_outcome": { "low": 0, "base": 0, "high": 0, "baseline": null, "currency": "EUR" },
  "generated": "2026-09-29", "spec_version": "0.1"
}
```

De markdown-versie ernaast is wat de Azure estimator-skill als architectuurdocument inleest.

---

## 8. Open punten om te challengen

1. `tpw` Nederlands: meten vóór er één klant een getal ziet.
2. Cache-korting en batch-korting verschillen per provider en per model — moet uit de MCP komen, niet uit config.
3. Assistent-geschiedenis: volledige herbilling is worst case; de meeste frameworks trimmen. Default `H_max` invoeren of altijd beide tonen?
4. Agentic: is een verplichte harde stop in de intake haalbaar bij klanten, of tonen we T(∞) als rood scenario?
5. Labor: als aparte lijn in de ledger (uren × tarief per fase) of buiten de tool laten? Voorstel: invoerveld, geen berekening.
6. Welke archetypes ontbreken voor jullie klanten: code-assistent, spraak/vision, synthetische data?
