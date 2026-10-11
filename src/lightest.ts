import type { Model, Problem, Tier } from "./types";

// Hardware tiers in ascending order. "api" is deliberately not on this scale: it needs no
// hardware but brings cost and data-privacy trade-offs, so it is reported separately.
export const HW_TIERS: Tier[] = ["cpu_edge", "gpu_8gb", "gpu_24gb", "datacenter"];
const hwRank = (t: Tier) => HW_TIERS.indexOf(t);

export type Req = { kind: "hw"; tier: Tier } | { kind: "api" } | { kind: "unknown" };

/** Lightest way to run one model: its smallest hardware tier, else API, else unknown. */
export function modelReq(m: Pick<Model, "tiers">): Req {
  const hw = m.tiers.filter((t) => hwRank(t) >= 0).sort((a, b) => hwRank(a) - hwRank(b));
  if (hw.length) return { kind: "hw", tier: hw[0] };
  return m.tiers.includes("api") ? { kind: "api" } : { kind: "unknown" };
}

/** Lightest option among a step's candidates; a self-hostable candidate beats API-only. */
export function stepReq(candidates: Pick<Model, "tiers">[]): Req {
  const reqs = candidates.map(modelReq);
  const hw = reqs.filter((r): r is Extract<Req, { kind: "hw" }> => r.kind === "hw").sort((a, b) => hwRank(a.tier) - hwRank(b.tier));
  if (hw.length) return hw[0];
  return reqs.some((r) => r.kind === "api") ? { kind: "api" } : { kind: "unknown" };
}

export interface Lightest {
  hw: Tier | null; // highest hardware tier any step needs; null if no step has a known hardware tier
  apiSteps: string[]; // steps where every known candidate is API-only
  unknownSteps: string[]; // steps where no candidate has a known tier
}

/** For each step take its lightest option, then report the highest of those across steps. */
export function lightestSetup(problem: Problem, byId: Map<string, Model>): Lightest {
  const out: Lightest = { hw: null, apiSteps: [], unknownSteps: [] };
  for (const step of problem.steps) {
    const r = stepReq(step.models.map((id) => byId.get(id)).filter((m): m is Model => !!m));
    if (r.kind === "hw") {
      if (out.hw === null || hwRank(r.tier) > hwRank(out.hw)) out.hw = r.tier;
    } else if (r.kind === "api") out.apiSteps.push(step.label);
    else out.unknownSteps.push(step.label);
  }
  return out;
}

/** Hardware filter: show only models that run on this tier or lighter. API-only and unknown sizes are opt-in. */
export interface Fit { tier: Tier | null; api: boolean; unknown: boolean }
export const NO_FIT: Fit = { tier: null, api: false, unknown: false };

/** Does the model fit? "Fit" means its lightest option is at or below the chosen tier. */
export function fitsWithin(m: Pick<Model, "tiers">, fit: Fit): boolean {
  if (!fit.tier) return true;
  const r = modelReq(m);
  if (r.kind === "hw") return hwRank(r.tier) <= hwRank(fit.tier);
  return r.kind === "api" ? fit.api : fit.unknown;
}
