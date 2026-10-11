// Pure HTML rendering shared by the browser (main.ts) and the build-time prerenderer (prerender.ts).
import { familyById, modelById, modelsOfFamily, models, problemById, problems, taskById, tasks, families } from "./data";
import { fitsWithin, lightestSetup, modelReq, stepReq, NO_FIT, type Fit, type Req } from "./lightest";
import { interpret, type Interpretation } from "./interpret";
import lexiconJson from "../data/lexicon.json";
import type { Input, Lexicon, Model, Output, Problem, Tier } from "./types";
import site from "../site.json";

export const INPUTS: { id: Input; label: string }[] = [
  { id: "image", label: "Image" }, { id: "text", label: "Text" },
  { id: "audio", label: "Audio" }, { id: "video", label: "Video" },
];
export const OUTPUTS: { id: Output; label: string }[] = [
  { id: "label", label: "Label / score" }, { id: "embedding", label: "Embedding" },
  { id: "boxes_masks", label: "Boxes / masks" }, { id: "text", label: "Text" },
  { id: "image", label: "Image output" }, { id: "audio", label: "Audio output" }, { id: "video", label: "Video output" },
];
// Order matters: the first tier a family has is its chip colour (lightest setup). "api" is a separate axis.
export const TIERS: { id: Tier; label: string; short: string }[] = [
  { id: "cpu_edge", label: "CPU / edge", short: "C" },
  { id: "gpu_8gb", label: "8 GB GPU", short: "8" },
  { id: "gpu_24gb", label: "24 GB GPU", short: "24" },
  { id: "datacenter", label: "Datacenter", short: "DC" },
  { id: "api", label: "API only", short: "API" },
];
const tierMeta = new Map(TIERS.map((t) => [t.id, t]));
const inLabel = new Map(INPUTS.map((i) => [i.id, i.label]));
const outLabel = new Map(OUTPUTS.map((o) => [o.id, o.label.replace(" output", "")]));

export const BASE = import.meta.env.BASE_URL; // e.g. "/model-map/"
export const SITE_URL = site.url;

const lexicon = lexiconJson as unknown as Lexicon;

export type Focus = { kind: "problem" | "task"; id: string } | { kind: "ask"; query: string } | null;
export interface State { focus: Focus; family: string | null; col: Input; fit: Fit }

export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

// ---- routing -------------------------------------------------------------------------------
export const focusPath = (f: Focus) => (f && f.kind !== "ask" ? `${f.kind === "problem" ? "problems" : "tasks"}/${f.id}/` : "");
export const focusHref = (f: Focus) => BASE + focusPath(f);

export const ASK_MAX = 200;
export const askHref = (q: string) => `${BASE}#ask=${encodeURIComponent(q)}`;

