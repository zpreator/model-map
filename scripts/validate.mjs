// Validates data/ against schema/ and checks cross-references JSON Schema can't express.
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { readFileSync, readdirSync } from "node:fs";
import { basename } from "node:path";

const read = (p) => JSON.parse(readFileSync(p, "utf8"));
const ajv = new Ajv2020({ allErrors: true });
addFormats(ajv);
const vModel = ajv.compile(read("schema/model.schema.json"));
const vFamily = ajv.compile(read("schema/family.schema.json"));
const vProblem = ajv.compile(read("schema/problem.schema.json"));
const vLexicon = ajv.compile(read("schema/lexicon.schema.json"));

const errors = [];
const badSummary = (s) => (/https?:\/\/|www\.|<[^>]+>|\]\(|[`*_]{2}/.test(s) ? "contains a URL or markup" : null);
const err = (file, msg) => errors.push(`${file}: ${msg}`);
const load = (dir) =>
  readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => ({ file: `${dir}/${f}`, data: read(`${dir}/${f}`) }));

const tasks = new Set(read("data/tasks.json").map((t) => t.id));
const models = load("data/models");
const families = load("data/families");
const problems = load("data/problems");
const ids = new Set();

for (const { file, data } of models) {
  if (!vModel(data)) for (const e of vModel.errors) err(file, `${e.instancePath || "/"} ${e.message}`);
  if (data.id !== basename(file, ".json")) err(file, `id "${data.id}" must match filename`);
  if (ids.has(data.id)) err(file, `duplicate id "${data.id}"`);
  ids.add(data.id);
  if (data.summary) { const bad = badSummary(data.summary); if (bad) err(file, `summary ${bad}`); if (!data.summary_source) err(file, "summary needs summary_source"); }
  if (data.hf_task && !tasks.has(data.hf_task)) err(file, `unknown hf_task "${data.hf_task}"`);
  if (data.tiers?.includes("api") && data.open_weights === true) err(file, `tier "api" conflicts with open_weights: true`);
}
const fids = new Set();
for (const { file, data } of families) {
  if (!vFamily(data)) for (const e of vFamily.errors) err(file, `${e.instancePath || "/"} ${e.message}`);
  if (data.id !== basename(file, ".json")) err(file, `id "${data.id}" must match filename`);
  if (data.summary) { const bad = badSummary(data.summary); if (bad) err(file, `summary ${bad}`); if (!data.summary_source) err(file, "summary needs summary_source"); }
  fids.add(data.id);
}
const used = new Set();
for (const { file, data } of models) {
  if (!fids.has(data.family)) err(file, `unknown family "${data.family}"`);
  used.add(data.family);
}
for (const f of fids) if (!used.has(f)) err(`data/families/${f}.json`, "family has no models");
for (const { file, data } of models) for (const f of data.feeds_into ?? []) if (!ids.has(f)) err(file, `feeds_into unknown model "${f}"`);

const pids = new Set();
for (const { file, data } of problems) {
  if (!vProblem(data)) for (const e of vProblem.errors) err(file, `${e.instancePath || "/"} ${e.message}`);
  if (data.id !== basename(file, ".json")) err(file, `id "${data.id}" must match filename`);
  if (pids.has(data.id)) err(file, `duplicate id "${data.id}"`);
  pids.add(data.id);
  for (const s of data.steps ?? []) for (const m of s.models ?? []) if (!ids.has(m)) err(file, `step "${s.label}" references unknown model "${m}"`);
}

// Lexicon: shape, unique action ids, and every action must resolve to a usable input/output.
const lexicon = read("data/lexicon.json");
if (!vLexicon(lexicon)) for (const e of vLexicon.errors) err("data/lexicon.json", `${e.instancePath || "/"} ${e.message}`);
else {
  const aids = new Set();
  for (const a of lexicon.actions) {
    if (aids.has(a.id)) err("data/lexicon.json", `duplicate action id "${a.id}"`);
    aids.add(a.id);
    if (!a.steps && !a.out) err("data/lexicon.json", `action "${a.id}" needs "out" or "steps"`);
    if (!a.steps && !a.in && !a.default_in) err("data/lexicon.json", `action "${a.id}" needs "in" or "default_in"`);
  }
}

if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
console.log(`OK: ${models.length} models, ${families.length} families, ${problems.length} problems, ${tasks.size} tasks`);
