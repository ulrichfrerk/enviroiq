import { useEffect } from "react";

interface PageMeta {
  title: string;
  description: string;
  canonical?: string;
}

function setMeta(name: string, content: string, attr: "name" | "property" = "name") {
  if (typeof document === "undefined") return;
  let el = document.querySelector<HTMLMetaElement>(`meta[${attr}="${name}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, name);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function setLink(rel: string, href: string) {
  if (typeof document === "undefined") return;
  let el = document.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", rel);
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
}

/**
 * Updates document.title and key SEO/social meta tags when a page mounts.
 * Used for client-side route changes; the static index.html provides the
 * initial values that crawlers see, and pre-rendered HTML overrides them
 * for each route at build time.
 */
export function usePageMeta(meta: PageMeta) {
  useEffect(() => {
    document.title = meta.title;
    setMeta("description", meta.description);
    setMeta("og:title", meta.title, "property");
    setMeta("og:description", meta.description, "property");
    setMeta("twitter:title", meta.title);
    setMeta("twitter:description", meta.description);
    if (meta.canonical) {
      setLink("canonical", meta.canonical);
      setMeta("og:url", meta.canonical, "property");
    }
  }, [meta.title, meta.description, meta.canonical]);
}

export const PAGE_META = {
  home: {
    title: "EnviroIQ — Real-Time ESG Intelligence for New Zealand Organisations",
    description:
      "Audit-grade ESG data your board, auditor, and regulator will actually trust. Real-time emissions, full E+S+G coverage, immutable audit log, AI ESG Advisor, NZ em6 grid data, supplier audits, CRM integration API.",
    canonical: "https://enviroiq.net/",
  },
  trust: {
    title: "Trust & Compliance — EnviroIQ",
    description:
      "Every ESG number, fully traceable from source to output. Live operational compliance status, downloadable trust pack, immutable audit log, versioned emission factors, passwordless authentication. SOC 2, ISO 27001, NZ Privacy Act, GDPR aligned.",
    canonical: "https://enviroiq.net/trust",
  },
} as const;
