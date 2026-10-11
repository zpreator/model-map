import "./style.css";
import { ASK_MAX, INPUTS, askHref, detailPanel, pageMeta, parseFocus, renderMap, startCol, type State } from "./render";
import { NO_FIT, type Fit } from "./lightest";
import type { Input, Tier } from "./types";

const app = document.getElementById("app")!;

// Old-style ?q= links (and the no-JavaScript form) become a #ask= hash.
const qParam = new URLSearchParams(location.search).get("q");
if (qParam && !location.hash) history.replaceState(null, "", askHref(qParam.slice(0, ASK_MAX)));
// The hardware filter lives in the URL (?fit=gpu_8gb&api=1&unknown=1) so a filtered view can be shared.
const FIT_TIERS = ["cpu_edge", "gpu_8gb", "gpu_24gb", "datacenter"];
function fitFromSearch(search: string): Fit {
  const p = new URLSearchParams(search), tier = p.get("fit");
  return tier && FIT_TIERS.includes(tier) ? { tier: tier as Tier, api: p.get("api") === "1", unknown: p.get("unknown") === "1" } : NO_FIT;
}
const withFit = (u: URL) => {
  for (const k of ["fit", "api", "unknown"]) u.searchParams.delete(k);
  if (state.fit.tier) {
    u.searchParams.set("fit", state.fit.tier);
    if (state.fit.api) u.searchParams.set("api", "1");
    if (state.fit.unknown) u.searchParams.set("unknown", "1");
  }
  return u.pathname + u.search + u.hash;
};

const state: State = { focus: parseFocus(location.pathname, location.hash), family: null, col: "image", fit: fitFromSearch(location.search) };
const prerendered = app.querySelector(".grid") !== null;
const fromAsk = state.focus?.kind === "ask"; // the prerendered home page knows nothing about a #ask= link
state.col = prerendered && !fromAsk && !state.fit.tier ? ((app.querySelector(".grid")!.getAttribute("data-col") as Input) ?? "image") : startCol(state.focus);

function render(focusKey?: string) {
  app.innerHTML = renderMap(state);
  const meta = pageMeta(state.focus);
  document.title = meta.title;
  document.querySelector('meta[name="description"]')?.setAttribute("content", meta.description);
  if (focusKey === "title") document.getElementById("page-title")?.focus();
  else if (focusKey) app.querySelector<HTMLElement>(focusKey)?.focus();
}

function navigate(href: string, push: boolean) {
  const wasAsk = state.focus?.kind === "ask";
  const url = new URL(href, location.href);
  state.focus = parseFocus(url.pathname, url.hash);
  state.family = null;
  state.col = startCol(state.focus);
  if (push) history.pushState(null, "", withFit(url)); // links carry no filter, so keep the current one
  else state.fit = fitFromSearch(url.search); // back/forward restore the filter that was in the URL
  const toInput = state.focus?.kind === "ask" || (wasAsk && !state.focus); // clearing a search puts you back in the box
  render(state.focus?.kind === "problem" ? ".preset[aria-current]" : toInput ? "#ask-input" : "title");
  if (!toInput && (!state.focus || state.focus.kind === "task")) document.getElementById("page-title")?.focus();
}

function setTab(col: Input, focus: boolean) {
  state.col = col;
  app.querySelector(".grid")!.setAttribute("data-col", col);
  app.querySelectorAll<HTMLElement>("[data-tab]").forEach((b) => {
    const on = b.dataset.tab === col;
    b.setAttribute("aria-selected", String(on));
    b.tabIndex = on ? 0 : -1;
    if (on && focus) b.focus();
  });
}

/**
 * Keep each cell's "Show N more" control in step with what is visible: overflow chips stay hidden unless the cell is
 * expanded or the chip is the selected family, and the count only includes chips that are still hidden.
 */
function refreshMore(td: HTMLElement) {
  const btn = td.querySelector<HTMLButtonElement>("[data-more]");
  if (!btn) return;
  const expanded = td.hasAttribute("data-expanded");
  const hidden = [...td.querySelectorAll<HTMLElement>("[data-extra]")].filter((c) => c.getAttribute("aria-pressed") !== "true").length;
  btn.setAttribute("aria-expanded", String(expanded));
  btn.textContent = expanded ? "Show fewer" : `Show ${hidden} more`;
  btn.hidden = !expanded && hidden === 0;
}

