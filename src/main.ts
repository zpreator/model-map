import "./style.css";
import { families, familyById, modelsOfFamily, models, problems } from "./data";
import { lightestSetup, stepReq, type Req } from "./lightest";
import type { Input, Model, Output, Problem, Tier } from "./types";

const INPUTS: { id: Input; label: string }[] = [
  { id: "image", label: "Image" }, { id: "text", label: "Text" },
  { id: "audio", label: "Audio" }, { id: "video", label: "Video" },
];
const OUTPUTS: { id: Output; label: string }[] = [
  { id: "label", label: "Label / score" }, { id: "embedding", label: "Embedding" },
  { id: "boxes_masks", label: "Boxes / masks" }, { id: "text", label: "Text" }, { id: "media", label: "Media" },
];
// Order matters: the first tier a family has is its chip colour (lightest setup). "api" is a separate axis.
const TIERS: { id: Tier; label: string; short: string }[] = [
  { id: "cpu_edge", label: "CPU / edge", short: "C" },
  { id: "gpu_8gb", label: "8 GB GPU", short: "8" },
  { id: "gpu_24gb", label: "24 GB GPU", short: "24" },
  { id: "datacenter", label: "Datacenter", short: "DC" },
  { id: "api", label: "API only", short: "API" },
];
const tierMeta = new Map(TIERS.map((t) => [t.id, t]));
const inLabel = new Map(INPUTS.map((i) => [i.id, i.label]));
const outLabel = new Map(OUTPUTS.map((o) => [o.id, o.label]));

const familyTiers = (fid: string): Tier[] => {
  const present = new Set(modelsOfFamily(fid).flatMap((m) => m.tiers));
  return TIERS.filter((t) => present.has(t.id)).map((t) => t.id);
};
const familyCells = (fid: string, i: Input, o: Output) =>
  modelsOfFamily(fid).some((m) => m.cells.some((c) => c.input === i && c.output === o));

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

const modelById = new Map(models.map((m) => [m.id, m]));
let selected: string | null = null; // family shown in the details panel
let activeProblem: Problem | null = null;
let activeCol: Input = "image";

/** Families (and their grid columns) that appear in the active problem. */
function involved(): { fams: Set<string>; cols: Set<Input> } {
  const fams = new Set<string>(), cols = new Set<Input>();
  for (const s of activeProblem?.steps ?? []) for (const id of s.models) {
    const m = modelById.get(id);
    if (!m) continue;
    fams.add(m.family);
    m.cells.forEach((c) => cols.add(c.input));
  }
  return { fams, cols };
}

/** Column to show first for the active problem: the input of its first step's first model. */
const startCol = (): Input | null => modelById.get(activeProblem?.steps[0]?.models[0] ?? "")?.cells[0]?.input ?? null;

function chip(fid: string): string {
  const tiers = familyTiers(fid);
  const color = tiers[0] ?? "unknown";
  const badges = tiers.length
    ? tiers.map((t) => `<span class="badge">${tierMeta.get(t)!.short}</span>`).join("")
    : `<span class="badge">?</span>`;
  return `<button type="button" class="chip" data-family="${fid}" data-tier="${color}" aria-pressed="${selected === fid}">
    <span class="chip-name">${esc(familyById.get(fid)!.name)}</span><span class="badges" aria-hidden="true">${badges}</span></button>`;
}