/** Parse a location into a focus (home → null). A "#ask=..." hash on the home page is a free-text problem. */
export function parseFocus(pathname: string, hash = ""): Focus {
  const rest = pathname.startsWith(BASE) ? pathname.slice(BASE.length) : pathname.replace(/^\//, "");
  if (rest === "" || rest === "index.html") {
    const m = /^#ask=(.*)$/.exec(hash);
    if (m) { try { const q = decodeURIComponent(m[1]).trim().slice(0, ASK_MAX); return q ? { kind: "ask", query: q } : null; } catch { return null; } }
    return null;
  }
  const m = rest.match(/^(problems|tasks)\/([^/]+)\/?$/);
  if (!m) return null;
  if (m[1] === "problems") return problemById.has(m[2]) ? { kind: "problem", id: m[2] } : null;
  return taskById.has(m[2]) ? { kind: "task", id: m[2] } : null;
}

// ---- focus helpers -------------------------------------------------------------------------
const interpCache = new Map<string, Interpretation>();
export function interpretation(query: string): Interpretation {
  let r = interpCache.get(query);
  if (!r) { r = interpret(query, { lexicon, models, problems }); interpCache.set(query, r); }
  return r;
}

export function focusModels(f: Focus): Model[] {
  if (!f) return [];
  if (f.kind === "ask") return interpretation(f.query).steps.flatMap((st) => st.modelIds).map((id) => modelById.get(id)).filter((m): m is Model => !!m);
  if (f.kind === "task") return models.filter((m) => m.hf_task === f.id);
  const p = problemById.get(f.id);
  return (p?.steps ?? []).flatMap((s) => s.models).map((id) => modelById.get(id)).filter((m): m is Model => !!m);
}
/** True when the focus should dim everything else (an unreadable free-text problem highlights nothing, so it dims nothing). */
export const hasFocus = (f: Focus) => !!f && (f.kind !== "ask" || focusModels(f).length > 0);
export const focusFamilies = (f: Focus) => new Set(focusModels(f).map((m) => m.family));
export const focusCols = (f: Focus) => new Set(focusModels(f).flatMap((m) => m.cells.map((c) => c.input)));

/** Column to show first on a phone: the input of the focus's first model. */
export const startCol = (f: Focus): Input => focusModels(f)[0]?.cells[0]?.input ?? "image";

export function pageMeta(f: Focus): { title: string; description: string; path: string; heading: string; lede: string } {
  if (f?.kind === "problem") {
    const p = problemById.get(f.id)!;
    return { title: `${p.title}: which model fits? | ${site.name}`, description: p.description, path: focusPath(f), heading: p.title, lede: p.description };
  }
  if (f?.kind === "task") {
    const t = taskById.get(f.id)!;
    const d = t.summary ?? `Models on the map for the Hugging Face task "${t.name}".`;
    return { title: `${t.name}: models on the map | ${site.name}`, description: d, path: focusPath(f), heading: t.name, lede: d };
  }
  const d = "An interactive map of the ML model landscape, from ResNet18 to flagship LLMs, organised by what goes in and what comes out.";
  return { title: `${site.name}: which ML model fits my problem?`, description: d, path: "", heading: site.name, lede: "Which model fits my problem? Models sit where their input (columns) meets their output (rows). Pick a problem to see the steps." };
}

// ---- pieces --------------------------------------------------------------------------------
/** Members of a family that pass the hardware filter. */
const visibleMembers = (fid: string, fit: Fit) => modelsOfFamily(fid).filter((m) => fitsWithin(m, fit));
const tierOk = (t: Tier, fit: Fit) => !fit.tier || (t === "api" ? fit.api : TIERS.findIndex((x) => x.id === t) <= TIERS.findIndex((x) => x.id === fit.tier));
const familyTiers = (fid: string, fit: Fit): Tier[] => {
  const present = new Set(visibleMembers(fid, fit).flatMap((m) => m.tiers).filter((t) => tierOk(t, fit)));
  return TIERS.filter((t) => present.has(t.id)).map((t) => t.id);
};
/** Popularity for ordering chips within a cell: the most-downloaded member's trailing-30-day downloads. */
const familyScore = (fid: string) => Math.max(0, ...modelsOfFamily(fid).map((m) => m.metrics?.downloads_30d ?? 0));
const CELL_CAP = 6;
const familyHasCell = (fid: string, i: Input, o: Output, fit: Fit) =>
  visibleMembers(fid, fit).some((m) => m.cells.some((c) => c.input === i && c.output === o));

const reqLabel = (r: Req) => (r.kind === "hw" ? tierMeta.get(r.tier)!.label : r.kind === "api" ? "API only" : "unknown");
const reqTier = (r: Req) => (r.kind === "hw" ? r.tier : r.kind === "api" ? "api" : "unknown");
const reqShort = (r: Req) => (r.kind === "hw" ? tierMeta.get(r.tier)!.short : r.kind === "api" ? "API" : "?");

export function header(active: "home" | "methodology"): string {
  return `<nav class="topbar" aria-label="Site">
    <a class="brand" href="${BASE}" data-nav>${esc(site.name)}</a>
    <a href="${BASE}methodology/"${active === "methodology" ? ' aria-current="page"' : ""}>Methodology</a>
    <a href="${esc(site.repo)}" rel="noopener">GitHub</a></nav>`;
}
export const footer = () =>
  `<footer class="foot">Tiers and licenses are unverified unless marked. <a href="${BASE}methodology/">How entries are verified</a> · <a href="${esc(site.repo)}/blob/main/CONTRIBUTING.md" rel="noopener">Contribute a model</a></footer>`;

function chip(fid: string, s: State): string {
  const tiers = familyTiers(fid, s.fit);
  const color = tiers[0] ?? "unknown";
  const inv = focusFamilies(s.focus);
  const dim = hasFocus(s.focus) ? !inv.has(fid) : s.family ? fid !== s.family : false;
  const badges = tiers.length ? tiers.map((t) => `<span class="badge">${tierMeta.get(t)!.short}</span>`).join("") : `<span class="badge">?</span>`;
  return `<button type="button" class="chip" data-family="${fid}" data-tier="${color}" data-dim="${dim}" data-involved="${hasFocus(s.focus) && inv.has(fid)}" aria-pressed="${s.family === fid}">
    <span class="chip-name">${esc(familyById.get(fid)!.name)}</span><span class="badges" aria-hidden="true">${badges}</span></button>`;
}

function grid(s: State): string {
  const cols = focusCols(s.focus);
  const head = INPUTS.map((i) => `<th scope="col" data-col="${i.id}">${i.label}</th>`).join("");
  const rows = OUTPUTS.map((o) => {
    const cells = INPUTS.map((i) => {
      const inv = focusFamilies(s.focus);
      const fids = families.filter((f) => familyHasCell(f.id, i.id, o.id, s.fit)).map((f) => f.id)
        .sort((a, b) => Number(inv.has(b)) - Number(inv.has(a)) || familyScore(b) - familyScore(a) || a.localeCompare(b));
      const extra = Math.max(0, fids.length - CELL_CAP);
      const chips = fids.map((f, idx) => (idx >= CELL_CAP ? chip(f, s).replace("<button ", '<button data-extra="true" ') : chip(f, s))).join("");
      const more = extra ? `<button type="button" class="more" data-more aria-expanded="false">Show ${extra} more</button>` : "";
      return `<td data-col="${i.id}">${chips || `<span class="empty" aria-hidden="true">·</span>`}${more}</td>`;
    }).join("");
    return `<tr><th scope="row">${o.label}</th>${cells}</tr>`;
  }).join("");
  return `<div class="tabs" role="tablist" aria-label="Input modality">
      ${INPUTS.map((i) => `<button role="tab" type="button" id="tab-${i.id}" data-tab="${i.id}" aria-selected="${s.col === i.id}" tabindex="${s.col === i.id ? 0 : -1}">${i.label}<span class="dot"${hasFocus(s.focus) && cols.has(i.id) ? "" : " hidden"}> <span class="sr-only">(has highlighted models)</span></span></button>`).join("")}
    </div>
    <div class="grid-wrap"><table class="grid" data-col="${s.col}">
      <caption class="sr-only">Models by input modality (columns) and output type (rows)</caption>
      <thead><tr><td class="corner"><span class="axis">Output ↓ · Input →</span></td>${head}</tr></thead><tbody>${rows}</tbody></table></div>
    <ul class="legend" aria-label="Deployment tier legend">
      ${TIERS.map((t) => `<li><span class="swatch" data-tier="${t.id}"><span class="badge">${t.short}</span></span>${t.label}</li>`).join("")}
      <li><span class="swatch" data-tier="unknown"><span class="badge">?</span></span>Unknown</li>
    </ul>
    <p class="legend-note">Colour is the lightest tier any model in the family needs; badges list every tier it spans. Tiers are coarse and unverified.</p>`;
}

function presets(f: Focus): string {
  return `<section class="presets" aria-label="Problem presets"><h2 class="presets-title">Start from a problem</h2>
    <div class="preset-list">${problems.map((p) => {
      const on = f?.kind === "problem" && f.id === p.id;
      // The active preset links home, so selecting it again clears the selection.
      return `<a class="preset" data-nav data-problem="${p.id}" href="${on ? BASE : focusHref({ kind: "problem", id: p.id })}"${on ? ' aria-current="page"' : ""}>${esc(p.title)}</a>`;
    }).join("")}</div></section>`;
}

const candBtn = (m: Model, r: Req, fit: Fit = NO_FIT) =>
  `<li><button type="button" class="cand" data-family="${m.family}" data-tier="${reqTier(r)}"${fitsWithin(m, fit) ? "" : ' data-nofit="true" title="Does not fit the selected hardware"'}>${esc(m.name)} <span class="badge">${reqShort(r)}</span></button></li>`;

function focusPanel(f: Focus, fit: Fit): string {
  if (!f) return `<p class="hint">Pick a problem above to see its steps and which models fit each one.</p>`;
  if (f.kind === "task") {
    const t = taskById.get(f.id)!;
    const ms = focusModels(f);
    const usedBy = problems.filter((p) => p.steps.some((s) => s.models.some((id) => ms.some((m) => m.id === id))));
    return `<h2>${esc(t.name)}</h2>${t.summary ? `<p>${esc(t.summary)}</p>` : ""}
      <p class="fine">Task definition from the <a href="https://huggingface.co/tasks/${esc(t.id)}" rel="noopener">Hugging Face task page</a>.</p>
      <h3>Models on this map</h3><ul class="cands">${ms.map((m) => candBtn(m, stepReq([m]), fit)).join("")}</ul>
      <p class="used"><strong>Used in:</strong> ${usedBy.length ? usedBy.map((p) => `<a href="${focusHref({ kind: "problem", id: p.id })}">${esc(p.title)}</a>`).join(", ") : "no problem presets yet"}</p>`;
  }
  if (f.kind === "ask") return askPanel(f.query, fit);
  return stepsBody(problemById.get(f.id)!, fit);
}

/** With a hardware filter on: does every step have at least one candidate that fits? */
function fitVerdict(p: Problem, fit: Fit): string {
  if (!fit.tier) return "";
  const label = tierMeta.get(fit.tier)!.label;
  const cand = (st: Problem["steps"][number]) => st.models.map((id) => modelById.get(id)).filter((m): m is Model => !!m);
  const lacking = p.steps.filter((st) => !cand(st).some((m) => fitsWithin(m, fit)));
  // A step whose only options have no known size is "can't confirm", not "doesn't fit".
  const unknownNames = [...new Set(lacking.flatMap((st) => cand(st).filter((m) => modelReq(m).kind === "unknown" && !fit.unknown).map((m) => m.name)))];
  if (!lacking.length) return `<p class="verdict ok"><strong>Fits ${esc(label)}:</strong> every step has a candidate that fits.</p>`;
  return `<p class="verdict bad"><strong>Does not fit ${esc(label)}:</strong> no candidate is known to fit for ${lacking.map((st) => esc(st.label)).join("; ")}.${unknownNames.length ? ` Size unknown for ${unknownNames.map(esc).join(", ")}; tick "Include models with unknown size" to count ${unknownNames.length === 1 ? "it" : "them"}.` : ""}</p>`;
}

/** Ordered steps with candidate models, plus the lightest-setup summary. Shared by presets and free-text problems. */
function stepsBody(p: Problem, fit: Fit, heading = esc(p.title), evidence: string[][] = []): string {
  const l = lightestSetup(p, modelById);
  const parts: string[] = [];
  if (l.hw) parts.push(`<strong>${tierMeta.get(l.hw)!.label}</strong>`);
  else if (!l.apiSteps.length) parts.push(`<strong>Unknown</strong>`);
  if (l.apiSteps.length) parts.push(`${l.hw ? "plus " : ""}<strong>API</strong> for: ${l.apiSteps.map(esc).join("; ")}`);
  if (l.unknownSteps.length) parts.push(`no tier data yet for: ${l.unknownSteps.map(esc).join("; ")}`);
  const steps = p.steps.map((s, i) => {
    const cands = s.models.map((id) => modelById.get(id)).filter((m): m is Model => !!m);
    const body = cands.length
      ? `<ul class="cands">${cands.map((m) => candBtn(m, stepReq([m]), fit)).join("")}</ul><p class="step-req">Lightest here: ${reqLabel(stepReq(cands))}</p>`
      : `<p class="step-req">No model on the map covers this step yet.</p>`;
    const why = evidence[i]?.length ? `<p class="step-req">Because of: ${evidence[i].map((w) => `“${esc(w)}”`).join(", ")}</p>` : "";
    return `<li><h3>${esc(s.label)}</h3>${why}${body}</li>`;
  }).join("");
  return `<h2>${heading}</h2><ol class="steps">${steps}</ol>
    <div class="lightest"><h3>Lightest setup</h3><p>${parts.join("; ")}</p>${fitVerdict(p, fit)}
      <p class="fine">Per step, the lightest option; overall, the heaviest of those. API-only options are reported separately. Tiers are unverified estimates.</p></div>
    ${p.note ? `<p class="notes">${esc(p.note)}</p>` : ""}`;
}

function askPanel(query: string, fit: Fit): string {
  const r = interpretation(query);
  const asked = `<p class="asked">“${esc(query)}”</p>`;
  const caveat = `<p class="fine">Read by matching your words against a keyword list (see <a href="${esc(site.repo)}/blob/main/data/lexicon.json" rel="noopener">data/lexicon.json</a>). No AI is involved and nothing leaves your browser. If it misread you, rephrase or pick a preset.</p>`;
  const notes = r.notes.map((n) => `<p class="notes">${esc(n)}</p>`).join("");
  const preset = r.closestPreset ? `<p class="used"><strong>Related preset:</strong> <a href="${focusHref({ kind: "problem", id: r.closestPreset.id })}" data-nav>${esc(r.closestPreset.title)}</a></p>` : "";
  const mention = r.mentions.map((id) => modelById.get(id)).filter((m): m is Model => !!m);
  const mentions = mention.length ? `<h3>Models that mention your words</h3><ul class="cands">${mention.map((m) => candBtn(m, stepReq([m]), fit)).join("")}</ul>` : "";
  if (!r.steps.length) {
    const ex = lexicon.examples.map((e) => `<li><a href="${askHref(e)}" data-nav>${esc(e)}</a></li>`).join("");
    return `<h2>Your problem</h2>${asked}<p>I couldn't tell what to do with the input, what it should produce, or both. Try naming what you have (photos, documents, recordings, video) and what you want (transcribe, sort, count, find similar, summarize, generate).</p>
      <ul class="examples">${ex}</ul>${notes}${preset}${mentions}${caveat}`;
  }
  const p: Problem = { id: "ask", title: "Your problem", description: query, steps: r.steps.map((st) => ({ label: st.label, models: st.modelIds })), note: null };
  return `${asked}${stepsBody(p, fit, "How I read it", r.steps.map((st) => st.evidence))}${notes}${preset}${mentions}${caveat}`;
}

const aiTag = (src: "ai" | "curated" | null) =>
  src === "ai" ? `<span class="tag" title="Summarized by an AI model from the model card; not reviewed by a person">AI summary</span>` : "";

export function detailPanel(fid: string | null, fit: Fit = NO_FIT): string {
  if (!fid) return `<p class="hint">Select a model to see details. Select it again to clear.</p>`;
  const fam = familyById.get(fid)!;
  const all = modelsOfFamily(fid);
  const members = all.filter((m) => fitsWithin(m, fit));
  const hiddenByFit = all.length - members.length;
  const usedBy = problems.filter((p) => p.steps.some((s) => s.models.some((id) => members.some((m) => m.id === id))));
  const row = (m: Model) => `<li class="member">
      <h3>${esc(m.name)} ${m.verified ? `<span class="tag ok">verified</span>` : `<span class="tag">unverified</span>`}</h3>
      ${m.summary ? `<p class="summary">${esc(m.summary)} ${aiTag(m.summary_source)}</p>` : ""}
      <dl>
        ${m.developer ? `<dt>Developer</dt><dd>${esc(m.developer)}</dd>` : ""}
        <dt>Takes → gives</dt><dd>${m.cells.map((c) => `${inLabel.get(c.input)} → ${outLabel.get(c.output)}`).join("; ")}</dd>
        <dt>Tier</dt><dd>${m.tiers.length ? m.tiers.map((t) => tierMeta.get(t)!.label).join(", ") : `unknown${m.tier_note ? `. ${esc(m.tier_note)}` : ""}`}</dd>
        <dt>License</dt><dd>${m.license ? esc(m.license) : "unknown"}${m.open_weights === false ? " (closed)" : m.open_weights ? " (open weights)" : ""}</dd>
        ${m.hf_task ? `<dt>Hub task</dt><dd>${taskById.has(m.hf_task) ? `<a href="${focusHref({ kind: "task", id: m.hf_task })}" data-nav>${esc(m.hf_task)}</a>` : esc(m.hf_task)}</dd>` : ""}
        ${m.links.length ? `<dt>Links</dt><dd>${m.links.map((l) => `<a href="${esc(l.url)}" rel="noopener">${esc(l.label)}</a>`).join(", ")}</dd>` : ""}
      </dl>${m.notes ? `<p class="notes">${esc(m.notes)}</p>` : ""}</li>`;
  return `<h2>${esc(fam.name)}</h2>${fam.summary ? `<p class="summary">${esc(fam.summary)} ${aiTag(fam.summary_source)}</p>` : ""}
    <p class="used"><strong>Used in:</strong> ${usedBy.length ? usedBy.map((p) => `<a href="${focusHref({ kind: "problem", id: p.id })}" data-nav>${esc(p.title)}</a>`).join(", ") : "no problem presets yet"}</p>
    <ul class="members">${members.map(row).join("")}</ul>
    ${hiddenByFit ? `<p class="fine">${hiddenByFit} more ${hiddenByFit === 1 ? "model is" : "models are"} hidden because ${hiddenByFit === 1 ? "it does" : "they do"} not fit the selected hardware.</p>` : ""}`;
}

const browseTasks = () => `<section class="browse" aria-label="Browse by task"><h2 class="presets-title">Browse by Hugging Face task</h2>
  <ul class="task-links">${tasks.map((t) => `<li><a href="${focusHref({ kind: "task", id: t.id })}" data-nav>${esc(t.name)}</a></li>`).join("")}</ul></section>`;

const FIT_OPTIONS: { id: Tier | ""; label: string }[] = [
  { id: "", label: "Any" }, { id: "cpu_edge", label: "CPU / edge" }, { id: "gpu_8gb", label: "8 GB GPU" },
  { id: "gpu_24gb", label: "24 GB GPU" }, { id: "datacenter", label: "Datacenter" },
];

/** "Fits on" hardware filter: radios for the size, two opt-in checkboxes for models that have no hardware size. */
function fitControl(fit: Fit): string {
  const shown = models.filter((m) => fitsWithin(m, fit)).length;
  return `<fieldset class="fit"><legend>Show models that fit on</legend>
    <div class="fit-options">${FIT_OPTIONS.map((o) => `<label class="fit-opt"><input type="radio" name="fit" value="${o.id}"${(fit.tier ?? "") === o.id ? " checked" : ""} /><span>${o.label}</span></label>`).join("")}</div>
    ${fit.tier ? `<div class="fit-extra"><label><input type="checkbox" name="fit-api"${fit.api ? " checked" : ""} /> Include API-only models</label>
      <label><input type="checkbox" name="fit-unknown"${fit.unknown ? " checked" : ""} /> Include models with unknown size</label>
      <span class="fit-count" role="status">${shown} of ${models.length} models shown</span></div>` : ""}
  </fieldset>`;
}

function askForm(f: Focus): string {
  const q = f?.kind === "ask" ? f.query : "";
  return `<form class="ask" role="search" aria-label="Describe your own problem" data-ask>
    <label for="ask-input" class="presets-title">Or describe your own problem</label>
    <div class="ask-row"><input id="ask-input" name="q" type="text" maxlength="${ASK_MAX}" autocomplete="off" placeholder="e.g. ${esc(lexicon.examples[0])}" value="${esc(q)}" /><button type="submit">Find models</button>${q ? `<a class="ask-clear" data-nav href="${BASE}">Clear</a>` : ""}</div></form>`;
}

/** Everything inside #app for the map pages (home, problem, task). */
export function renderMap(s: State): string {
  const meta = pageMeta(s.focus);
  const isHome = !s.focus;
  return `${header("home")}
    <header class="page-head"><h1 tabindex="-1" id="page-title">${esc(meta.heading)}</h1><p class="lede">${esc(meta.lede)}</p></header>
    ${fitControl(s.fit)}
    ${askForm(s.focus)}
    ${presets(s.focus)}
    ${grid(s)}
    <section id="focus" class="panel" aria-live="polite" aria-label="${isHome ? "Problem steps" : "Selection"}">${focusPanel(s.focus, s.fit)}</section>
    <section id="detail" class="panel" aria-live="polite" aria-label="Details">${detailPanel(s.family, s.fit)}</section>
    ${browseTasks()}
    ${footer()}`;
}

export function renderMethodology(): string {
  const tierRows: [string, string][] = [
    ["CPU / edge", "Runs acceptably on a laptop CPU, phone, or small edge device. In practice: small CNNs and encoders, roughly under 1B parameters."],
    ["8 GB GPU", "Fits in about 8 GB of GPU memory, sometimes only after quantization."],
    ["24 GB GPU", "Fits in about 24 GB of GPU memory, a single high-end consumer card."],
    ["Datacenter", "Open weights, but needs server-class or multi-GPU hardware."],
    ["API only", "Available only as a hosted service. It needs no hardware of your own, but brings cost and data-handling trade-offs, so it is never ranked against the hardware tiers."],
  ];
  return `${header("methodology")}
    <header class="page-head"><h1 tabindex="-1" id="page-title">Methodology</h1><p class="lede">How the map is built, what the tiers mean, and how entries get verified.</p></header>
    <article class="prose">
      <h2>What the map shows</h2>
      <p>Each model sits where its input type (columns: image, text, audio, video) meets its output type (rows: label or score, embedding, boxes or masks, text, media). A model can appear in several cells. Models are grouped into families for display only: every model entry carries its own inputs, outputs, tier and license, so different versions of a family can differ.</p>
      <p>The goal is understanding, not ranking. Once you know which family fits, the Hugging Face Hub is the place to pick a specific checkpoint. The map deliberately has no benchmark scores, no live pricing, and no quality ranking.</p>
      <h2>Deployment tiers</h2>
      <p>Tiers are coarse and describe where a model can reasonably run. They are not dollar costs.</p>
      <dl class="tier-defs">${tierRows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>
      <p>Where a model has several sizes, its tier list covers the range, and a family's chip colour uses the lightest tier any member needs. Automatic estimates use the size of the model's weight files on the Hub (so a quantized release counts as the smaller thing it is), with headroom left on the card: roughly up to 3 GB for CPU or edge, 6.5 GB for an 8 GB GPU, and 20 GB for a 24 GB GPU. All of a model's weights have to fit, so a mixture-of-experts model counts by its total size, not by the parameters active per token. These cover weights only; real memory needs also depend on context length, batch size and input resolution.</p>
      <p>The "lightest setup" for a problem takes the lightest option for each step, then reports the heaviest of those. Steps that can only be done through an API are reported separately.</p>
      <h2>Verification</h2>
      <p>Every entry has a <code>verified</code> flag, and it starts as <code>false</code>. Unverified values are estimates: a tier derived from a parameter count, or a license read from a Hub tag. An entry becomes verified only after a reviewer has checked, and recorded in the entry's notes:</p>
      <ul><li>the license against the license text in the model's repository (a Hub tag of "other" is never enough),</li><li>the parameter counts against the model card, and</li><li>the tier against a published source or a test run.</li></ul>
      <p>Unknown values stay empty. The map prefers saying "unknown" to guessing.</p>
      <h2>How models are chosen</h2>
      <p>The list is curated, with weekly help from a script. It looks for open models on the Hugging Face Hub (most downloaded and trending per task) and for hosted models on OpenRouter (ranked by how much they are used), and filters out fine-tunes, quantized copies, test repositories and low-traffic noise. For open models an AI model suggests which family each belongs to. The results arrive as a pull request, and a person decides what is added. Download and usage numbers are used only to surface candidates, never displayed as a ranking.</p>
      <p>Facts such as the developer, license, parameter count and supported modalities come from those services, never from an AI model. All general-purpose language models are grouped under two chips, Open LLMs and Closed LLMs, and the models inside are the ones currently most downloaded or most used.</p>
      <h2>The problem box</h2>
      <p>The "describe your own problem" box does not use AI. It matches the words you type against a keyword list that lives in the project (<code>data/lexicon.json</code>): verbs such as transcribe, sort, count or generate decide what each step does, and nouns such as photos, documents or recordings decide what it works on. It shows the words it matched so a wrong reading is visible, and says so when a problem is outside what the map covers. Nothing you type leaves your browser.</p>
      <h2>AI-written summaries</h2>
      <p>The one-to-two sentence descriptions are written by a small AI model from the model's own card or catalogue entry. Before the model sees it, the text is stripped of HTML, links and code, truncated, and treated as untrusted data; the output must be short plain text with no links. Every such summary is labelled "AI summary" until a person reviews and edits it. If a card says too little, the summary says only what the metadata supports.</p>
      <p>Anyone can propose a correction or a new model with a pull request; see the <a href="${esc(site.repo)}/blob/main/CONTRIBUTING.md" rel="noopener">contributing guide</a>.</p>
      <h2>Task categories</h2>
      <p>Task names and definitions come from the Hugging Face task taxonomy (the <code>@huggingface/tasks</code> package), so they match what you see on the Hub.</p>
      <h2>Author</h2>
      <p>Built and maintained by ${esc(site.author.name)}. <a href="${esc(site.author.url)}" rel="noopener">Profile link (placeholder, to be replaced)</a>.</p>
    </article>
    ${footer()}`;
}
