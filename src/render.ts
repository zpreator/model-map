// Pure HTML rendering shared by the browser (main.ts) and the build-time prerenderer (prerender.ts).
import { familyById, modelById, modelsOfFamily, models, problemById, problems, taskById, tasks, families } from "./data";
import { lightestSetup, stepReq, type Req } from "./lightest";
import type { Input, Model, Output, Tier } from "./types";
import site from "../site.json";

export const INPUTS: { id: Input; label: string }[] = [
  { id: "image", label: "Image" }, { id: "text", label: "Text" },
  { id: "audio", label: "Audio" }, { id: "video", label: "Video" },
];
export const OUTPUTS: { id: Output; label: string }[] = [
  { id: "label", label: "Label / score" }, { id: "embedding", label: "Embedding" },
  { id: "boxes_masks", label: "Boxes / masks" }, { id: "text", label: "Text" }, { id: "media", label: "Media" },
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
const outLabel = new Map(OUTPUTS.map((o) => [o.id, o.label]));

export const BASE = import.meta.env.BASE_URL; // e.g. "/model-map/"
export const SITE_URL = site.url;

export type Focus = { kind: "problem" | "task"; id: string } | null;
export interface State { focus: Focus; family: string | null; col: Input }

export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

// ---- routing -------------------------------------------------------------------------------
export const focusPath = (f: Focus) => (f ? `${f.kind === "problem" ? "problems" : "tasks"}/${f.id}/` : "");
export const focusHref = (f: Focus) => BASE + focusPath(f);

/** Parse a location pathname into a focus (home → null). Unknown ids → null. */
export function parseFocus(pathname: string): Focus {
  const rest = pathname.startsWith(BASE) ? pathname.slice(BASE.length) : pathname.replace(/^\//, "");
  const m = rest.match(/^(problems|tasks)\/([^/]+)\/?$/);
  if (!m) return null;
  if (m[1] === "problems") return problemById.has(m[2]) ? { kind: "problem", id: m[2] } : null;
  return taskById.has(m[2]) ? { kind: "task", id: m[2] } : null;
}

// ---- focus helpers -------------------------------------------------------------------------
export function focusModels(f: Focus): Model[] {
  if (!f) return [];
  if (f.kind === "task") return models.filter((m) => m.hf_task === f.id);
  const p = problemById.get(f.id);
  return (p?.steps ?? []).flatMap((s) => s.models).map((id) => modelById.get(id)).filter((m): m is Model => !!m);
}
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
const familyTiers = (fid: string): Tier[] => {
  const present = new Set(modelsOfFamily(fid).flatMap((m) => m.tiers));
  return TIERS.filter((t) => present.has(t.id)).map((t) => t.id);
};
const familyHasCell = (fid: string, i: Input, o: Output) =>
  modelsOfFamily(fid).some((m) => m.cells.some((c) => c.input === i && c.output === o));

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
  const tiers = familyTiers(fid);
  const color = tiers[0] ?? "unknown";
  const inv = focusFamilies(s.focus);
  const dim = s.focus ? !inv.has(fid) : s.family ? fid !== s.family : false;
  const badges = tiers.length ? tiers.map((t) => `<span class="badge">${tierMeta.get(t)!.short}</span>`).join("") : `<span class="badge">?</span>`;
  return `<button type="button" class="chip" data-family="${fid}" data-tier="${color}" data-dim="${dim}" data-involved="${!!s.focus && inv.has(fid)}" aria-pressed="${s.family === fid}">
    <span class="chip-name">${esc(familyById.get(fid)!.name)}</span><span class="badges" aria-hidden="true">${badges}</span></button>`;
}

function grid(s: State): string {
  const cols = focusCols(s.focus);
  const head = INPUTS.map((i) => `<th scope="col" data-col="${i.id}">${i.label}</th>`).join("");
  const rows = OUTPUTS.map((o) => {
    const cells = INPUTS.map((i) => {
      const fids = families.filter((f) => familyHasCell(f.id, i.id, o.id)).map((f) => f.id);
      return `<td data-col="${i.id}">${fids.map((f) => chip(f, s)).join("") || `<span class="empty" aria-hidden="true">·</span>`}</td>`;
    }).join("");
    return `<tr><th scope="row">${o.label}</th>${cells}</tr>`;
  }).join("");
  return `<div class="tabs" role="tablist" aria-label="Input modality">
      ${INPUTS.map((i) => `<button role="tab" type="button" id="tab-${i.id}" data-tab="${i.id}" aria-selected="${s.col === i.id}" tabindex="${s.col === i.id ? 0 : -1}">${i.label}<span class="dot"${s.focus && cols.has(i.id) ? "" : " hidden"}> <span class="sr-only">(has highlighted models)</span></span></button>`).join("")}
    </div>
    <div class="grid-wrap"><table class="grid" data-col="${s.col}">
      <caption class="sr-only">Models by input modality (columns) and output type (rows)</caption>
      <thead><tr><td class="corner"><span class="sr-only">Output type</span></td>${head}</tr></thead><tbody>${rows}</tbody></table></div>
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

const candBtn = (m: Model, r: Req) =>
  `<li><button type="button" class="cand" data-family="${m.family}" data-tier="${reqTier(r)}">${esc(m.name)} <span class="badge">${reqShort(r)}</span></button></li>`;

function focusPanel(f: Focus): string {
  if (!f) return `<p class="hint">Pick a problem above to see its steps and which models fit each one.</p>`;
  if (f.kind === "task") {
    const t = taskById.get(f.id)!;
    const ms = focusModels(f);
    const usedBy = problems.filter((p) => p.steps.some((s) => s.models.some((id) => ms.some((m) => m.id === id))));
    return `<h2>${esc(t.name)}</h2>${t.summary ? `<p>${esc(t.summary)}</p>` : ""}
      <p class="fine">Task definition from the <a href="https://huggingface.co/tasks/${esc(t.id)}" rel="noopener">Hugging Face task page</a>.</p>
      <h3>Models on this map</h3><ul class="cands">${ms.map((m) => candBtn(m, stepReq([m]))).join("")}</ul>
      <p class="used"><strong>Used in:</strong> ${usedBy.length ? usedBy.map((p) => `<a href="${focusHref({ kind: "problem", id: p.id })}">${esc(p.title)}</a>`).join(", ") : "no problem presets yet"}</p>`;
  }
  const p = problemById.get(f.id)!;
  const l = lightestSetup(p, modelById);
  const parts: string[] = [];
  if (l.hw) parts.push(`<strong>${tierMeta.get(l.hw)!.label}</strong>`);
  else if (!l.apiSteps.length) parts.push(`<strong>Unknown</strong>`);
  if (l.apiSteps.length) parts.push(`${l.hw ? "plus " : ""}<strong>API</strong> for: ${l.apiSteps.map(esc).join("; ")}`);
  if (l.unknownSteps.length) parts.push(`no tier data yet for: ${l.unknownSteps.map(esc).join("; ")}`);
  const steps = p.steps.map((s) => {
    const cands = s.models.map((id) => modelById.get(id)).filter((m): m is Model => !!m);
    return `<li><h3>${esc(s.label)}</h3><ul class="cands">${cands.map((m) => candBtn(m, stepReq([m]))).join("")}</ul>
      <p class="step-req">Lightest here: ${reqLabel(stepReq(cands))}</p></li>`;
  }).join("");
  return `<h2>${esc(p.title)}</h2><ol class="steps">${steps}</ol>
    <div class="lightest"><h3>Lightest setup</h3><p>${parts.join("; ")}</p>
      <p class="fine">Per step, the lightest option; overall, the heaviest of those. API-only options are reported separately. Tiers are unverified estimates.</p></div>
    ${p.note ? `<p class="notes">${esc(p.note)}</p>` : ""}`;
}

export function detailPanel(fid: string | null): string {
  if (!fid) return `<p class="hint">Select a model to see details. Select it again to clear.</p>`;
  const fam = familyById.get(fid)!;
  const members = modelsOfFamily(fid);
  const usedBy = problems.filter((p) => p.steps.some((s) => s.models.some((id) => members.some((m) => m.id === id))));
  const row = (m: Model) => `<li class="member">
      <h3>${esc(m.name)} ${m.verified ? `<span class="tag ok">verified</span>` : `<span class="tag">unverified</span>`}</h3>
      <dl>
        <dt>Takes → gives</dt><dd>${m.cells.map((c) => `${inLabel.get(c.input)} → ${outLabel.get(c.output)}`).join("; ")}</dd>
        <dt>Tier</dt><dd>${m.tiers.length ? m.tiers.map((t) => tierMeta.get(t)!.label).join(", ") : "unknown"}</dd>
        <dt>License</dt><dd>${m.license ? esc(m.license) : "unknown"}${m.open_weights === false ? " (closed)" : m.open_weights ? " (open weights)" : ""}</dd>
        ${m.hf_task ? `<dt>Hub task</dt><dd>${taskById.has(m.hf_task) ? `<a href="${focusHref({ kind: "task", id: m.hf_task })}" data-nav>${esc(m.hf_task)}</a>` : esc(m.hf_task)}</dd>` : ""}
        ${m.links.length ? `<dt>Links</dt><dd>${m.links.map((l) => `<a href="${esc(l.url)}" rel="noopener">${esc(l.label)}</a>`).join(", ")}</dd>` : ""}
      </dl>${m.notes ? `<p class="notes">${esc(m.notes)}</p>` : ""}</li>`;
  return `<h2>${esc(fam.name)}</h2>${fam.summary ? `<p>${esc(fam.summary)}</p>` : ""}
    <p class="used"><strong>Used in:</strong> ${usedBy.length ? usedBy.map((p) => `<a href="${focusHref({ kind: "problem", id: p.id })}" data-nav>${esc(p.title)}</a>`).join(", ") : "no problem presets yet"}</p>
    <ul class="members">${members.map(row).join("")}</ul>`;
}

const browseTasks = () => `<section class="browse" aria-label="Browse by task"><h2 class="presets-title">Browse by Hugging Face task</h2>
  <ul class="task-links">${tasks.map((t) => `<li><a href="${focusHref({ kind: "task", id: t.id })}" data-nav>${esc(t.name)}</a></li>`).join("")}</ul></section>`;

/** Everything inside #app for the map pages (home, problem, task). */
export function renderMap(s: State): string {
  const meta = pageMeta(s.focus);
  const isHome = !s.focus;
  return `${header("home")}
    <header class="page-head"><h1 tabindex="-1" id="page-title">${esc(meta.heading)}</h1><p class="lede">${esc(meta.lede)}</p></header>
    ${presets(s.focus)}
    ${grid(s)}
    <section id="focus" class="panel" aria-live="polite" aria-label="${isHome ? "Problem steps" : "Selection"}">${focusPanel(s.focus)}</section>
    <section id="detail" class="panel" aria-live="polite" aria-label="Details">${detailPanel(s.family)}</section>
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
      <p>Where a model has several sizes, its tier list covers the range, and a family's chip colour uses the lightest tier any member needs. Estimates start from the parameter count reported by the Hub, at roughly 2 bytes per parameter for 16-bit weights. They cover weights only; real memory needs also depend on context length, batch size and input resolution.</p>
      <p>The "lightest setup" for a problem takes the lightest option for each step, then reports the heaviest of those. Steps that can only be done through an API are reported separately.</p>
      <h2>Verification</h2>
      <p>Every entry has a <code>verified</code> flag, and it starts as <code>false</code>. Unverified values are estimates: a tier derived from a parameter count, or a license read from a Hub tag. An entry becomes verified only after a reviewer has checked, and recorded in the entry's notes:</p>
      <ul><li>the license against the license text in the model's repository (a Hub tag of "other" is never enough),</li><li>the parameter counts against the model card, and</li><li>the tier against a published source or a test run.</li></ul>
      <p>Unknown values stay empty. The map prefers saying "unknown" to guessing.</p>
      <h2>How models are chosen</h2>
      <p>The list is curated. A weekly job queries the Hugging Face Hub for popular and trending models, filters out fine-tunes, quantized copies and test repositories, and proposes candidates in a pull request, with an AI model suggesting which family each belongs to. The suggestions are drafts. A person decides what is added, and any AI-written text stays marked unverified until approved. Download counts are used only to surface candidates, never displayed as a ranking.</p>
      <p>Anyone can propose a correction or a new model with a pull request; see the <a href="${esc(site.repo)}/blob/main/CONTRIBUTING.md" rel="noopener">contributing guide</a>.</p>
      <h2>Task categories</h2>
      <p>Task names and definitions come from the Hugging Face task taxonomy (the <code>@huggingface/tasks</code> package), so they match what you see on the Hub.</p>
      <h2>Author</h2>
      <p>Built and maintained by ${esc(site.author.name)}. <a href="${esc(site.author.url)}" rel="noopener">Profile link (placeholder, to be replaced)</a>.</p>
    </article>
    ${footer()}`;
}
