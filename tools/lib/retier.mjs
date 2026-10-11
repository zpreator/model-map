// Shared by the weekly job and tools/retier.mjs: recompute a model's tier from its Hub files.
import { autoNote, estimateTier, unknownReason, weightBytes } from "./discover-core.mjs";

/** Returns { patch, weight } for an entry backed by a Hub repo. `hubJson(path)` fetches Hub API JSON. */
export async function computeTier(m, hubJson, params) {
  let files = null;
  try { files = await hubJson(`/api/models/${m.hf_repo}/tree/main`); } catch { /* gated or unavailable */ }
  if (params == null) {
    try { params = (await hubJson(`/api/models/${m.hf_repo}?expand[]=safetensors`)).safetensors?.total ?? null; } catch { /* no parameter count */ }
  }
  const w = weightBytes(files, params ?? null);
  const tier = estimateTier(w.bytes);
  const patch = { tiers: tier ? [tier] : [], tier_note: tier ? null : unknownReason(files) };
  if (m.notes?.startsWith("Auto-proposed")) patch.notes = autoNote(w);
  return { patch, weight: w };
}

/** Merge a patch into an entry; a null tier_note removes the key rather than storing null everywhere. */
export function applyPatch(m, patch) {
  const next = { ...m, ...patch };
  if (next.tier_note == null) delete next.tier_note;
  return next;
}
