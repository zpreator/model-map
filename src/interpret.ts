// Turns a free-text problem statement into steps and candidate models. No AI and no network: it matches words
// against data/lexicon.json (verbs -> what the step does, nouns -> input type) and then looks up which models on the
// map cover that input -> output pair. It is deliberately simple and says what it matched, so a wrong reading is
// visible rather than hidden.
import type { ActionDef, Input, Lexicon, Model, Output, Problem } from "./types";

export interface InterpretedStep {
  label: string;
  input: Input;
  output: Output;
  modelIds: string[];
  /** The words in the sentence that led to this step. */
  evidence: string[];
}
export interface Interpretation {
  query: string;
  steps: InterpretedStep[];
  closestPreset: { id: string; title: string } | null;
  /** Honest notes about things the map does not cover. */
  notes: string[];
  /** Models whose name, developer or summary contain words from the sentence. */
  mentions: string[];
}
export interface InterpretContext { lexicon: Lexicon; models: Model[]; problems: Problem[] }

const MEDIA: Input[] = ["image", "text", "audio", "video"];
const NOUN: Record<Input, string> = { image: "images", text: "text", audio: "audio", video: "video" };
const MAX_PER_FAMILY = 3, MAX_CANDIDATES = 8;

export const normalize = (s: string) =>
  s.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9&+]+/g, " ").trim().replace(/\s+/g, " ");

const rxCache = new Map<string, RegExp>();
/** "word" matches the word and plain suffixes; "pref~" matches any word starting with it; spaces match phrases. */
function stemRx(stem: string): RegExp {
  let rx = rxCache.get(stem);
  if (!rx) {
    const prefix = stem.endsWith("~"), base = normalize(prefix ? stem.slice(0, -1) : stem);
    const esc = base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, " ");
    rx = new RegExp(`(?<![a-z0-9])${esc}${prefix ? "" : "(?:s|es|ed|d|ing|er|ers)?(?![a-z0-9])"}`);
    rxCache.set(stem, rx);
  }
  return rx;
}
interface Hit { index: number; end: number; text: string }
const firstHit = (norm: string, stems: string[]): Hit | null => {
  let best: Hit | null = null;
  for (const st of stems) {
    const m = stemRx(st).exec(norm);
    if (m && (!best || m.index < best.index || (m.index === best.index && m[0].length > best.text.length))) best = { index: m.index, end: m.index + m[0].length, text: m[0] };
  }
  return best;
};
const tokenIndex = (norm: string, charIdx: number) => (norm.slice(0, charIdx).match(/ /g) ?? []).length;

interface ActionHit extends Hit { action: ActionDef; tok: number }

function findActions(norm: string, lex: Lexicon): ActionHit[] {
  const hits: ActionHit[] = [];
  for (const action of lex.actions) {
    if (action.with && !firstHit(norm, action.with)) continue;
    const h = firstHit(norm, action.stems);
    if (h) hits.push({ ...h, action, tok: tokenIndex(norm, h.index) });
  }
  // Overlapping matches (e.g. "tag speakers" vs "tag"): the higher priority, then the longer phrase, wins.
  hits.sort((a, b) => b.action.priority - a.action.priority || b.end - b.index - (a.end - a.index));
  const kept: ActionHit[] = [];
  for (const h of hits) if (!kept.some((k) => h.index < k.end && k.index < h.end)) kept.push(h);
  const suppressed = new Set(kept.flatMap((k) => k.action.suppress ?? []));
  return kept.filter((k) => !suppressed.has(k.action.id)).sort((a, b) => a.index - b.index);
}

function findModalities(norm: string, lex: Lexicon): { input: Input; tok: number; text: string }[] {
  const out: { input: Input; tok: number; text: string }[] = [];
  for (const input of MEDIA) {
    for (const w of lex.modalities[input]) {
      const re = new RegExp(stemRx(w).source, "g");
      for (let m; (m = re.exec(norm)); ) out.push({ input, tok: tokenIndex(norm, m.index), text: m[0] });
    }
  }
  return out.sort((a, b) => a.tok - b.tok);
}

/** Downloads, discounted for age so a 2019 classic does not outrank this year's models in suggestions. */
const score = (m: Model, now = Date.now()) => {
  const dl = m.metrics?.downloads_30d ?? 0;
  const created = m.metrics?.created_at ? Date.parse(m.metrics.created_at) : NaN;
  if (Number.isNaN(created)) return dl;
  const years = (now - created) / 31_557_600_000;
  return dl * (years < 1 ? 1 : years < 2 ? 0.3 : 0.05);
};

/** Models that cover an input -> output pair: families by popularity, a few models per family, capped. */
export function candidatesFor(models: Model[], input: Input, output: Output): string[] {
  const matching = models.filter((m) => m.cells.some((c) => c.input === input && c.output === output));
  const byFamily = new Map<string, Model[]>();
  for (const m of matching) byFamily.set(m.family, [...(byFamily.get(m.family) ?? []), m]);
  const fams = [...byFamily.entries()]
    .map(([fam, ms]) => ({ fam, ms: [...ms].sort((a, b) => score(b) - score(a)), top: Math.max(0, ...ms.map(score)) }))
    .sort((a, b) => b.top - a.top || a.fam.localeCompare(b.fam));
  return fams.flatMap((f) => f.ms.slice(0, MAX_PER_FAMILY)).slice(0, MAX_CANDIDATES).map((m) => m.id);
}

