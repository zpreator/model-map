// Loaded by scripts/prerender.mjs through Vite's SSR loader: builds the HTML for every static page.
import { problems, tasks } from "./data";
import { SITE_URL, pageMeta, renderMap, renderMethodology, startCol, type Focus } from "./render";
import site from "../site.json";

export interface Page { path: string; title: string; description: string; app: string; interactive: boolean }

export function buildPages(): Page[] {
  const foci: Focus[] = [null, ...problems.map((p) => ({ kind: "problem" as const, id: p.id })), ...tasks.map((t) => ({ kind: "task" as const, id: t.id }))];
  const pages: Page[] = foci.map((focus) => {
    const meta = pageMeta(focus);
    return { path: meta.path, title: meta.title, description: meta.description, app: renderMap({ focus, family: null, col: startCol(focus) }), interactive: true };
  });
  pages.push({
    path: "methodology/", title: `Methodology | ${site.name}`, interactive: false, app: renderMethodology(),
    description: "How the Model Map defines deployment tiers, verifies entries, and chooses which models to show.",
  });
  return pages;
}

export const sitemapUrls = (pages: Page[]) => pages.map((p) => SITE_URL + p.path);
