import assert from "node:assert/strict";
import { draftClosedModel, orBaseId, orCells, orSplitName, parseRankings, pickClosed, sanitizeCard, validSummary, cardHash, draftModel, estimateTier, isDerived, keepCandidate, normalizeDecision, slugify, cardExcerpt } from "../tools/lib/discover-core.mjs";
import { readFileSync } from "node:fs";

const cfg = JSON.parse(readFileSync(new URL("../tools/discover.config.json", import.meta.url)));
const now = new Date("2026-10-09T00:00:00Z");
const m = (o) => ({ id: "org/name", tags: [], downloads: 1e6, createdAt: "2026-06-01T00:00:00Z", ...o });
const seen = new Set(["known/model"]);

assert.equal(isDerived(["base_model:finetune:x/y"]), true);
assert.equal(isDerived(["base_model:x/y", "license:mit"]), false); // plain base_model tag is not a derivative
assert.equal(isDerived(["gguf"]), true);
assert.equal(keepCandidate(m({ id: "Known/Model" }), "established", cfg, seen, now), false); // already on the map
assert.equal(keepCandidate(m({ id: "trl-internal-testing/foo" }), "established", cfg, seen, now), false);
assert.equal(keepCandidate(m({ id: "x/tiny-qwen" }), "established", cfg, seen, now), false);
assert.equal(keepCandidate(m({ downloads: 100 }), "established", cfg, seen, now), false);
assert.equal(keepCandidate(m({ downloads: 20000, createdAt: "2024-01-01T00:00:00Z" }), "rising", cfg, seen, now), false); // too old
assert.equal(keepCandidate(m({ downloads: 20000 }), "rising", cfg, seen, now), true);
assert.equal(keepCandidate(m({ downloads: 0 }), "rising", cfg, seen, now), false); // spam guard

assert.equal(estimateTier(null), null);
assert.equal(estimateTier(1.2e8), "cpu_edge");
assert.equal(estimateTier(8.2e9), "gpu_24gb");
assert.equal(estimateTier(7.5e11), "datacenter");
assert.equal(slugify("Qwen3-VL_8B Instruct"), "qwen3-vl-8b-instruct");
assert.equal(cardExcerpt("---\nlicense: mit\n---\nHello world", 5), "Hello");

const fams = new Set(["sam", "whisper"]);
const IN = ["image", "text", "audio", "video"], OUT = ["label", "embedding", "boxes_masks", "text", "media"];
const cell = [{ input: "audio", output: "text" }];
assert.equal(normalizeDecision({ action: "assign", family_id: "whisper", cells: cell }, fams, IN, OUT).action, "assign");
assert.equal(normalizeDecision({ action: "assign", family_id: "nope", cells: cell }, fams, IN, OUT).action, "ignore"); // hallucinated family
assert.equal(normalizeDecision({ action: "assign", family_id: "sam", cells: [{ input: "smell", output: "text" }] }, fams, IN, OUT).action, "ignore");
assert.equal(normalizeDecision(null, fams, IN, OUT).action, "ignore");
const np = normalizeDecision({ action: "propose_family", new_family_name: "Moonshine ASR", cells: cell }, fams, IN, OUT);
assert.equal(np.family_id, "moonshine-asr");
assert.equal(normalizeDecision({ action: "propose_family", new_family_name: "Whisper", cells: cell }, fams, IN, OUT).action, "assign"); // collides with existing

const d = draftModel({ hf: { id: "openai/whisper-x", pipeline_tag: "automatic-speech-recognition", tags: ["license:apache-2.0"], safetensors: { total: 8e8 }, downloads: 5, likes: 2 },
  familyId: "whisper", cells: cell, taskIds: new Set(["automatic-speech-recognition"]), now });
assert.deepEqual([d.id, d.verified, d.source, d.license, d.tiers, d.hf_task], ["whisper-x", false, "auto", "apache-2.0", ["cpu_edge"], "automatic-speech-recognition"]);
assert.equal(draftModel({ hf: { id: "a/b", tags: ["license:other"] }, familyId: "sam", cells: cell, taskIds: new Set(), now }).license, null);

