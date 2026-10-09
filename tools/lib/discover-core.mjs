// Pure helpers for tools/discover.mjs (kept side-effect free so they can be unit tested).

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

/** Rough tier from parameter count at ~2 bytes/param (16-bit weights). Mirrors the methodology page. */
export function estimateTier(params) {
  if (!params) return null;
  if (params <= 1e9) return "cpu_edge";
  if (params <= 4e9) return "gpu_8gb";
  if (params <= 12e9) return "gpu_24gb";
  return "datacenter";
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
export function draftModel({ hf, familyId, cells, taskIds, now = new Date() }) {
  const repo = hf.id;
  const params = hf.safetensors?.total ?? null;
  const tier = estimateTier(params);
  const notes = [
    "Auto-proposed by the weekly discovery job; unreviewed.",
    tier ? `Tier estimated from ${fmtParams(params)} parameters.` : "Tier unknown: the Hub reports no parameter count.",
  ].join(" ");
  return {
    id: slugify(repo.split("/")[1]),
    name: repo.split("/")[1],
    family: familyId,
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
