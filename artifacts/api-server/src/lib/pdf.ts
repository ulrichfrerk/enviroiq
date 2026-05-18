import puppeteer, { type Browser } from "puppeteer";
import { existsSync, readdirSync } from "fs";
import path from "path";

let browserPromise: Promise<Browser> | null = null;

/**
 * Locate a Chromium binary that ships its own runtime libraries (system Chromium installed
 * via Nix). The Puppeteer-bundled Chromium is dynamically linked against glibc + glib2,
 * which are not present on the Replit/Nix container, so we always prefer system Chromium
 * when available and fall back to whatever Puppeteer downloaded.
 */
function findExecutablePath(): string | undefined {
  if (process.env.PUPPETEER_EXECUTABLE_PATH && existsSync(process.env.PUPPETEER_EXECUTABLE_PATH)) {
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }
  // Search the Nix store for a chromium install with all its deps wired in.
  // We deliberately exclude `ungoogled-chromium` because the version pinned in some Nix
  // channels is too old and seg-faults on launch in this container.
  try {
    const dirs = readdirSync("/nix/store")
      .filter((d) => /^[a-z0-9]+-chromium-\d/.test(d) && !d.endsWith(".drv"));
    // Sort by version descending so we prefer the newest available release.
    const versioned = dirs
      .map((d) => {
        const m = d.match(/chromium-(\d+)\.(\d+)\.(\d+)\.(\d+)/);
        const v = m ? Number(m[1]) * 1e9 + Number(m[2]) * 1e6 + Number(m[3]) * 1e3 + Number(m[4]) : 0;
        return { dir: d, version: v };
      })
      .sort((a, b) => b.version - a.version);

    for (const { dir } of versioned) {
      const p = path.join("/nix/store", dir, "bin", "chromium");
      if (existsSync(p)) return p;
    }
  } catch { /* /nix/store may not be readable in some envs */ }
  return undefined;
}

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    const executablePath = findExecutablePath();
    browserPromise = puppeteer.launch({
      headless: true,
      executablePath,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--font-render-hinting=none",
      ],
    }).then((b) => {
      // If the browser ever disconnects (crash, OOM kill), allow a fresh launch next time.
      b.on("disconnected", () => { browserPromise = null; });
      return b;
    }).catch((err) => {
      browserPromise = null;
      throw err;
    });
  }
  return browserPromise;
}

export type PdfOptions = {
  /** Footer text shown bottom-centre (truncated). Page numbers always appended on the right. */
  footerLabel?: string;
  /** Margin in millimetres. Defaults to 0 (template controls all spacing). */
  marginMm?: { top?: number; right?: number; bottom?: number; left?: number };
  /** Whether to render an automatic footer with page numbers + label. Defaults to true. */
  showPageNumbers?: boolean;
  /** Honour @page CSS rules in the HTML (named pages, per-page margins). Defaults to false. */
  preferCSSPageSize?: boolean;
};

/**
 * Render a complete HTML document to a PDF buffer using a shared headless Chromium.
 *
 * The HTML is loaded via a data URL so no temp files / disk I/O are involved.
 * `printBackground` is on so dark cover-page gradients survive into the PDF.
 */
export async function htmlToPdf(html: string, opts: PdfOptions = {}): Promise<Buffer> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 1240, height: 1754, deviceScaleFactor: 2 });
    // Inline the HTML directly via setContent — fastest, no network hop.
    await page.setContent(html, { waitUntil: ["domcontentloaded", "networkidle0"], timeout: 30_000 });
    // Wait one paint frame so any web-fonts / @font-face load before printing.
    await page.evaluateHandle("document.fonts.ready");

    const m = opts.marginMm ?? {};
    const showFooter = opts.showPageNumbers !== false;
    const footerLabel = (opts.footerLabel ?? "EnviroIQ · ESG Platform").replace(/[<>]/g, "");

    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: opts.preferCSSPageSize ?? false,
      margin: {
        top:    `${m.top    ?? 0}mm`,
        right:  `${m.right  ?? 0}mm`,
        bottom: `${m.bottom ?? (showFooter ? 14 : 0)}mm`,
        left:   `${m.left   ?? 0}mm`,
      },
      displayHeaderFooter: showFooter,
      headerTemplate: "<div></div>",
      footerTemplate: showFooter
        ? `<div style="width:100%;font-family:Inter,Arial,sans-serif;font-size:8px;color:#94a3b8;padding:0 14mm;display:flex;justify-content:space-between;align-items:center;">
             <span>${footerLabel}</span>
             <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
           </div>`
        : "",
    });

    return Buffer.from(pdf);
  } finally {
    // Close the page (cheap) but keep the shared browser warm for subsequent renders.
    await page.close().catch(() => {});
  }
}

export async function shutdownPdfRenderer(): Promise<void> {
  if (!browserPromise) return;
  try {
    const b = await browserPromise;
    await b.close();
  } catch { /* swallow */ }
  browserPromise = null;
}
