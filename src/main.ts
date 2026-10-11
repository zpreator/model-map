import "./style.css";
import { INPUTS, detailPanel, pageMeta, parseFocus, renderMap, startCol, type State } from "./render";
import type { Input } from "./types";

const app = document.getElementById("app")!;

const state: State = { focus: parseFocus(location.pathname), family: null, col: "image" };
const prerendered = app.querySelector(".grid") !== null;
state.col = prerendered ? ((app.querySelector(".grid")!.getAttribute("data-col") as Input) ?? "image") : startCol(state.focus);

function render(focusKey?: string) {
  app.innerHTML = renderMap(state);
  const meta = pageMeta(state.focus);
  document.title = meta.title;
  document.querySelector('meta[name="description"]')?.setAttribute("content", meta.description);
  if (focusKey === "title") document.getElementById("page-title")?.focus();
  else if (focusKey) app.querySelector<HTMLElement>(focusKey)?.focus();
}

function navigate(href: string, push: boolean) {
  state.focus = parseFocus(new URL(href, location.href).pathname);
  state.family = null;
  state.col = startCol(state.focus);
  if (push) history.pushState(null, "", href);
  render(state.focus ? ".preset[aria-current]" : "title");
  if (!state.focus || state.focus.kind === "task") document.getElementById("page-title")?.focus();
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

/** Select/deselect a family without rebuilding the grid, so keyboard focus is kept. */
function selectFamily(fid: string | null) {
  state.family = fid;
  document.getElementById("detail")!.innerHTML = detailPanel(fid);
  app.querySelectorAll<HTMLElement>(".chip").forEach((c) => {
    const f = c.dataset.family!;
    c.setAttribute("aria-pressed", String(f === fid));
    if (!state.focus) c.dataset.dim = String(fid ? f !== fid : false);
  });
}

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
    const td = more.closest("td")!;
    const open = td.toggleAttribute("data-expanded");
    more.setAttribute("aria-expanded", String(open));
    more.textContent = open ? "Show fewer" : `Show ${td.querySelectorAll("[data-extra]").length} more`;
    return;
  }
  const chip = t.closest<HTMLElement>(".chip, .cand");
  if (chip) { selectFamily(chip.classList.contains("chip") && state.family === chip.dataset.family ? null : chip.dataset.family!); return; }
  const tab = t.closest<HTMLElement>("[data-tab]");
  if (tab) setTab(tab.dataset.tab as Input, false);
});

app.addEventListener("keydown", (e) => {
  if (!(e.target as HTMLElement).closest("[data-tab]") || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
  const i = INPUTS.findIndex((x) => x.id === state.col);
  const n = e.key === "Home" ? 0 : e.key === "End" ? INPUTS.length - 1 : (i + (e.key === "ArrowRight" ? 1 : -1) + INPUTS.length) % INPUTS.length;
  e.preventDefault();
  setTab(INPUTS[n].id, true);
});

window.addEventListener("popstate", () => navigate(location.href, false));

if (!prerendered) render();
