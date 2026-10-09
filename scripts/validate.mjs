// Validates data/ against schema/ and checks cross-references JSON Schema can't express.
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { readFileSync, readdirSync } from "node:fs";
import { basename } from "node:path";

const read = (p) => JSON.parse(readFileSync(p, "utf8"));
const ajv = new Ajv2020({ allErrors: true });
addFormats(ajv);
const vModel = ajv.compile(read("schema/model.schema.json"));
const vProblem = ajv.compile(read("schema/problem.schema.json"));

const errors = [];
const err = (file, msg) => errors.push(`${file}: ${msg}`);
const load = (dir) =>
  readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => ({ file: `${dir}/${f}`, data: read(`${dir}/${f}`) }));

const tasks = new Set(read("data/tasks.json").map((t) => t.id));
const models = load("data/models");
const problems = load("data/problems");
const ids = new Set();

for (const { file, data } of models) {
  if (!vModel(data)) for (const e of vModel.errors) err(file, `${e.instancePath || "/"} ${e.message}`);
  if (data.id !== basename(file, ".json")) err(file, `id "${data.id}" must match filename`);
  if (ids.has(data.id)) err(file, `duplicate id "${data.id}"`);
  ids.add(data.id);
  if (data.hf_task && !tasks.has(data.hf_task)) err(file, `unknown hf_task "${data.hf_task}"`);
  if (data.tiers?.includes("api") && data.open_weights === true) err(file, `tier "api" conflicts with open_weights: true`);
}
for (const { file, data } of models) for (const f of data.feeds_into ?? []) if (!ids.has(f)) err(file, `feeds_into unknown model "${f}"`);

const pids = new Set();
for (const { file, data } of problems) {
  if (!vProblem(data)) for (const e of vProblem.errors) err(file, `${e.instancePath || "/"} ${e.message}`);
  if (data.id !== basename(file, ".json")) err(file, `id "${data.id}" must match filename`);
  if (pids.has(data.id)) err(file, `duplicate id "${data.id}"`);
  pids.add(data.id);
  for (const s of data.steps ?? []) for (const m of s.models ?? []) if (!ids.has(m)) err(file, `step "${s.label}" references unknown model "${m}"`);
}

if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
console.log(`OK: ${models.length} models, ${problems.length} problems, ${tasks.size} tasks`);
