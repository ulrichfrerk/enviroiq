#!/usr/bin/env node
/**
 * Build-time prerender script.
 *
 * Reads the freshly-built client `dist/public/index.html`, renders each
 * route through the SSR bundle in `dist/server/entry-server.js`, injects
 * the rendered markup into the `<div id="root">` placeholder, swaps in
 * per-route <title>, <meta description>, and canonical/og:url, and writes
 * one HTML file per route.
 *
 * After this script runs, `dist/public/` contains:
 *   - index.html         (prerendered home)
 *   - trust/index.html   (prerendered trust page)
 *   - …all the original assets, sitemap.xml, robots.txt, llms.txt, etc.
 *
 * Crawlers and AI assistants that don't execute JavaScript get real,
 * indexable HTML for every public route. JS-capable browsers hydrate
 * the prerendered DOM via React's hydrateRoot.
 */
import { pathToFileURL } from "node:url";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const marketingRoot = resolve(__dirname, "..");
const clientOut = join(marketingRoot, "dist", "public");
const serverEntry = join(marketingRoot, "dist", "server", "entry-server.js");
const templatePath = join(clientOut, "index.html");

if (!existsSync(templatePath)) {
  console.error(`[prerender] Client build not found at ${templatePath}`);
  process.exit(1);
}
if (!existsSync(serverEntry)) {
  console.error(`[prerender] SSR build not found at ${serverEntry}`);
  process.exit(1);
}

const template = readFileSync(templatePath, "utf-8");

const { render, ROUTES, ROUTE_META } = await import(
  pathToFileURL(serverEntry).href
);

function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function applyMeta(html, meta) {
  if (!meta) return html;
  let out = html;

  // Replace <title>
  out = out.replace(
    /<title>[\s\S]*?<\/title>/,
    `<title>${escapeHtml(meta.title)}</title>`,
  );

  // Replace meta description
  out = out.replace(
    /<meta\s+name="description"\s+content="[^"]*"\s*\/?>/,
    `<meta name="description" content="${escapeHtml(meta.description)}" />`,
  );

  // Replace og:title
  out = out.replace(
    /<meta\s+property="og:title"\s+content="[^"]*"\s*\/?>/,
    `<meta property="og:title" content="${escapeHtml(meta.title)}" />`,
  );

  // Replace og:description
  out = out.replace(
    /<meta\s+property="og:description"\s+content="[^"]*"\s*\/?>/,
    `<meta property="og:description" content="${escapeHtml(meta.description)}" />`,
  );

  // Replace twitter:title
  out = out.replace(
    /<meta\s+name="twitter:title"\s+content="[^"]*"\s*\/?>/,
    `<meta name="twitter:title" content="${escapeHtml(meta.title)}" />`,
  );

  // Replace twitter:description
  out = out.replace(
    /<meta\s+name="twitter:description"\s+content="[^"]*"\s*\/?>/,
    `<meta name="twitter:description" content="${escapeHtml(meta.description)}" />`,
  );

  // Replace canonical
  out = out.replace(
    /<link\s+rel="canonical"\s+href="[^"]*"\s*\/?>/,
    `<link rel="canonical" href="${escapeHtml(meta.canonical)}" />`,
  );

  // Replace og:url
  out = out.replace(
    /<meta\s+property="og:url"\s+content="[^"]*"\s*\/?>/,
    `<meta property="og:url" content="${escapeHtml(meta.canonical)}" />`,
  );

  return out;
}

const errors = [];

for (const route of ROUTES) {
  try {
    const appHtml = render(route);
    const meta = ROUTE_META[route];
    // Match the root container and everything up to its closing </div>.
    // The noscript fallback inside contains no <div> tags, so the
    // non-greedy match terminates at the root's own closing tag.
    const rootRe = /<div id="root">[\s\S]*?<\/div>/;
    if (!rootRe.test(template)) {
      throw new Error("Could not find <div id=\"root\">...</div> in template");
    }
    let pageHtml = template.replace(
      rootRe,
      `<div id="root">${appHtml}</div>`,
    );
    pageHtml = applyMeta(pageHtml, meta);

    const outPath =
      route === "/"
        ? join(clientOut, "index.html")
        : join(clientOut, route.replace(/^\//, ""), "index.html");

    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, pageHtml, "utf-8");
    console.log(
      `[prerender] ${route.padEnd(10)} → ${outPath.replace(marketingRoot + "/", "")}  (${(pageHtml.length / 1024).toFixed(1)} KB)`,
    );
  } catch (err) {
    errors.push({ route, err });
    console.error(`[prerender] ${route} FAILED:`, err);
  }
}

if (errors.length > 0) {
  console.error(`[prerender] ${errors.length} route(s) failed`);
  process.exit(1);
}

console.log(`[prerender] Done. ${ROUTES.length} routes prerendered.`);
