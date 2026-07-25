import * as cheerio from "cheerio";
import type { Extracted, LighthouseSummary } from "./audit-shared";

const UA =
  "Mozilla/5.0 (compatible; ConvertIQBot/1.0; +https://convertiq.app) AppleWebKit/537.36";

export function normalizeUrl(input: string): string {
  let u = input.trim();
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  const parsed = new URL(u);
  return parsed.toString();
}

const SECURITY_HEADERS = [
  "strict-transport-security",
  "content-security-policy",
  "x-content-type-options",
  "x-frame-options",
  "referrer-policy",
  "permissions-policy",
];

export async function crawlSite(rawUrl: string): Promise<Extracted> {
  const url = normalizeUrl(rawUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html,*/*;q=0.8" },
      redirect: "follow",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  const finalUrl = res.url || url;
  const html = await res.text();
  const $ = cheerio.load(html);
  const origin = new URL(finalUrl).origin;

  const abs = (href: string | undefined | null): string | null => {
    if (!href) return null;
    try {
      return new URL(href, finalUrl).toString();
    } catch {
      return null;
    }
  };

  const headings: { tag: string; text: string }[] = [];
  $("h1,h2,h3,h4,h5,h6").each((_, el) => {
    const text = $(el).text().trim().replace(/\s+/g, " ");
    if (text) headings.push({ tag: el.tagName.toLowerCase(), text: text.slice(0, 200) });
  });

  const buttons: string[] = [];
  $("button, [role=button]").each((_, el) => {
    const t = $(el).text().trim().replace(/\s+/g, " ");
    if (t) buttons.push(t.slice(0, 80));
  });

  const ctas: string[] = [];
  const ctaWords = /\b(sign up|get started|start|try|buy|book|download|subscribe|contact|demo|free trial|learn more|join)\b/i;
  $("a, button").each((_, el) => {
    const t = $(el).text().trim().replace(/\s+/g, " ");
    if (t && ctaWords.test(t)) ctas.push(t.slice(0, 80));
  });

  const forms: { action: string | null; inputs: number }[] = [];
  $("form").each((_, el) => {
    forms.push({
      action: $(el).attr("action") || null,
      inputs: $(el).find("input, textarea, select").length,
    });
  });

  const navLinks: string[] = [];
  $("nav a, header a").each((_, el) => {
    const t = $(el).text().trim();
    if (t) navLinks.push(t.slice(0, 60));
  });

  const imgs = $("img");
  const imageSamples: { src: string; alt: string | null }[] = [];
  let missingAlt = 0;
  imgs.each((i, el) => {
    const alt = $(el).attr("alt");
    if (alt === undefined || alt.trim() === "") missingAlt++;
    if (i < 8) {
      const src = abs($(el).attr("src") || $(el).attr("data-src"));
      if (src) imageSamples.push({ src, alt: alt ?? null });
    }
  });

  let internal = 0;
  let external = 0;
  const linkSamples: string[] = [];
  $("a[href]").each((_, el) => {
    const raw = $(el).attr("href");
    if (!raw || raw.startsWith("#") || raw.startsWith("mailto:") || raw.startsWith("tel:")) return;
    const a = abs(raw);
    if (!a) return;
    try {
      const u = new URL(a);
      if (u.origin === origin) internal++;
      else external++;
      if (linkSamples.length < 12) linkSamples.push(a);
    } catch {
      /* noop */
    }
  });

  const structuredData: unknown[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      structuredData.push(JSON.parse($(el).contents().text()));
    } catch {
      /* noop */
    }
  });

  const securityHeaders: Record<string, string | null> = {};
  for (const h of SECURITY_HEADERS) securityHeaders[h] = res.headers.get(h);

  const [robotsRes, sitemapRes] = await Promise.allSettled([
    fetch(new URL("/robots.txt", origin), { headers: { "User-Agent": UA } }),
    fetch(new URL("/sitemap.xml", origin), { headers: { "User-Agent": UA } }),
  ]);
  const hasRobots = robotsRes.status === "fulfilled" && robotsRes.value.ok;
  const hasSitemap = sitemapRes.status === "fulfilled" && sitemapRes.value.ok;

  const textSample = $("body").text().replace(/\s+/g, " ").trim().slice(0, 5000);
  const wordCount = textSample.split(/\s+/).filter(Boolean).length;

  return {
    finalUrl,
    statusCode: res.status,
    title: $("title").first().text().trim() || null,
    metaDescription: $('meta[name="description"]').attr("content")?.trim() || null,
    canonical: $('link[rel="canonical"]').attr("href") || null,
    favicon: abs($('link[rel~="icon"]').attr("href") || "/favicon.ico"),
    language: $("html").attr("lang") || null,
    headings: headings.slice(0, 40),
    h1Count: headings.filter((h) => h.tag === "h1").length,
    buttons: buttons.slice(0, 20),
    ctas: ctas.slice(0, 20),
    forms,
    navLinks: navLinks.slice(0, 20),
    images: { total: imgs.length, missingAlt, samples: imageSamples },
    links: { internal, external, samples: linkSamples },
    structuredData: structuredData.slice(0, 5),
    hasViewport: $('meta[name="viewport"]').length > 0,
    hasRobots,
    hasSitemap,
    securityHeaders,
    sslValid: finalUrl.startsWith("https://"),
    textSample,
    wordCount,
  };
}

export async function runLighthouse(url: string): Promise<LighthouseSummary> {
  const endpoint = new URL("https://www.googleapis.com/pagespeedonline/v5/runPagespeed");
  endpoint.searchParams.set("url", url);
  endpoint.searchParams.set("strategy", "mobile");
  for (const c of ["performance", "accessibility", "best-practices", "seo"]) {
    endpoint.searchParams.append("category", c);
  }
  const apiKey = process.env.PAGESPEED_API_KEY;
  if (apiKey) endpoint.searchParams.set("key", apiKey);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 55000);
  try {
    const res = await fetch(endpoint, { signal: controller.signal });
    if (!res.ok) {
      return emptyLighthouse(`PageSpeed API returned ${res.status}`);
    }
    const data: any = await res.json();
    const cats = data.lighthouseResult?.categories ?? {};
    const audits = data.lighthouseResult?.audits ?? {};
    const score = (k: string) =>
      typeof cats[k]?.score === "number" ? Math.round(cats[k].score * 100) : null;
    return {
      performance: score("performance"),
      accessibility: score("accessibility"),
      bestPractices: score("best-practices"),
      seo: score("seo"),
      metrics: {
        fcp: audits["first-contentful-paint"]?.displayValue ?? null,
        lcp: audits["largest-contentful-paint"]?.displayValue ?? null,
        cls: audits["cumulative-layout-shift"]?.displayValue ?? null,
        tbt: audits["total-blocking-time"]?.displayValue ?? null,
        tti: audits["interactive"]?.displayValue ?? null,
        si: audits["speed-index"]?.displayValue ?? null,
      },
      screenshot: audits["final-screenshot"]?.details?.data ?? null,
      strategy: "mobile",
      fetchTime: data.lighthouseResult?.fetchTime ?? null,
    };
  } catch (e) {
    return emptyLighthouse(e instanceof Error ? e.message : String(e));
  } finally {
    clearTimeout(timeout);
  }
}

function emptyLighthouse(error: string): LighthouseSummary {
  return {
    performance: null,
    accessibility: null,
    bestPractices: null,
    seo: null,
    metrics: { fcp: null, lcp: null, cls: null, tbt: null, tti: null, si: null },
    screenshot: null,
    strategy: "mobile",
    fetchTime: null,
    error,
  };
}
