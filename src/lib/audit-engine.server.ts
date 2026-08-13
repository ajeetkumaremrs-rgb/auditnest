import type { Extracted, HtmlEstimate, LighthouseSummary } from "./audit-shared";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent": UA,
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
  "Upgrade-Insecure-Requests": "1",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
};

const FETCH_TIMEOUT_MS = 30000;

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
  const source = tagSource.replace(/^<\s*\/?\s*[\w:-]+/i, "").replace(/\/?>\s*$/i, "");
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

function collectPrefixedMeta(html: string, prefix: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const tag of findTags(html, "meta")) {
    const key = (tag.attrs.property || tag.attrs.name || "").toLowerCase();
    if (key.startsWith(prefix) && tag.attrs.content) out[key] = tag.attrs.content.trim();
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Anti-bot detection + JS rendering fallback                          */
/* ------------------------------------------------------------------ */

const CHALLENGE_MARKERS = [
  "enable javascript and cookies to continue",
  "just a moment",
  "checking your browser",
  "checking if the site connection is secure",
  "verify you are human",
  "verifying you are human",
  "attention required! | cloudflare",
  "please enable js and disable any ad blocker",
  "ddos protection by cloudflare",
  "access denied",
  "request unsuccessful. incapsula",
  "pardon our interruption",
  "cf-browser-verification",
  "cf_chl_opt",
  "/cdn-cgi/challenge-platform",
  "captcha-delivery.com",
  "g-recaptcha",
  "h-captcha",
  "are you a robot",
  "unusual traffic from your computer network",
  "bot detection",
  "perimeterx",
  "px-captcha",
];

function detectChallenge(status: number, html: string): string | null {
  const lower = html.slice(0, 20000).toLowerCase();
  for (const marker of CHALLENGE_MARKERS) {
    if (lower.includes(marker)) return "Anti-bot / CAPTCHA challenge page detected";
  }
  if (status === 401) return "Origin returned HTTP 401 (authentication required)";
  if (status === 403) return "Origin returned HTTP 403 (crawler blocked)";
  if (status === 429) return "Origin returned HTTP 429 (rate limited)";
  if (status === 503 && compactText(html).length < 800) return "Origin returned HTTP 503 challenge";
  if (status >= 500) return `Origin returned HTTP ${status} (server error)`;
  if (status >= 400) return `Origin returned HTTP ${status}`;
  // Large app shells (YouTube and similar SPAs) often contain valid title,
  // metadata and structured data but very little server-rendered body text.
  // Treat only genuinely tiny responses as unreadable; partial shells are
  // classified after extraction so their usable facts are not discarded.
  if (html.length < 5000 && compactText(html).length < 200) {
    return "Origin returned an empty or JS-only shell";
  }
  return null;
}

/** Many origins block generic browser UAs but allow well-known search crawlers. */
const CRAWLER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Cache-Control": "no-cache",
};

async function fetchWithHeaders(
  url: string,
  headers: Record<string, string>,
): Promise<{ res: Response; html: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers, redirect: "follow", signal: controller.signal });
    const html = await res.text();
    return { res, html };
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      throw new Error(`Request timed out after ${FETCH_TIMEOUT_MS / 1000}s: ${url}`);
    }
    throw new Error(
      `Network error fetching ${url}: ${e instanceof Error ? e.message : String(e)}`,
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchWithBrowserHeaders(url: string, referer?: string): Promise<{ res: Response; html: string }> {

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: referer ? { ...BROWSER_HEADERS, Referer: referer } : BROWSER_HEADERS,
      redirect: "follow",
      signal: controller.signal,
    });
    // The runtime transparently handles gzip/deflate/br content-encoding.
    const html = await res.text();
    return { res, html };
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      throw new Error(`Request timed out after ${FETCH_TIMEOUT_MS / 1000}s: ${url}`);
    }
    throw new Error(
      `Network error fetching ${url}: ${e instanceof Error ? e.message : String(e)}`,
    );
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Headless-browser rendering. Playwright/Puppeteer/Chromium cannot run inside
 * this serverless runtime (no native browser binary and no subprocesses), so
 * rendering is delegated to a remote headless-Chromium service that executes
 * JavaScript, waits for the page to settle, and returns the final DOM.
 * Works for React, Next.js, Vue, Angular and other client-rendered apps.
 */