function render() {
  const app = document.getElementById("app")!;
  const head = INPUTS.map((i) => `<th scope="col" data-col="${i.id}">${i.label}</th>`).join("");
  const rows = OUTPUTS.map((o) => {
    const cells = INPUTS.map((i) => {
      const fids = families.filter((f) => familyCells(f.id, i.id, o.id)).map((f) => f.id);
      return `<td data-col="${i.id}">${fids.map(chip).join("") || `<span class="empty" aria-hidden="true">·</span>`}</td>`;
    }).join("");
    return `<tr><th scope="row">${o.label}</th>${cells}</tr>`;
  }).join("");

  app.innerHTML = `
    <header><h1>Model Map</h1><p class="lede">Which model fits my problem? Models sit where their input (columns) meets their output (rows).</p></header>
    <section class="presets" aria-label="Problem presets">
      <h2 class="presets-title">Start from a problem</h2>
      <div class="preset-list">${problems.map((p) => `<button type="button" class="preset" data-problem="${p.id}" aria-pressed="${activeProblem?.id === p.id}">${esc(p.title)}</button>`).join("")}</div>
    </section>
    <div class="tabs" role="tablist" aria-label="Input modality">
      ${INPUTS.map((i) => `<button role="tab" type="button" id="tab-${i.id}" data-tab="${i.id}" aria-selected="${activeCol === i.id}" tabindex="${activeCol === i.id ? 0 : -1}">${i.label}<span class="dot" hidden> <span class="sr-only">(has highlighted models)</span></span></button>`).join("")}
    </div>
    <div class="grid-wrap"><table class="grid" data-col="${activeCol}">
      <caption class="sr-only">Models by input modality (columns) and output type (rows)</caption>
      <thead><tr><td class="corner"><span class="sr-only">Output type</span></td>${head}</tr></thead>
      <tbody>${rows}</tbody></table></div>
    <ul class="legend" aria-label="Deployment tier legend">
      ${TIERS.map((t) => `<li><span class="swatch" data-tier="${t.id}"><span class="badge">${t.short}</span></span>${t.label}</li>`).join("")}
      <li><span class="swatch" data-tier="unknown"><span class="badge">?</span></span>Unknown</li>
    </ul>
    <p class="legend-note">Colour is the lightest tier any model in the family needs; badges list every tier it spans. Tiers are coarse and unverified.</p>
    <section id="problem" aria-live="polite" aria-label="Problem steps"></section>
    <section id="detail" aria-live="polite" aria-label="Details"></section>`;
  renderProblem();
  renderDetail();
  applyHighlight();
}

function renderDetail() {
  const el = document.getElementById("detail")!;
  if (!selected) { el.innerHTML = `<p class="hint">Select a model to see details. Select it again to clear.</p>`; return; }
  const fam = familyById.get(selected)!;
  const members = modelsOfFamily(selected);
  const usedBy = problems.filter((p) => p.steps.some((s) => s.models.some((id) => members.some((m) => m.id === id))));
  const row = (m: Model) => `<li class="member">
      <h3>${esc(m.name)} ${m.verified ? `<span class="tag ok">verified</span>` : `<span class="tag">unverified</span>`}</h3>
      <dl>
        <dt>Takes → gives</dt><dd>${m.cells.map((c) => `${inLabel.get(c.input)} → ${outLabel.get(c.output)}`).join("; ")}</dd>
        <dt>Tier</dt><dd>${m.tiers.length ? m.tiers.map((t) => tierMeta.get(t)!.label).join(", ") : "unknown"}</dd>
        <dt>License</dt><dd>${m.license ? esc(m.license) : "unknown"}${m.open_weights === false ? " (closed)" : m.open_weights ? " (open weights)" : ""}</dd>
        ${m.hf_task ? `<dt>Hub task</dt><dd>${esc(m.hf_task)}</dd>` : ""}
        ${m.links.length ? `<dt>Links</dt><dd>${m.links.map((l) => `<a href="${esc(l.url)}" rel="noopener">${esc(l.label)}</a>`).join(", ")}</dd>` : ""}
      </dl>${m.notes ? `<p class="notes">${esc(m.notes)}</p>` : ""}</li>`;
  el.innerHTML = `<h2>${esc(fam.name)}</h2>${fam.summary ? `<p>${esc(fam.summary)}</p>` : ""}
    <p class="used"><strong>Used in:</strong> ${usedBy.length ? usedBy.map((p) => esc(p.title)).join(", ") : "no problem presets yet"}</p>
    <ul class="members">${members.map(row).join("")}</ul>`;
}

const reqLabel = (r: Req) => (r.kind === "hw" ? tierMeta.get(r.tier)!.label : r.kind === "api" ? "API only" : "unknown");
const reqTier = (r: Req) => (r.kind === "hw" ? r.tier : r.kind === "api" ? "api" : "unknown");

