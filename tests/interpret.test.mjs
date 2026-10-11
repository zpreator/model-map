import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { interpret } from "../src/interpret.ts";

const rd = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), "utf8"));
const load = (d) => readdirSync(new URL(`../${d}`, import.meta.url)).map((f) => rd(`${d}/${f}`));
const ctx = { lexicon: rd("data/lexicon.json"), models: load("data/models"), problems: load("data/problems") };
const cells = (q) => interpret(q, ctx).steps.map((s) => `${s.input}>${s.output}`);

assert.deepEqual(cells("Transcribe my customer calls and summarize them"), ["audio>text", "text>text"]);
assert.deepEqual(cells("find similar photos"), ["image>embedding"]);
assert.deepEqual(cells("Count the cars in a parking lot"), ["image>boxes_masks"]);
assert.deepEqual(cells("Chat with my documents"), ["text>embedding", "text>text"]);
assert.deepEqual(cells("sort product photos into categories"), ["image>label"]);
assert.deepEqual(cells("Generate a logo from a description"), ["text>image"]);
assert.deepEqual(cells("create a video of a dancing robot"), ["text>video"]);
assert.deepEqual(cells("detect spam in emails"), ["text>label"]); // "detect" cannot outline text, so only the classify step remains
assert.deepEqual(cells("who spoke when in this meeting recording"), ["audio>label"]);
assert.deepEqual(cells("read my blog posts aloud"), ["text>audio"]); // "read" must not add an extra answer step
assert.deepEqual(cells("summarize this video"), ["video>text"]);
assert.deepEqual(cells("transcribe the call and describe the photo"), ["audio>text", "image>text"]);
assert.deepEqual(cells("classify support tickets"), ["text>label"]);
assert.deepEqual(cells("asdf qwer zxcv"), []);
assert.deepEqual(cells(""), []);

// phrasing found by probing
assert.deepEqual(cells("turn meeting recordings into notes with action items"), ["audio>text", "text>text"]); // transcribe first, then answer on text
assert.deepEqual(cells("recognize handwriting in scanned forms"), ["image>text"]);
assert.deepEqual(cells("is this review positive or negative"), ["text>label"]);
assert.deepEqual(cells("generate a short film from a script"), ["text>video"]);
assert.deepEqual(cells("make a podcast voice that sounds like me"), ["text>audio"]);
assert.ok(interpret("predict house prices from a spreadsheet", ctx).notes.length > 0);
assert.equal(interpret("find similar photos", ctx).notes.length, 0);
assert.ok(!interpret("search my pdfs for contract clauses", ctx).mentions.includes("grounding-dino")); // no substring matches

// candidates are real models that cover the pair
const r = interpret("transcribe my calls", ctx);
assert.ok(r.steps[0].modelIds.includes("whisper"));
for (const s of interpret("find similar photos", ctx).steps)
  for (const id of s.modelIds) assert.ok(ctx.models.find((m) => m.id === id).cells.some((c) => c.input === s.input && c.output === s.output));
assert.ok(r.steps[0].modelIds.length <= 8);

// closest preset and word mentions
assert.equal(interpret("chat over my documents", ctx).closestPreset?.id, "chat-over-documents");
assert.equal(interpret("count cars", ctx).closestPreset?.id, "count-cars-in-a-lot");
assert.equal(interpret("xyzzy plugh", ctx).closestPreset, null);
assert.ok(interpret("xtts", ctx).mentions.includes("xtts-v2"));
assert.ok(interpret("anything by openai", ctx).mentions.length > 0);

// suggestions favour current models over old classics, and presets are only suggested when they share a model
const tt = interpret("write a summary of my report", ctx).steps[0].modelIds;
assert.ok(tt.length && tt[0] !== "gpt2", `gpt2 should not lead text->text suggestions: ${tt}`);
assert.notEqual(interpret("turn my meeting recordings into notes and find the action items", ctx).closestPreset?.id, "find-similar-photos");

// evidence is shown to the reader
assert.match(interpret("transcribe my calls", ctx).steps[0].evidence[0], /transcrib/);

// an order of 200 chars of noise must not blow up
assert.doesNotThrow(() => interpret("a ".repeat(500), ctx));
console.log("interpret: all pass");
