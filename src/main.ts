import "./style.css";
import { families, familyById, modelsOfFamily, problems } from "./data";
import type { Input, Model, Output, Tier } from "./types";

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

let selected: string | null = null;
let activeCol: Input = "image";

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
    <div class="tabs" role="tablist" aria-label="Input modality">
      ${INPUTS.map((i) => `<button role="tab" type="button" id="tab-${i.id}" data-tab="${i.id}" aria-selected="${activeCol === i.id}" tabindex="${activeCol === i.id ? 0 : -1}">${i.label}</button>`).join("")}
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
    <section id="detail" aria-live="polite" aria-label="Details"></section>`;
  renderDetail();
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

document.addEventListener("click", (e) => {
  const t = e.target as HTMLElement;
  const chipEl = t.closest<HTMLElement>(".chip");
  const tabEl = t.closest<HTMLElement>("[data-tab]");
  if (chipEl) {
    selected = selected === chipEl.dataset.family ? null : chipEl.dataset.family!;
    document.querySelectorAll<HTMLElement>(".chip").forEach((c) => c.setAttribute("aria-pressed", String(c.dataset.family === selected)));
    document.querySelector(".grid")!.toggleAttribute("data-has-selection", !!selected);
    renderDetail();
  } else if (tabEl) {
    setTab(tabEl.dataset.tab as Input, false);
  }
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

render();