function renderProblem() {
  const el = document.getElementById("problem")!;
  const p = activeProblem;
  if (!p) { el.innerHTML = `<p class="hint">Pick a problem above to see its steps and which models fit each one.</p>`; return; }
  const l = lightestSetup(p, modelById);
  const parts: string[] = [];
  if (l.hw) parts.push(`<strong>${tierMeta.get(l.hw)!.label}</strong>`);
  else if (!l.apiSteps.length) parts.push(`<strong>Unknown</strong>`);
  if (l.apiSteps.length) parts.push(`${l.hw ? "plus " : ""}<strong>API</strong> for: ${l.apiSteps.map(esc).join("; ")}`);
  if (l.unknownSteps.length) parts.push(`no tier data yet for: ${l.unknownSteps.map(esc).join("; ")}`);
  const steps = p.steps.map((s) => {
    const cands = s.models.map((id) => modelById.get(id)).filter((m): m is Model => !!m);
    return `<li><h3>${esc(s.label)}</h3>
      <ul class="cands">${cands.map((m) => { const r = stepReq([m]); return `<li><button type="button" class="cand" data-family="${m.family}" data-tier="${reqTier(r)}">${esc(m.name)} <span class="badge">${r.kind === "hw" ? tierMeta.get(r.tier)!.short : r.kind === "api" ? "API" : "?"}</span></button></li>`; }).join("")}</ul>
      <p class="step-req">Lightest here: ${reqLabel(stepReq(cands))}</p></li>`;
  }).join("");
  el.innerHTML = `<h2>${esc(p.title)}</h2>
    <ol class="steps">${steps}</ol>
    <div class="lightest"><h3>Lightest setup</h3><p>${parts.join("; ")}</p>
      <p class="fine">Per step, the lightest option; overall, the heaviest of those. API-only options are reported separately. Tiers are unverified estimates.</p></div>
    ${p.note ? `<p class="notes">${esc(p.note)}</p>` : ""}`;
}

/** Dim/highlight chips and mark tabs, without rebuilding the grid (keeps keyboard focus). */
function applyHighlight() {
  const inv = involved();
  document.querySelectorAll<HTMLElement>(".chip").forEach((c) => {
    const f = c.dataset.family!;
    c.dataset.dim = String(activeProblem ? !inv.fams.has(f) : selected ? f !== selected : false);
    c.dataset.involved = String(!!activeProblem && inv.fams.has(f));
    c.setAttribute("aria-pressed", String(f === selected));
  });
  document.querySelectorAll<HTMLElement>("[data-tab]").forEach((b) => {
    b.querySelector<HTMLElement>(".dot")!.hidden = !(activeProblem && inv.cols.has(b.dataset.tab as Input));
  });
}

function selectFamily(fid: string | null) {
  selected = fid;
  renderDetail();
  applyHighlight();
}

function selectProblem(id: string | null) {
  activeProblem = problems.find((p) => p.id === id) ?? null;
  document.querySelectorAll<HTMLElement>(".preset").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.problem === activeProblem?.id)));
  if (activeProblem) {
    const first = startCol();
    if (first) setTab(first, false);
  }
  renderProblem();
  applyHighlight();
  history.replaceState(null, "", activeProblem ? `#problem=${activeProblem.id}` : location.pathname + location.search);
}

document.addEventListener("click", (e) => {
  const t = e.target as HTMLElement;
  const chipEl = t.closest<HTMLElement>(".chip, .cand");
  const presetEl = t.closest<HTMLElement>(".preset");
  const tabEl = t.closest<HTMLElement>("[data-tab]");
  if (chipEl) selectFamily(chipEl.classList.contains("chip") && selected === chipEl.dataset.family ? null : chipEl.dataset.family!);
  else if (presetEl) selectProblem(activeProblem?.id === presetEl.dataset.problem ? null : presetEl.dataset.problem!);
  else if (tabEl) setTab(tabEl.dataset.tab as Input, false);
});

function setTab(col: Input, focus: boolean) {
  activeCol = col;
  document.querySelector(".grid")!.setAttribute("data-col", col);
  document.querySelectorAll<HTMLElement>("[data-tab]").forEach((b) => {
    const on = b.dataset.tab === col;
    b.setAttribute("aria-selected", String(on));
    b.tabIndex = on ? 0 : -1;
    if (on && focus) b.focus();
  });
}
document.addEventListener("keydown", (e) => {
  const tabEl = (e.target as HTMLElement).closest<HTMLElement>("[data-tab]");
  if (!tabEl || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
  const i = INPUTS.findIndex((x) => x.id === activeCol);
  const n = e.key === "Home" ? 0 : e.key === "End" ? INPUTS.length - 1 : (i + (e.key === "ArrowRight" ? 1 : -1) + INPUTS.length) % INPUTS.length;
  e.preventDefault();
  setTab(INPUTS[n].id, true);
});

const fromHash = new URLSearchParams(location.hash.slice(1)).get("problem");
activeProblem = problems.find((p) => p.id === fromHash) ?? null;
activeCol = startCol() ?? activeCol;
render();
