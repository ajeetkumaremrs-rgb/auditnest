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

type ElementMatch = {
  tag: string;
  openTag: string;
  inner: string;
  attrs: Record<string, string>;
};

function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code: string) => String.fromCharCode(parseInt(code, 16)));
}

function compactText(value: string): string {
  return decodeHtml(
    value
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

function parseAttrs(tagSource: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const source = tagSource
    .replace(/^<\s*\/?\s*[\w:-]+/i, "")
    .replace(/\/?>\s*$/i, "");
  const attrRe = /([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match: RegExpExecArray | null;
  while ((match = attrRe.exec(source))) {
    const [, name, doubleQuoted, singleQuoted, bare] = match;
    attrs[name.toLowerCase()] = decodeHtml(doubleQuoted ?? singleQuoted ?? bare ?? "");
  }
  return attrs;
}

function findElements(html: string, tagNames: string): ElementMatch[] {
  const re = new RegExp(`<(${tagNames})\\b([^>]*)>([\\s\\S]*?)<\\/\\1>`, "gi");
  const matches: ElementMatch[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(html))) {
    const tag = match[1].toLowerCase();
    const openTag = `<${match[1]}${match[2]}>`;
    matches.push({ tag, openTag, inner: match[3], attrs: parseAttrs(openTag) });
  }
  return matches;
}

function findTags(html: string, tagName: string): { source: string; attrs: Record<string, string> }[] {
  const re = new RegExp(`<${tagName}\\b[^>]*>`, "gi");
  const matches: { source: string; attrs: Record<string, string> }[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(html))) matches.push({ source: match[0], attrs: parseAttrs(match[0]) });
  return matches;
}

function attrEquals(attrs: Record<string, string>, name: string, value: string): boolean {
  return (attrs[name] ?? "").toLowerCase() === value;
}

function firstMetaContent(html: string, key: "name" | "property", value: string): string | null {
  for (const tag of findTags(html, "meta")) {
    if (attrEquals(tag.attrs, key, value)) return tag.attrs.content?.trim() || null;
  }
  return null;
}

function firstLinkHref(html: string, relValue: string): string | null {
  for (const tag of findTags(html, "link")) {
    const rels = (tag.attrs.rel ?? "").toLowerCase().split(/\s+/);
    if (rels.includes(relValue)) return tag.attrs.href || null;
  }
  return null;
}

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
  const origin = new URL(finalUrl).origin;

  const abs = (href: string | undefined | null): string | null => {
    if (!href) return null;
    try {
      return new URL(href, finalUrl).toString();
    } catch {
      return null;
    }
  };

  const headings = findElements(html, "h1|h2|h3|h4|h5|h6")
    .map((el) => ({ tag: el.tag, text: compactText(el.inner).slice(0, 200) }))
    .filter((h) => h.text);

  const buttonTexts = findElements(html, "button")
    .map((el) => compactText(el.inner).slice(0, 80))
    .filter(Boolean);
  const roleButtonTexts = findElements(html, "[a-z][\\w:-]*")
    .filter((el) => attrEquals(el.attrs, "role", "button"))
    .map((el) => compactText(el.inner).slice(0, 80))
    .filter(Boolean);
  const buttons = Array.from(new Set([...buttonTexts, ...roleButtonTexts]));

  const ctas: string[] = [];
  const ctaWords = /\b(sign up|get started|start|try|buy|book|download|subscribe|contact|demo|free trial|learn more|join)\b/i;
  [...findElements(html, "a"), ...findElements(html, "button")].forEach((el) => {
    const t = compactText(el.inner);
    if (t && ctaWords.test(t)) ctas.push(t.slice(0, 80));
  });

  const forms = findElements(html, "form").map((el) => ({
    action: el.attrs.action || null,
    inputs: (el.inner.match(/<(input|textarea|select)\b/gi) ?? []).length,
  }));

  const navLinks: string[] = [];
  [...findElements(html, "nav"), ...findElements(html, "header")].forEach((section) => {
    findElements(section.inner, "a").forEach((a) => {
      const t = compactText(a.inner);
      if (t) navLinks.push(t.slice(0, 60));
    });
  });

  const imgs = findTags(html, "img");
  const imageSamples: { src: string; alt: string | null }[] = [];
  let missingAlt = 0;
  imgs.forEach((img, i) => {
    const alt = img.attrs.alt;
    if (alt === undefined || alt.trim() === "") missingAlt++;
    if (i < 8) {
      const src = abs(img.attrs.src || img.attrs["data-src"]);
      if (src) imageSamples.push({ src, alt: alt ?? null });
    }
  });

  let internal = 0;
  let external = 0;
  const linkSamples: string[] = [];
  findElements(html, "a").forEach((el) => {
    const raw = el.attrs.href;
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

  const structuredData: any[] = [];
  findElements(html, "script").filter((el) => attrEquals(el.attrs, "type", "application/ld+json")).forEach((el) => {
    try {
      structuredData.push(JSON.parse(el.inner.trim()));
    } catch {
      /* noop */
    }
  });

  const securityHeaders: Record<string, string | null> = {};
  for (const h of SECURITY_HEADERS) securityHeaders[h] = res.headers.get(h);

  const [robotsRes, sitemapRes] = await Promise.allSettled([
    fetch(new URL("/robots.txt", origin).toString(), { headers: { "User-Agent": UA } }),
    fetch(new URL("/sitemap.xml", origin).toString(), { headers: { "User-Agent": UA } }),
  ]);
  const hasRobots = robotsRes.status === "fulfilled" && robotsRes.value.ok;
  const hasSitemap = sitemapRes.status === "fulfilled" && sitemapRes.value.ok;

  const body = findElements(html, "body")[0]?.inner ?? html;
  const textSample = compactText(body).slice(0, 5000);
  const wordCount = textSample.split(/\s+/).filter(Boolean).length;
  const title = compactText(findElements(html, "title")[0]?.inner ?? "") || null;
  const canonicalHref = firstLinkHref(html, "canonical");
  const iconHref = firstLinkHref(html, "icon") || firstLinkHref(html, "shortcut icon");

  return {
    finalUrl,
    statusCode: res.status,
    title,
    metaDescription: firstMetaContent(html, "name", "description"),
    canonical: canonicalHref ? abs(canonicalHref) : null,
    favicon: abs(iconHref || "/favicon.ico"),
    language: findTags(html, "html")[0]?.attrs.lang || null,
    headings: headings.slice(0, 40),
    h1Count: headings.filter((h) => h.tag === "h1").length,
    buttons: buttons.slice(0, 20),
    ctas: ctas.slice(0, 20),
    forms,
    navLinks: navLinks.slice(0, 20),
    images: { total: imgs.length, missingAlt, samples: imageSamples },
    links: { internal, external, samples: linkSamples },
    structuredData: structuredData.slice(0, 5),
    hasViewport: findTags(html, "meta").some((tag) => attrEquals(tag.attrs, "name", "viewport")),
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
