// Pure helpers for tools/discover.mjs (kept side-effect free so they can be unit tested).
import { createHash } from "node:crypto";

const DERIVED_PREFIXES = ["base_model:finetune", "base_model:quantized", "base_model:merge", "base_model:adapter"];

export const isDerived = (tags = []) => tags.some((t) => DERIVED_PREFIXES.some((p) => t.startsWith(p))) || tags.includes("gguf");

export const ageDays = (createdAt, now = new Date()) => Math.floor((now - new Date(createdAt)) / 86_400_000);

/** Deterministic pre-filter: cheap rules that run before any LLM call. */
export function keepCandidate(m, kind, cfg, seen, now = new Date()) {
  const [org] = m.id.split("/");
  if (seen.has(m.id.toLowerCase())) return false;
  if (isDerived(m.tags)) return false;
  if (cfg.exclude_orgs.includes(org)) return false;
  if (cfg.exclude_name_patterns.some((p) => new RegExp(p, "i").test(m.id.split("/")[1] ?? ""))) return false;
  const dl = m.downloads ?? 0;
  if (kind === "established") return dl >= cfg.established_min_downloads;
  return dl >= cfg.rising_min_downloads && ageDays(m.createdAt, now) <= cfg.rising_max_age_days;
}

/**
 * Rough tier from the size of the weight files on disk. Using real file sizes (not parameter count x 2) keeps
 * quantized releases honest: gpt-oss-20b has 21B parameters but ships as ~14 GB. All weights must be resident, so
 * mixture-of-experts models are judged by total size, not active parameters. Thresholds leave headroom for activations.
 */
export function estimateTier(bytes) {
  if (!bytes) return null;
  if (bytes <= 3e9) return "cpu_edge";
  if (bytes <= 6.5e9) return "gpu_8gb";
  if (bytes <= 20e9) return "gpu_24gb";
  return "datacenter";
}

export const fmtBytes = (b) => (!b ? "unknown" : b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.round(b / 1e6)} MB`);

/**
 * Weight size in bytes from a Hub file listing (top-level .safetensors files); falls back to 16-bit parameters
 * when the repo keeps its weights in subfolders (diffusers layouts) or has none.
 */
export function weightBytes(treeFiles, params) {
  const sum = (treeFiles ?? []).filter((x) => x.type === "file" && x.path.endsWith(".safetensors")).reduce((a, x) => a + (x.lfs?.size ?? x.size ?? 0), 0);
  if (sum > 0) return { bytes: sum, basis: "files" };
  return params ? { bytes: params * 2, basis: "params" } : { bytes: null, basis: null };
}

export const autoNote = ({ bytes, basis }) =>
  `Auto-proposed by the weekly discovery job; unreviewed. ${bytes
    ? `Tier estimated from ${fmtBytes(bytes)} of ${basis === "files" ? "weight files" : "weights (parameters x 2 bytes)"}.`
    : "Tier unknown: no weight size available."}`;

/**
 * Key for "same model, different size or release date": org plus the name with sizes, dates and packaging words
 * removed (gpt-oss-20b and gpt-oss-120b collapse; DeepSeek-V4-Pro and DeepSeek-V4-Flash do not).
 */
export function stemKey(repo) {
  const [org, ...rest] = repo.split("/");
  const name = rest.join("/").toLowerCase();
  const SIZEISH = /(^|[-_.])(\d+(\.\d+)?[kmbt]|a\d+(\.\d+)?[kmbt]|tiny|mini|nano|small|base|medium|large|xl|xxl|\d{4}|\d{6}|instruct|chat|it|fp\d+|bf16|int\d+|awq|gptq|gguf)(?=$|[-_.])/g;
  let stem = name;
  for (let prev; prev !== stem; ) { prev = stem; stem = stem.replace(SIZEISH, "$1"); }
  stem = stem.replace(/[-_.]{2,}/g, "-").replace(/^[-_.]+|[-_.]+$/g, "");
  return `${org.toLowerCase()}/${stem || name}`;
}

export const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

export const licenseFromTags = (tags = []) => {
  const l = tags.find((t) => t.startsWith("license:"))?.slice(8);
  return l && l !== "other" ? l : null; // "other" is never enough on its own; leave it for a human
};

export const fmtParams = (p) => (!p ? "unknown" : p >= 1e9 ? `${(p / 1e9).toFixed(1)}B` : `${Math.round(p / 1e6)}M`);

/** Drop YAML front matter and cap length; the excerpt is untrusted text shown to the model as data. */
export function cardExcerpt(readme, max) {
  const body = readme.replace(/^---\n[\s\S]*?\n---\n/, "").trim();
  return body.slice(0, max);
}

/**
 * Turn a validated decision plus Hub metadata into a model entry. Only classification fields come from the LLM
 * (family, cells); every fact (license, params, tier estimate, task) comes from the Hub API, and the entry
 * is always unverified.
 */
export function draftModel({ hf, familyId, cells, taskIds, weight, now = new Date() }) {
  const repo = hf.id;
  const w = weight ?? weightBytes([], hf.safetensors?.total ?? null);
  const tier = estimateTier(w.bytes);
  const notes = autoNote(w);
  return {
    id: slugify(repo.split("/")[1]),
    name: repo.split("/")[1],
    family: familyId,
    developer: developerFromRepo(repo),
    summary: null, // filled by the summarize step; never by classification
    summary_source: null,
    card_hash: null,
    cells,
    hf_task: taskIds.has(hf.pipeline_tag) ? hf.pipeline_tag : null,
    tiers: tier ? [tier] : [],
    license: licenseFromTags(hf.tags),
    open_weights: true,
    hf_repo: repo,
    links: [{ label: `${repo} on Hugging Face`, url: `https://huggingface.co/${repo}` }],
    feeds_into: [],
    verified: false,
    notes,
    source: "auto",
    metrics: metricsFrom(hf, now),
  };
}