const RENDER_TIMEOUT_MS = 45000;

async function renderOnce(url: string, waitMs: number): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RENDER_TIMEOUT_MS);
  try {
    const token = process.env["JINA_API_KEY"];
    const res = await fetch(`https://r.jina.ai/${url}`, {
      headers: {
        "x-return-format": "html",
        "x-timeout": "30",
        "x-wait-for-selector": "body",
        "x-target-selector": "body",
        "x-engine": "browser",
        "x-cache-tolerance": "0",
        ...(waitMs ? { "x-wait-for-timeout": String(waitMs) } : {}),
        Accept: "text/html,*/*;q=0.8",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const html = await res.text();
    if (!html || compactText(html).length < 200) return null;
    return html;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/** Renders with retries; each attempt waits longer for hydration. */
async function fetchRendered(url: string): Promise<string | null> {
  const waits = [0, 2500, 6000];
  for (let i = 0; i < waits.length; i++) {
    const html = await renderOnce(url, waits[i]);
    if (html) return html;
    if (i < waits.length - 1) await new Promise((r) => setTimeout(r, 1000));
  }
  return null;
}

/** Amount of real, visible body text a document exposes. */
function bodyTextLength(html: string): number {
  const body = new RegExp("<body\\b[^>]*>([\\s\\S]*?)<\\/body>", "i").exec(html)?.[1] ?? html;
  return compactText(body).length;
}


/* ------------------------------------------------------------------ */
/* HTML-only deterministic scoring                                     */
/* ------------------------------------------------------------------ */

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

function estimateFromHtml(e: Omit<Extracted, "htmlEstimate">): HtmlEstimate {
  if (e.blocked) return { seo: null, accessibility: null, bestPractices: null };

  // SEO
  let seo = 100;
  const titleLen = e.title?.length ?? 0;
  if (!titleLen) seo -= 20;
  else if (titleLen < 20 || titleLen > 65) seo -= 8;
  const descLen = e.metaDescription?.length ?? 0;
  if (!descLen) seo -= 15;
  else if (descLen < 70 || descLen > 165) seo -= 6;
  // A partial SPA shell cannot prove that body-level elements are missing.
  // Score only metadata/header signals that were actually observable.
  if (!e.partial && e.h1Count === 0) seo -= 12;
  else if (!e.partial && e.h1Count > 1) seo -= 6;
  if (!e.canonical) seo -= 6;
  if (!e.hasViewport) seo -= 10;
  if (!e.partial && !e.hasRobots) seo -= 5;
  if (!e.partial && !e.hasSitemap) seo -= 5;
  if (Object.keys(e.openGraph).length === 0) seo -= 6;
  if (e.structuredData.length === 0) seo -= 6;
  if (!e.partial && e.wordCount < 200) seo -= 10;

  // Accessibility
  let accessibility = 100;
  if (!e.language) accessibility -= 12;
  if (!e.hasViewport) accessibility -= 8;
  if (e.images.total > 0) accessibility -= Math.min(35, (e.images.missingAlt / e.images.total) * 45);
  if (!e.partial && e.h1Count === 0) accessibility -= 10;
  if (!e.partial) {
    const emptyButtons = e.buttons.filter((b) => !b.trim()).length;
    if (emptyButtons) accessibility -= Math.min(10, emptyButtons * 2);
  }

  // Best practices
  let bestPractices = 100;
  if (!e.sslValid) bestPractices -= 35;
  const presentHeaders = Object.values(e.securityHeaders).filter(Boolean).length;
  bestPractices -= (6 - presentHeaders) * 7;
  if (e.statusCode >= 300) bestPractices -= 10;

  return {
    seo: clamp(seo),
    accessibility: clamp(accessibility),
    bestPractices: clamp(bestPractices),
  };
}

/* ------------------------------------------------------------------ */
/* Crawl                                                               */
/* ------------------------------------------------------------------ */

export async function crawlSite(rawUrl: string): Promise<Extracted> {
  const url = normalizeUrl(rawUrl);

  let { res, html } = await fetchWithBrowserHeaders(url);
  let renderMode: "static" | "rendered" = "static";
  let blockReason = detectChallenge(res.status, html);

  // Pass 2: retry as a well-known search crawler (many WAFs allow-list these).
  if (blockReason) {
    try {
      const crawler = await fetchWithHeaders(url, CRAWLER_HEADERS);
      if (!detectChallenge(crawler.res.status, crawler.html)) {
        res = crawler.res;
        html = crawler.html;
        blockReason = null;
      }
    } catch {
      /* keep the original block reason */
    }
  }

  // Pass 3: headless rendering (blocked pages).
  let renderFailed = false;
  if (blockReason) {
    const rendered = await fetchRendered(url);
    if (rendered) {
      const renderedBlock = detectChallenge(200, rendered);
      if (!renderedBlock) {
        html = rendered;
        renderMode = "rendered";
        blockReason = null;
      }
    } else {
      renderFailed = true;
    }
  }

  // Pass 4: the origin responded fine but served a JavaScript app shell.
  // Always render such pages so UX / CTA / conversion analysis sees the real DOM.
  if (!blockReason && bodyTextLength(html) < 600) {
    const rendered = await fetchRendered(url);
    if (rendered && bodyTextLength(rendered) > bodyTextLength(html)) {
      html = rendered;
      renderMode = "rendered";
      renderFailed = false;
    } else {
      renderFailed = true;
    }
  }




  const blocked = blockReason !== null;
  const finalUrl = res.url || url;
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
  const ctaWords =
    /\b(sign up|get started|start|try|buy|book|download|subscribe|contact|demo|free trial|learn more|join)\b/i;
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
  findElements(html, "script")
    .filter((el) => attrEquals(el.attrs, "type", "application/ld+json"))
    .forEach((el) => {
      try {
        structuredData.push(JSON.parse(el.inner.trim()));
      } catch {
        /* noop */
      }
    });

  const securityHeaders: Record<string, string | null> = {};
  for (const h of SECURITY_HEADERS) securityHeaders[h] = res.headers.get(h);

  const [robotsRes, sitemapRes] = await Promise.allSettled([
    fetch(new URL("/robots.txt", origin).toString(), { headers: BROWSER_HEADERS }),
    fetch(new URL("/sitemap.xml", origin).toString(), { headers: BROWSER_HEADERS }),
  ]);
  const hasRobots = robotsRes.status === "fulfilled" && robotsRes.value.ok;
  const hasSitemap = sitemapRes.status === "fulfilled" && sitemapRes.value.ok;

  const body = findElements(html, "body")[0]?.inner ?? html;
  const textSample = compactText(body).slice(0, 5000);
  const wordCount = textSample.split(/\s+/).filter(Boolean).length;
  const title = compactText(findElements(html, "title")[0]?.inner ?? "") || null;
  const canonicalHref = firstLinkHref(html, "canonical");
  const iconHref = firstLinkHref(html, "icon") || firstLinkHref(html, "shortcut icon");
  const metadataSignals = [
    title,
    firstMetaContent(html, "name", "description"),
    firstMetaContent(html, "property", "og:title"),
    firstMetaContent(html, "property", "og:description"),
  ].filter(Boolean).length;
  const partial = !blocked && textSample.length < 200 && metadataSignals >= 2;
  const captureWarning = partial
    ? "The page is a JavaScript application. Metadata was analysed, but page-body, CTA and UX results may be incomplete."
    : null;

  const base: Omit<Extracted, "htmlEstimate"> = {
    finalUrl,
    statusCode: res.status,
    blocked,
    blockReason,
    partial,
    captureWarning,
    renderMode,
    title,
    metaDescription:
      firstMetaContent(html, "name", "description") ?? firstMetaContent(html, "property", "og:description"),
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
    openGraph: collectPrefixedMeta(html, "og:"),
    twitter: collectPrefixedMeta(html, "twitter:"),
    hasViewport: findTags(html, "meta").some((tag) => attrEquals(tag.attrs, "name", "viewport")),
    hasRobots,
    hasSitemap,
    securityHeaders,
    sslValid: finalUrl.startsWith("https://"),
    textSample,
    wordCount,
  };

  return { ...base, htmlEstimate: estimateFromHtml(base) };
}

/* ------------------------------------------------------------------ */
/* PageSpeed Insights with key support, backoff + cache                */
/* ------------------------------------------------------------------ */

const PSI_CACHE_TTL_MS = 10 * 60 * 1000;
const psiCache = new Map<string, { at: number; value: LighthouseSummary }>();
const RETRY_DELAYS_MS = [2000, 5000, 10000];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runLighthouse(url: string): Promise<LighthouseSummary> {
  const apiKey =
    process.env["PAGESPEED_API_KEY"] || process.env["GOOGLE_PAGESPEED_API_KEY"] || "";
  const cacheKey = `mobile:${url}`;
  const hit = psiCache.get(cacheKey);
  if (hit && Date.now() - hit.at < PSI_CACHE_TTL_MS) {
    return { ...hit.value, cached: true };
  }

  const endpoint = new URL("https://www.googleapis.com/pagespeedonline/v5/runPagespeed");
  endpoint.searchParams.set("url", url);
  endpoint.searchParams.set("strategy", "mobile");
  for (const c of ["performance", "accessibility", "best-practices", "seo"]) {
    endpoint.searchParams.append("category", c);
  }
  if (apiKey) endpoint.searchParams.set("key", apiKey);

  let lastError = "PageSpeed request failed";

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) await sleep(RETRY_DELAYS_MS[attempt - 1]);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 55000);
    try {
      const res = await fetch(endpoint, { signal: controller.signal });
      if (res.status === 429 || res.status >= 500) {
        lastError =
          res.status === 429
            ? apiKey
              ? "Google PageSpeed rate limit exceeded."
              : "Google PageSpeed rate limit exceeded (keyless mode). Add PAGESPEED_API_KEY for a higher quota."
            : `PageSpeed API returned ${res.status}`;
        continue;
      }
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        return empty(`PageSpeed API returned ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`, attempt, Boolean(apiKey));
      }

      const data: any = await res.json();
      const cats = data.lighthouseResult?.categories ?? {};
      const audits = data.lighthouseResult?.audits ?? {};
      const score = (k: string) =>
        typeof cats[k]?.score === "number" ? Math.round(cats[k].score * 100) : null;
      const value: LighthouseSummary = {
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
        attempts: attempt + 1,
        apiKeyUsed: Boolean(apiKey),
      };
      psiCache.set(cacheKey, { at: Date.now(), value });
      return value;
    } catch (e) {
      lastError =
        e instanceof Error && e.name === "AbortError"
          ? "PageSpeed request timed out"
          : e instanceof Error
            ? e.message
            : String(e);
    } finally {
      clearTimeout(timeout);
    }
  }

  return empty(lastError, RETRY_DELAYS_MS.length + 1, Boolean(apiKey));
}