/** Select/deselect a family without rebuilding the grid, so keyboard focus is kept. */
function selectFamily(fid: string | null) {
  state.family = fid;
  document.getElementById("detail")!.innerHTML = detailPanel(fid, state.fit);
  const active = document.activeElement as HTMLElement | null;
  app.querySelectorAll<HTMLElement>(".chip").forEach((c) => {
    const f = c.dataset.family!;
    c.setAttribute("aria-pressed", String(f === fid));
    if (!state.focus) c.dataset.dim = String(fid ? f !== fid : false);
  });
  app.querySelectorAll<HTMLElement>("td").forEach(refreshMore);
  // A chip that was revealed by selection and just re-hid must not take keyboard focus with it.
  if (active && active.classList.contains("chip") && active.dataset.extra && active.offsetParent === null) {
    active.closest("td")?.querySelector<HTMLElement>("[data-more]")?.focus();
  }
}

app.addEventListener("submit", (e) => {
  const form = (e.target as HTMLElement).closest<HTMLFormElement>("form[data-ask]");
  if (!form) return;
  e.preventDefault();
  const q = new FormData(form).get("q")?.toString().trim().slice(0, ASK_MAX) ?? "";
  navigate(q ? askHref(q) : location.pathname, true);
});

/** Radios pick the size; two checkboxes opt API-only and unknown-size models back in. */
app.addEventListener("change", (e) => {
  const el = e.target as HTMLInputElement;
  if (!el.name?.startsWith("fit")) return;
  const tier = (app.querySelector<HTMLInputElement>('input[name="fit"]:checked')?.value || null) as Tier | null;
  state.fit = {
    tier,
    api: tier ? (app.querySelector<HTMLInputElement>('input[name="fit-api"]')?.checked ?? false) : false,
    unknown: tier ? (app.querySelector<HTMLInputElement>('input[name="fit-unknown"]')?.checked ?? false) : false,
  };
  history.replaceState(null, "", withFit(new URL(location.href)));
  state.family = null; // the selected family may no longer be shown
  render(el.name === "fit" ? 'input[name="fit"]:checked' : `input[name="${el.name}"]`);
});

app.addEventListener("click", (e) => {
  const t = e.target as HTMLElement;
  const nav = t.closest<HTMLAnchorElement>("a[data-nav]");
  if (nav && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && e.button === 0) {
    e.preventDefault();
    navigate(nav.href, true);
    return;
  }
  const more = t.closest<HTMLElement>("[data-more]");
  if (more) {
    const td = more.closest<HTMLElement>("td")!;
    td.toggleAttribute("data-expanded");
    refreshMore(td);
    return;
  }
  const chip = t.closest<HTMLElement>(".chip, .cand");
  if (chip) { selectFamily(chip.classList.contains("chip") && state.family === chip.dataset.family ? null : chip.dataset.family!); return; }
  const tab = t.closest<HTMLElement>("[data-tab]");
  if (tab) setTab(tab.dataset.tab as Input, false);
});

app.addEventListener("keydown", (e) => {
  // Escape in the problem box cancels the search and returns to the regular map.
  if (e.key === "Escape" && (e.target as HTMLElement).id === "ask-input" && state.focus?.kind === "ask") {
    e.preventDefault();
    navigate(location.pathname, true);
    return;
  }
  if (!(e.target as HTMLElement).closest("[data-tab]") || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
  const i = INPUTS.findIndex((x) => x.id === state.col);
  const n = e.key === "Home" ? 0 : e.key === "End" ? INPUTS.length - 1 : (i + (e.key === "ArrowRight" ? 1 : -1) + INPUTS.length) % INPUTS.length;
  e.preventDefault();
  setTab(INPUTS[n].id, true);
});

window.addEventListener("popstate", () => navigate(location.href, false));

if (!prerendered || fromAsk || state.fit.tier) render();