export const metricsFrom = (hf, now = new Date()) => ({
  downloads_30d: hf.downloads ?? null, // the Hub's `downloads` is a trailing 30-day count
  likes: hf.likes ?? null,
  fetched_at: now.toISOString(),
});

/** Validate an LLM decision against the real family list; anything malformed becomes an ignore. */
export function normalizeDecision(d, familyIds, inputs, outputs) {
  const bad = (reason) => ({ action: "ignore", reason: `Invalid model output (${reason}); ignored.`, confidence: "low", cells: [] });
  if (!d) return bad("no parsed output");
  if (d.action === "ignore") return { ...d, cells: [] };
  const cellsOk = d.cells?.length > 0 && d.cells.every((c) => inputs.includes(c.input) && outputs.includes(c.output));
  if (!cellsOk) return bad("cells");
  if (d.action === "assign") return familyIds.has(d.family_id) ? d : bad("unknown family_id");
  if (d.action === "propose_family") {
    if (!d.new_family_name || !slugify(d.new_family_name)) return bad("missing family name");
    const id = slugify(d.new_family_name);
    return familyIds.has(id) ? { ...d, action: "assign", family_id: id } : { ...d, family_id: id };
  }
  return bad("unknown action");
}

// ---- sanitizing and summaries -----------------------------------------------------------------------------