function buildSteps(norm: string, lex: Lexicon, models: Model[]): InterpretedStep[] {
  const actions = findActions(norm, lex);
  const mods = findModalities(norm, lex);
  const steps: InterpretedStep[] = [];
  const seen = new Set<string>();
  actions.forEach((hit, i) => {
    const a = hit.action;
    if (seen.has(a.id)) return;
    seen.add(a.id);
    const nextTok = actions[i + 1]?.tok ?? Infinity;
    const defs = a.steps ?? [{ in: a.in as Input | undefined, out: a.out as Output, label: a.label ?? a.id }];
    defs.forEach((def, k) => {
      const allowed = a.allowed_in ?? MEDIA;
      let input: Input | null = def.in ?? null;
      let word = hit.text;
      if (!input) {
        // Nouns before the first verb belong to it; later verbs only claim nouns that come after them.
        const hitEnd = tokenIndex(norm, Math.max(hit.index, hit.end - 1));
        const ownWord = (m: { tok: number }) => m.tok >= hit.tok && m.tok <= hitEnd; // "notes" in "into notes" is the verb, not the input
        const region = mods.filter((m) => !ownWord(m) && (i === 0 ? m.tok < nextTok : m.tok > hit.tok && m.tok < nextTok));
        const nearest = [...region].sort((x, y) => Math.abs(x.tok - hit.tok) - Math.abs(y.tok - hit.tok))[0];
        const prev = steps[steps.length - 1]?.output;
        if (nearest) { input = nearest.input; word = `${hit.text} + ${nearest.text}`; }
        else if (prev && (MEDIA as string[]).includes(prev) && allowed.includes(prev as Input)) input = prev as Input;
        else if (mods.some((m) => !ownWord(m))) input = mods.find((m) => !ownWord(m) && allowed.includes(m.input))?.input ?? null;
        else input = a.default_in ?? "text";
        if (input && !allowed.includes(input)) input = null; // e.g. "detect" next to "emails": not something we can outline
      }
      if (!input) return;
      // e.g. answering about a recording: transcribe first, then the step works on text.
      const via = a.via?.[input];
      if (via) {
        for (const v of via) steps.push({ label: v.label, input: v.in, output: v.out, modelIds: candidatesFor(models, v.in, v.out), evidence: [word] });
        input = via[via.length - 1].out as Input;
        word = "";
      }
      const label = def.label.replace("{in}", NOUN[input]);
      steps.push({ label, input, output: def.out, modelIds: candidatesFor(models, input, def.out), evidence: k === 0 && word ? [word] : [] });
    });
  });
  return steps;
}

// ---- closest preset and word mentions ----------------------------------------------------------------------
const stem = (w: string) => w.replace(/(ing|ed|es|s)$/, "");
const words = (s: string, stop: Set<string>) => normalize(s).split(" ").filter((w) => w.length > 2 && !stop.has(w)).map(stem);

function closestPreset(norm: string, lex: Lexicon, problems: Problem[], candidateIds: Set<string>) {
  const stop = new Set(lex.stop_words);
  const q = new Set(words(norm, stop));
  if (!q.size) return null;
  let best: { p: Problem; shared: number; j: number } | null = null;
  for (const p of problems) {
    const doc = new Set(words(`${p.title} ${p.description} ${p.steps.map((s) => s.label).join(" ")}`, stop));
    const shared = [...q].filter((w) => doc.has(w)).length;
    const j = shared / (q.size + doc.size - shared);
    // When the sentence was understood, the preset must also use at least one of the suggested models.
    const overlaps = !candidateIds.size || p.steps.some((st) => st.models.some((id) => candidateIds.has(id)));
    if (overlaps && (shared >= 2 || (shared >= 1 && j >= 0.3)) && (!best || j > best.j)) best = { p, shared, j };
  }
  return best ? { id: best.p.id, title: best.p.title } : null;
}

function mentions(norm: string, lex: Lexicon, models: Model[], skip: Set<string>): string[] {
  const stop = new Set(lex.stop_words);
  const q = [...new Set(norm.split(" ").filter((w) => w.length >= 3 && !stop.has(w)).map(stem))];
  if (!q.length) return [];
  return models
    .filter((m) => !skip.has(m.id))
    .map((m) => {
      // Whole-word matches only: a word in the name or developer counts for 3, in the summary for 1; 3 points to qualify.
      const head = new Set(normalize(`${m.name} ${m.id} ${m.developer ?? ""}`).split(" ").map(stem));
      const body = new Set(normalize(`${m.summary ?? ""} ${m.hf_task ?? ""}`).split(" ").map(stem));
      let s = 0;
      for (const w of q) { if (head.has(w)) s += 3; else if (body.has(w)) s += 1; }
      return { id: m.id, s };
    })
    .filter((x) => x.s >= 3)
    .sort((a, b) => b.s - a.s)
    .slice(0, 6)
    .map((x) => x.id);
}

export function interpret(query: string, ctx: InterpretContext): Interpretation {
  const norm = normalize(query);
  const steps = norm ? buildSteps(norm, ctx.lexicon, ctx.models) : [];
  const inSteps = new Set(steps.flatMap((s) => s.modelIds));
  return {
    query,
    steps,
    closestPreset: norm ? closestPreset(norm, ctx.lexicon, ctx.problems, inSteps) : null,
    mentions: norm ? mentions(norm, ctx.lexicon, ctx.models, inSteps) : [],
    notes: norm ? (ctx.lexicon.scope_notes ?? []).filter((n) => firstHit(norm, n.stems)).map((n) => n.message) : [],
  };
}