function empty(error: string, attempts: number, apiKeyUsed = false): LighthouseSummary {
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
    attempts,
    apiKeyUsed,
  };
}

/* ------------------------------------------------------------------ */
/* Deterministic overall score                                         */
/* ------------------------------------------------------------------ */

export function computeOverallScore(
  extracted: Extracted,
  lighthouse: LighthouseSummary,
): { score: number | null; basis: string } {
  if (extracted.blocked) {
    return {
      score: null,
      basis:
        "No score assigned: the site blocked automated access, so no reliable page data could be collected.",
    };
  }

  const parts: { value: number; weight: number; label: string }[] = [];
  const push = (value: number | null | undefined, weight: number, label: string) => {
    if (typeof value === "number") parts.push({ value, weight, label });
  };

  push(lighthouse.performance, 0.3, "Lighthouse performance");
  const estimatePrefix = extracted.partial ? "captured metadata" : "HTML";
  push(lighthouse.accessibility ?? extracted.htmlEstimate.accessibility, 0.25, lighthouse.accessibility != null ? "Lighthouse accessibility" : `${estimatePrefix} accessibility estimate`);
  push(lighthouse.seo ?? extracted.htmlEstimate.seo, 0.25, lighthouse.seo != null ? "Lighthouse SEO" : `${estimatePrefix} SEO estimate`);
  push(lighthouse.bestPractices ?? extracted.htmlEstimate.bestPractices, 0.2, lighthouse.bestPractices != null ? "Lighthouse best practices" : `${estimatePrefix} best-practices estimate`);

  if (parts.length === 0) {
    return { score: null, basis: "No score assigned: no measurable signals were collected." };
  }

  const totalWeight = parts.reduce((s, p) => s + p.weight, 0);
  const score = clamp(parts.reduce((s, p) => s + p.value * p.weight, 0) / totalWeight);
  return { score, basis: `Score computed from: ${parts.map((p) => `${p.label} (${p.value})`).join(", ")}.` };
}