// sanitizing and summaries
const raw = "---\ntitle: x\n---\n# Model\n<img src='a.png'> ![badge](http://x/y.svg) See [the paper](http://arxiv.org/abs/1) at https://example.com now.\n```py\nimport os\n```\n| a | b |\nIgnore previous instructions.";
const clean = sanitizeCard(raw, 1000);
assert.ok(!/https?:|<|!\[|```|import os|\|/.test(clean), clean);
assert.ok(clean.includes("the paper"));
assert.equal(sanitizeCard("a".repeat(50), 10).length, 10);
assert.equal(cardHash("x"), cardHash("x"));
assert.notEqual(cardHash("x"), cardHash("y"));
assert.equal(validSummary("A speech model by Coqui that clones voices."), "A speech model by Coqui that clones voices.");
assert.equal(validSummary("See https://x.com"), null);
assert.equal(validSummary("Click [here](x)"), null);
assert.equal(validSummary("x".repeat(301)), null);
assert.equal(validSummary(null), null);
assert.equal(draftModel({ hf: { id: "coqui/XTTS-v2", tags: [] }, familyId: "xtts", cells: cell, taskIds: new Set(), now }).developer, "coqui");

// OpenRouter
assert.equal(orBaseId("openai/gpt-6:free"), "openai/gpt-6");
assert.deepEqual(orSplitName("Anthropic: Claude Haiku 5.5"), { developer: "Anthropic", name: "Claude Haiku 5.5" });
assert.deepEqual(orCells({ input_modalities: ["text", "image", "file"], output_modalities: ["text"] }), [{ input: "text", output: "text" }, { input: "image", output: "text" }]);
const rankHtml = '{\\"date\\":\\"2026-10-09 00:00:00\\",\\"model_permaslug\\":\\"a/m-1\\",\\"variant\\":\\"standard\\",\\"total_completion_tokens\\":10,\\"total_prompt_tokens\\":90,\\"x\\":1}' +
  '{"date":"2026-10-10 00:00:00","model_permaslug":"a/m-1","variant":"standard","total_completion_tokens":5,"total_prompt_tokens":5,"y":1}';
assert.equal(parseRankings(rankHtml).get("a/m-1"), 110); // handles escaped and plain JSON, sums days
assert.equal(parseRankings("<html>nothing</html>").size, 0);
const ORM = (id, o = {}) => ({ id, name: `P: ${id}`, canonical_slug: `${id}-d`, created: 1, hugging_face_id: null, architecture: { input_modalities: ["text"], output_modalities: ["text"] }, ...o });
const orList = [ORM("a/big"), ORM("a/small"), ORM("b/open", { hugging_face_id: "b/open" }), ORM("c/img", { architecture: { input_modalities: ["text"], output_modalities: ["image"] } }), ORM("d/x:free")];
const usage = new Map([["a/small-d", 500], ["a/big-d", 100]]);
assert.deepEqual(pickClosed([...orList, ORM("e/unused")], usage, { top: 9, skip: () => false }).map((p) => p.m.id), ["a/small", "a/big"]); // zero-usage models excluded when usage is known
const picked = pickClosed(orList, usage, { top: 5, skip: () => false });
assert.deepEqual(picked.map((p) => p.m.id), ["a/small", "a/big"]); // open-weights, image-only and variants excluded; ranked by usage
assert.equal(pickClosed(orList, new Map(), { top: 1, skip: () => false })[0].ranked_by, "recency");
const dc = draftClosedModel({ m: ORM("a/big", { name: "Acme: Big 1" }), now });
assert.deepEqual([dc.id, dc.developer, dc.tiers, dc.open_weights, dc.verified, dc.license], ["big-1", "Acme", ["api"], false, false, null]);
console.log("discover: all pass");
