// Post-build step: writes a fully rendered HTML file for every page, plus sitemap.xml, robots.txt, 404.html.
// Runs src/prerender.ts through Vite's SSR loader so it shares the exact render code the browser uses.
import { createServer } from "vite";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const site = JSON.parse(readFileSync("site.json", "utf8"));
const siteUrl = process.env.SITE_URL ?? site.url;
const dist = "dist";
const template = readFileSync(join(dist, "index.html"), "utf8");
if (!template.includes("<!--head-->") || !template.includes("<!--app-->")) throw new Error("dist/index.html lost its placeholders");

const esc = (s) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const headFor = (p) => `<title>${esc(p.title)}</title>
    <meta name="description" content="${esc(p.description)}" />
    <link rel="canonical" href="${siteUrl}${p.path}" />
    <meta property="og:site_name" content="${esc(site.name)}" />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="${esc(p.title)}" />
    <meta property="og:description" content="${esc(p.description)}" />
    <meta property="og:url" content="${siteUrl}${p.path}" />
    <meta name="twitter:card" content="summary" />`;

const vite = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
try {
  const { buildPages, sitemapUrls } = await vite.ssrLoadModule("/src/prerender.ts");
  const pages = buildPages();
  for (const p of pages) {
    let html = template.replace("<!--head-->", headFor(p)).replace("<!--app-->", p.app);
    if (!p.interactive) html = html.replace(/<script type="module"[^>]*><\/script>\s*/g, "");
    const file = join(dist, p.path, "index.html");
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, html);
  }
  writeFileSync(join(dist, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemapUrls(pages).map((u) => `  <url><loc>${u}</loc></url>`).join("\n")}\n</urlset>\n`);
  writeFileSync(join(dist, "robots.txt"), `User-agent: *\nAllow: /\n\nSitemap: ${siteUrl}sitemap.xml\n`);
  const notFound = { path: "", title: `Page not found | ${site.name}`, description: "This page does not exist.", app: `<nav class="topbar"><a class="brand" href="${new URL(siteUrl).pathname}">${esc(site.name)}</a></nav><header class="page-head"><h1>Page not found</h1><p class="lede"><a href="${new URL(siteUrl).pathname}">Back to the map</a></p></header>` };
  writeFileSync(join(dist, "404.html"), template.replace("<!--head-->", `<title>${esc(notFound.title)}</title><meta name="robots" content="noindex" />`).replace("<!--app-->", notFound.app).replace(/<script type="module"[^>]*><\/script>\s*/g, ""));
  console.log(`prerendered ${pages.length} pages`);
} finally {
  await vite.close();
}
