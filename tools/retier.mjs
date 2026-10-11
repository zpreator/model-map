#!/usr/bin/env node
// Recompute tiers from Hub weight files.
//   node tools/retier.mjs                  machine-added (source: auto), unverified entries
//   node tools/retier.mjs --ids=bge,yolo11 also these entries, even if hand-curated (never verified ones)
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { applyPatch, computeTier } from "./lib/retier.mjs";

const ids = new Set((process.argv.find((a) => a.startsWith("--ids="))?.slice(6) ?? "").split(",").filter(Boolean));
const headers = process.env.HF_TOKEN ? { Authorization: `Bearer ${process.env.HF_TOKEN}` } : {};
const hubJson = async (p) => { const r = await fetch(`https://huggingface.co${p}`, { headers }); if (!r.ok) throw new Error(String(r.status)); return r.json(); };

for (const f of readdirSync("data/models")) {
  const path = `data/models/${f}`, m = JSON.parse(readFileSync(path, "utf8"));
  if (!m.hf_repo || m.verified || !(m.source === "auto" || ids.has(m.id))) continue;
  const { patch } = await computeTier(m, hubJson, null);
  const next = applyPatch(m, patch);
  if (JSON.stringify(next) === JSON.stringify(m)) continue;
  console.log(`${m.id}: ${JSON.stringify(m.tiers)} -> ${JSON.stringify(next.tiers)}${next.tier_note ? ` (${next.tier_note})` : ""}`);
  writeFileSync(path, JSON.stringify(next, null, 2) + "\n");
}
