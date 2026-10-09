import assert from "node:assert/strict";
import { draftModel, estimateTier, isDerived, keepCandidate, normalizeDecision, slugify, cardExcerpt } from "../tools/lib/discover-core.mjs";
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
console.log("discover: all pass");