/** Strip markup a model card is full of (HTML, images, badges, code, links, URLs) so the model sees prose. */
export function sanitizeCard(readme, max) {
  const t = readme
    .replace(/^---\n[\s\S]*?\n---\n/, "")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/^\s*\|.*\|\s*$/gm, " ") // tables
    .replace(/[#>*_`~]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return t.slice(0, max);
}

export const cardHash = (text) => createHash("sha1").update(text).digest("hex").slice(0, 12);
export const developerFromRepo = (repo) => repo?.split("/")[0] ?? null;

/** Accept a summary only if it is short plain text; otherwise null (never store markup or links). */
export function validSummary(s) {
  if (typeof s !== "string") return null;
  const t = s.trim().replace(/\s+/g, " ");
  if (!t || t.length > 300) return null;
  if (/https?:\/\/|www\.|<[^>]+>|\]\(|[`*_]{2}/.test(t)) return null;
  return t;
}

// ---- OpenRouter (closed-model source) ---------------------------------------------------------------------

const OR_INPUTS = { text: "text", image: "image", audio: "audio", video: "video" }; // "file" is ignored
const OR_OUTPUTS = { text: "text", image: "image", audio: "audio" };

/** Base model id without a routing variant suffix (":free", ":batch", ":thinking", ...). */
export const orBaseId = (id) => id.split(":")[0];
export const orHasVariant = (id) => id.includes(":");

/** Cells from the listed modalities (every supported input paired with every output). */
export function orCells(arch) {
  const ins = (arch?.input_modalities ?? []).map((m) => OR_INPUTS[m]).filter(Boolean);
  const outs = (arch?.output_modalities ?? []).map((m) => OR_OUTPUTS[m]).filter(Boolean);
  return ins.flatMap((input) => outs.map((output) => ({ input, output })));
}

/** "Anthropic: Claude Haiku 5.5" -> { developer: "Anthropic", name: "Claude Haiku 5.5" } */
export function orSplitName(name) {
  const i = name.indexOf(": ");
  return i > 0 ? { developer: name.slice(0, i), name: name.slice(i + 2) } : { developer: null, name };
}

/**
 * Parse per-model token usage from the embedded data on openrouter.ai/rankings. Undocumented, so it can
 * break: returns an empty Map when the shape changes and the caller falls back to recency.
 */
export function parseRankings(html) {
  const re = /\{\\?"date\\?":\\?"(\d{4}-\d{2}-\d{2})[^"\\]*\\?",\\?"model_permaslug\\?":\\?"([^"\\]+)\\?",\\?"variant\\?":\\?"([^"\\]+)\\?",\\?"total_completion_tokens\\?":(\d+),\\?"total_prompt_tokens\\?":(\d+)/g;
  const usage = new Map();
  for (let m; (m = re.exec(html)); ) usage.set(m[2], (usage.get(m[2]) ?? 0) + Number(m[4]) + Number(m[5]));
  return usage;
}

/**
 * Closed LLM candidates: models without Hub weights that produce text, ranked by observed usage
 * (falling back to release date when no usage data is available).
 */
export function pickClosed(orModels, usage, { top, skip }) {
  const rows = orModels
    .filter((m) => !orHasVariant(m.id) && !m.hugging_face_id && (m.architecture?.output_modalities ?? []).includes("text") && !skip(m))
    .map((m) => ({ m, tokens: usage.get(m.canonical_slug) ?? 0 }));
  const haveUsage = rows.some((r) => r.tokens > 0);
  // With usage data, only models people actually use qualify; newcomers appear once they show up in the rankings.
  const pool = haveUsage ? rows.filter((r) => r.tokens > 0) : rows;
  pool.sort((a, b) => (haveUsage ? b.tokens - a.tokens : b.m.created - a.m.created));
  return pool.slice(0, top).map((r) => ({ ...r, ranked_by: haveUsage ? "usage" : "recency" }));
}

export function draftClosedModel({ m, familyId = "closed-llm", now = new Date() }) {
  const { developer, name } = orSplitName(m.name);
  return {
    id: slugify(name),
    name,
    family: familyId,
    developer,
    summary: null,
    summary_source: null,
    card_hash: null,
    cells: orCells(m.architecture),
    hf_task: null,
    tiers: ["api"],
    license: null,
    open_weights: false,
    hf_repo: null,
    links: [{ label: "OpenRouter model page", url: `https://openrouter.ai/${m.id}` }],
    feeds_into: [],
    verified: false,
    notes: "Auto-proposed by the weekly discovery job from OpenRouter's catalogue; unreviewed. Proprietary: license unknown, weights not public.",
    source: "auto",
    metrics: null,
  };
}
