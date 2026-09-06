import type { Extracted, HtmlEstimate, LighthouseSummary, ScoreComponent } from "./audit-shared";

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

const FETCH_TIMEOUT_MS = 12000;

/* ------------------------------------------------------------------ */
/* Budget + structured stage logging                                   */
/* ------------------------------------------------------------------ */

/** Hard ceiling for the whole audit; individual stages get sub-budgets. */
export const AUDIT_BUDGET_MS = 70000;

export interface Budget {
  url: string;
  deadline: number;
}

export function createBudget(url: string, ms = AUDIT_BUDGET_MS): Budget {
  return { url, deadline: Date.now() + ms };
}

export function remaining(b: Budget): number {
  return Math.max(0, b.deadline - Date.now());
}

/** Structured server log for every external request / audit step. */
export function logStep(
  budget: Budget,
  step: string,
  request: string,
  startedAt: number,
  extra: Record<string, unknown> = {},
): void {
  console.info("[audit:step]", {
    url: budget.url,
    step,
    request,
    elapsedMs: Date.now() - startedAt,
    remainingMs: remaining(budget),
    ...extra,
  });
}

export class InvalidUrlError extends Error {}

export function normalizeUrl(input: string): string {
  const raw = input.trim();
  if (!raw) throw new InvalidUrlError("Please enter a website URL.");
  if (/^(?!https?:)[a-z][a-z\d+.-]*:/i.test(raw)) {
    throw new InvalidUrlError("Only http:// and https:// URLs can be audited.");
  }
  let u = raw;
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  let parsed: URL;
  try {
    parsed = new URL(u);
  } catch {
    throw new InvalidUrlError(`"${raw}" is not a valid website URL.`);
  }
  const host = parsed.hostname.toLowerCase();
  const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
  if (!isIp && (!host.includes(".") || host.startsWith(".") || host.endsWith("."))) {
    throw new InvalidUrlError(`"${raw}" is not a valid website URL — a domain like example.com is required.`);
  }
  if (
    host === "localhost" ||
    host.endsWith(".local") ||
    /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  ) {
    throw new InvalidUrlError("Private and local addresses cannot be audited — use a public website URL.");
  }
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
const RENDER_TIMEOUT_MS = 18000;

function escapeHtml(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Converts the renderer's markdown output of the rendered DOM into parseable HTML. */
function markdownToHtml(md: string): string {
  const body = md
    .replace(/^Title:.*$/im, "")
    .replace(/^URL Source:.*$/im, "")
    .replace(/^Warning:.*$/im, "")
    .replace(/^Markdown Content:\s*/im, "");

  const lines = body.split(/\r?\n/);
  const out: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    const heading = /^(#{1,6})\s+(.*)$/.exec(t);
    if (heading) {
      const level = heading[1].length;
      out.push(`<h${level}>${escapeHtml(heading[2].replace(/[*_`]/g, ""))}</h${level}>`);
      continue;
    }
    const withLinks = escapeHtml(t).replace(
      /\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g,
      (_m, label: string, href: string) => `<a href="${href}">${label || href}</a>`,
    );
    out.push(`<p>${withLinks.replace(/[*_`]/g, "")}</p>`);
  }
  return `<html><body>${out.join("\n")}</body></html>`;
}

async function renderOnce(
  url: string,
  waitMs: number,
  mode: "html" | "markdown",
  budgetMs: number,
): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(3000, budgetMs));
  try {
    const token = process.env["JINA_API_KEY"];
    const res = await fetch(`https://r.jina.ai/${url}`, {
      headers: {
        ...(mode === "html" ? { "x-return-format": "html", "x-engine": "browser" } : {}),
        "x-timeout": "12",
        "x-cache-tolerance": "0",
        ...(waitMs ? { "x-wait-for-timeout": String(waitMs) } : {}),
        Accept: "text/html,*/*;q=0.8",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const text = await res.text();
    if (!text) return null;
    const html = mode === "html" ? text : markdownToHtml(text);
    if (compactText(html).length < 200) return null;
    return html;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Renders through a remote headless-Chromium service. Both capture modes run
 * concurrently (instead of sequential retries) and the run is capped by the
 * remaining audit budget, so rendering can never stall the whole audit.
 */
async function fetchRendered(budget: Budget, url: string): Promise<string | null> {
  const startedAt = Date.now();
  const budgetMs = Math.min(RENDER_TIMEOUT_MS, remaining(budget) - 12000);
  if (budgetMs < 4000) {
    logStep(budget, "render", "r.jina.ai", startedAt, { skipped: "insufficient time budget" });
    return null;
  }
  const results = await Promise.allSettled([
    renderOnce(url, 0, "html", budgetMs),
    renderOnce(url, 1500, "markdown", budgetMs),
  ]);
  const candidates = results
    .map((r) => (r.status === "fulfilled" ? r.value : null))
    .filter((v): v is string => Boolean(v))
    .sort((a, b) => bodyTextLength(b) - bodyTextLength(a));
  logStep(budget, "render", "r.jina.ai", startedAt, { ok: candidates.length > 0 });
  return candidates[0] ?? null;
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

export async function crawlSite(rawUrl: string, budget?: Budget): Promise<Extracted> {
  const url = normalizeUrl(rawUrl);
  const b = budget ?? createBudget(url);

  const t0 = Date.now();
  let { res, html } = await fetchWithBrowserHeaders(url);
  logStep(b, "fetch-website", "origin GET (browser headers)", t0, {
    status: res.status,
    bytes: html.length,
  });
  let renderMode: "static" | "rendered" = "static";
  let blockReason = detectChallenge(res.status, html);

  // Pass 2: retry as a well-known search crawler (many WAFs allow-list these).
  if (blockReason && remaining(b) > 20000) {
    const t1 = Date.now();
    try {
      const crawler = await fetchWithHeaders(url, CRAWLER_HEADERS);
      logStep(b, "fetch-website", "origin GET (crawler UA)", t1, { status: crawler.res.status });
      if (!detectChallenge(crawler.res.status, crawler.html)) {
        res = crawler.res;
        html = crawler.html;
        blockReason = null;
      }
    } catch (e) {
      logStep(b, "fetch-website", "origin GET (crawler UA)", t1, {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // Rendering is attempted at most once per audit.
  let renderedOnce: string | null | undefined;
  const renderCached = async () => {
    if (renderedOnce === undefined) renderedOnce = await fetchRendered(b, url);
    return renderedOnce;
  };

  // Pass 3: headless rendering (blocked pages).
  let renderFailed = false;
  if (blockReason) {
    const rendered = await renderCached();
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

  // Metadata (title/meta/canonical/JSON-LD) always comes from the origin's own
  // document; rendered output is used for the visible body content.
  const metaHtml = html;

  // Pass 4: the origin responded fine but served a JavaScript app shell.
  // Always render such pages so UX / CTA / conversion analysis sees the real DOM.
  if (!blockReason && bodyTextLength(html) < 600) {
    const rendered = await renderCached();
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
  findElements(metaHtml, "script")
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

  const tProbe = Date.now();
  const probe = async (path: string) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    try {
      const r = await fetch(new URL(path, origin).toString(), {
        headers: BROWSER_HEADERS,
        signal: controller.signal,
      });
      return r.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  };
  const [robotsRes, sitemapRes] = await Promise.allSettled([
    probe("/robots.txt"),
    probe("/sitemap.xml"),
  ]);
  const hasRobots = robotsRes.status === "fulfilled" && robotsRes.value;
  const hasSitemap = sitemapRes.status === "fulfilled" && sitemapRes.value;
  logStep(b, "checking-seo", "robots.txt + sitemap.xml", tProbe, { hasRobots, hasSitemap });


  const body = findElements(html, "body")[0]?.inner ?? html;
  const textSample = compactText(body).slice(0, 5000);
  const wordCount = textSample.split(/\s+/).filter(Boolean).length;
  const title = compactText(findElements(metaHtml, "title")[0]?.inner ?? "") || null;
  const canonicalHref = firstLinkHref(metaHtml, "canonical");
  const iconHref = firstLinkHref(metaHtml, "icon") || firstLinkHref(metaHtml, "shortcut icon");
  const metadataSignals = [
    title,
    firstMetaContent(metaHtml, "name", "description"),
    firstMetaContent(metaHtml, "property", "og:title"),
    firstMetaContent(metaHtml, "property", "og:description"),
  ].filter(Boolean).length;
  const partial = !blocked && (textSample.length < 400 || wordCount < 120) && metadataSignals >= 1;
  const captureWarning = blocked
    ? null
    : partial && renderFailed
      ? "JavaScript rendering failed: the headless renderer could not load this page, so only metadata from the initial HTML response was analysed. UX, CTA, homepage-clarity and conversion findings are unavailable rather than estimated."
      : partial
        ? "The page is a JavaScript application and rendering returned little visible content. Metadata was analysed; page-body, CTA and UX results are partial."
        : null;
  const dataCoverage: Extracted["dataCoverage"] = {
    metadata: blocked ? "unavailable" : "complete",
    lighthouse: "complete", // resolved against the Lighthouse result in the report layer
    pageBody: blocked ? "unavailable" : partial ? (renderFailed ? "unavailable" : "partial") : "complete",
  };

  const base: Omit<Extracted, "htmlEstimate"> = {
    finalUrl,
    statusCode: res.status,
    blocked,
    blockReason,
    partial,
    renderFailed,
    dataCoverage,
    captureWarning,
    renderMode,

    title,
    metaDescription:
      firstMetaContent(metaHtml, "name", "description") ?? firstMetaContent(metaHtml, "property", "og:description"),
    canonical: canonicalHref ? abs(canonicalHref) : null,
    favicon: abs(iconHref || "/favicon.ico"),
    language: findTags(metaHtml, "html")[0]?.attrs.lang || null,
    headings: headings.slice(0, 40),
    h1Count: headings.filter((h) => h.tag === "h1").length,
    buttons: buttons.slice(0, 20),
    ctas: ctas.slice(0, 20),
    forms,
    navLinks: navLinks.slice(0, 20),
    images: { total: imgs.length, missingAlt, samples: imageSamples },
    links: { internal, external, samples: linkSamples },
    structuredData: structuredData.slice(0, 5),
    openGraph: collectPrefixedMeta(metaHtml, "og:"),
    twitter: collectPrefixedMeta(metaHtml, "twitter:"),
    hasViewport: findTags(metaHtml, "meta").some((tag) => attrEquals(tag.attrs, "name", "viewport")),
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
/** Only temporary failures are retried (429 / 5xx / network); never permanent 4xx. */
const RETRY_DELAYS_MS = [1500, 4000];
const PSI_REQUEST_TIMEOUT_MS = 30000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runLighthouse(url: string, budget?: Budget): Promise<LighthouseSummary> {
  const b = budget ?? createBudget(url);
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
    if (attempt > 0) {
      if (remaining(b) < 20000) {
        return empty(`${lastError} (audit time budget reached)`, attempt, Boolean(apiKey));
      }
      await sleep(RETRY_DELAYS_MS[attempt - 1]);
    }

    const started = Date.now();
    const controller = new AbortController();
    const perAttempt = Math.min(PSI_REQUEST_TIMEOUT_MS, Math.max(5000, remaining(b) - 15000));
    const timeout = setTimeout(() => controller.abort(), perAttempt);
    try {
      const res = await fetch(endpoint, { signal: controller.signal });
      logStep(b, "checking-performance", "PageSpeed Insights", started, {
        status: res.status,
        attempt: attempt + 1,
      });
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

/** Deterministic UX score from crawled page-body signals. Null when body unavailable. */
function uxScore(e: Extracted): { value: number | null; inputs: string[] } {
  if (e.blocked || e.partial) return { value: null, inputs: [] };
  let v = 100;
  const inputs: string[] = [];
  const hit = (cond: boolean, pts: number, why: string) => {
    inputs.push(`${why}: ${cond ? `-${pts}` : "0"}`);
    if (cond) v -= pts;
  };
  hit(e.h1Count === 0, 12, `H1 headings (${e.h1Count})`);
  hit(e.headings.length < 3, 8, `total headings (${e.headings.length})`);
  hit(e.wordCount < 300, 10, `word count (${e.wordCount})`);
  hit(e.navLinks.length < 3, 10, `nav links (${e.navLinks.length})`);
  hit(!e.hasViewport, 12, `responsive viewport (${e.hasViewport ? "present" : "missing"})`);
  hit(e.buttons.length + e.ctas.length === 0, 10, `interactive elements (${e.buttons.length + e.ctas.length})`);
  return { value: clamp(v), inputs };
}

const GENERIC_CTA = /^(click here|submit|learn more|read more|more|go|here)$/i;

/** Deterministic CTA score from crawled CTA/button/form signals. */
function ctaScore(e: Extracted): { value: number | null; inputs: string[] } {
  if (e.blocked || e.partial) return { value: null, inputs: [] };
  let v = 100;
  const inputs: string[] = [];
  const hit = (cond: boolean, pts: number, why: string) => {
    inputs.push(`${why}: ${cond ? `-${pts}` : "0"}`);
    if (cond) v -= pts;
  };
  const generic = e.ctas.filter((c) => GENERIC_CTA.test(c.trim())).length;
  hit(e.ctas.length === 0, 45, `detected CTAs (${e.ctas.length})`);
  hit(e.ctas.length === 1, 12, `CTA repetition (${e.ctas.length})`);
  hit(e.forms.length === 0, 15, `forms on page (${e.forms.length})`);
  hit(generic > 0, 10, `generic CTA wording (${generic})`);
  return { value: clamp(v), inputs };
}

/** Deterministic conversion score from crawled conversion-path signals. */
function conversionScore(e: Extracted): { value: number | null; inputs: string[] } {
  if (e.blocked || e.partial) return { value: null, inputs: [] };
  let v = 100;
  const inputs: string[] = [];
  const hit = (cond: boolean, pts: number, why: string) => {
    inputs.push(`${why}: ${cond ? `-${pts}` : "0"}`);
    if (cond) v -= pts;
  };
  hit(e.ctas.length === 0, 25, `CTAs (${e.ctas.length})`);
  hit(e.forms.length === 0, 20, `lead capture forms (${e.forms.length})`);
  hit(e.structuredData.length === 0, 10, `structured data blocks (${e.structuredData.length})`);
  hit(!e.metaDescription, 5, `meta description (${e.metaDescription ? "present" : "missing"})`);
  hit(e.links.internal < 5, 10, `internal links (${e.links.internal})`);
  hit(e.wordCount < 300, 10, `page copy length (${e.wordCount} words)`);
  return { value: clamp(v), inputs };
}

export function computeOverallScore(
  extracted: Extracted,
  lighthouse: LighthouseSummary,
): { score: number | null; basis: string; breakdown: ScoreComponent[] } {
  const estimatePrefix = extracted.partial ? "captured metadata" : "crawled HTML";
  const ux = uxScore(extracted);
  const cta = ctaScore(extracted);
  const conv = conversionScore(extracted);

  const unavailable = (reason: string) => `Unavailable — ${reason}`;
  const bodyReason = extracted.blocked
    ? "the site blocked automated access"
    : "the page body required JavaScript and could not be captured";

  const make = (
    key: string,
    label: string,
    value: number | null,
    weight: number,
    source: string,
    inputs: string[],
    status: ScoreComponent["status"],
  ): ScoreComponent => ({ key, label, value, weight, source, inputs, status });

  const lhSource = (metric: string) =>
    `Google PageSpeed Insights (Lighthouse, ${lighthouse.strategy}) — ${metric} category score`;

  const breakdown: ScoreComponent[] = [
    make(
      "performance",
      "Performance",
      lighthouse.performance,
      0.22,
      lighthouse.performance != null
        ? lhSource("performance")
        : unavailable(lighthouse.error ?? "Lighthouse returned no performance score"),
      lighthouse.performance != null
        ? Object.entries(lighthouse.metrics).map(([k, val]) => `${k.toUpperCase()}: ${val ?? "n/a"}`)
        : [],
      lighthouse.performance != null ? "measured" : "unavailable",
    ),
  ];

  const lhOrHtml = (
    key: string,
    label: string,
    lh: number | null,
    est: number | null,
    weight: number,
  ) => {
    if (extracted.blocked) {
      breakdown.push(
        make(key, label, lh, weight, lh != null ? lhSource(label.toLowerCase()) : unavailable(bodyReason), [], lh != null ? "measured" : "unavailable"),
      );
      return;
    }
    if (lh != null) {
      breakdown.push(make(key, label, lh, weight, lhSource(label.toLowerCase()), [], "measured"));
    } else if (est != null) {
      breakdown.push(
        make(key, label, est, weight, `Deterministic rules over ${estimatePrefix} (Lighthouse category unavailable)`, [], "derived"),
      );
    } else {
      breakdown.push(make(key, label, null, weight, unavailable("no signal collected"), [], "unavailable"));
    }
  };

  lhOrHtml("accessibility", "Accessibility", lighthouse.accessibility, extracted.htmlEstimate.accessibility, 0.18);
  lhOrHtml("seo", "SEO", lighthouse.seo, extracted.htmlEstimate.seo, 0.18);
  lhOrHtml("bestPractices", "Best Practices", lighthouse.bestPractices, extracted.htmlEstimate.bestPractices, 0.12);

  breakdown.push(
    make("ux", "UX", ux.value, 0.1, ux.value != null ? "Deterministic rules over crawled DOM structure" : unavailable(bodyReason), ux.inputs, ux.value != null ? "derived" : "unavailable"),
    make("cta", "CTA", cta.value, 0.1, cta.value != null ? "Deterministic rules over crawled CTAs, buttons and forms" : unavailable(bodyReason), cta.inputs, cta.value != null ? "derived" : "unavailable"),
    make("conversion", "Conversion", conv.value, 0.1, conv.value != null ? "Deterministic rules over crawled conversion-path signals" : unavailable(bodyReason), conv.inputs, conv.value != null ? "derived" : "unavailable"),
  );

  if (extracted.blocked) {
    return {
      score: null,
      basis:
        "No overall score assigned: the site blocked automated access, so no reliable page data could be collected.",
      breakdown,
    };
  }

  const scored = breakdown.filter((b) => typeof b.value === "number");
  if (scored.length === 0) {
    return { score: null, basis: "No overall score assigned: no measurable signals were collected.", breakdown };
  }

  const totalWeight = scored.reduce((s, p) => s + p.weight, 0);
  const score = clamp(scored.reduce((s, p) => s + (p.value as number) * p.weight, 0) / totalWeight);
  const formula = scored
    .map((p) => `${p.label} ${p.value} × ${(p.weight / totalWeight).toFixed(2)}`)
    .join(" + ");
  return {
    score,
    basis: `Weighted average of ${scored.length} verified component score${scored.length === 1 ? "" : "s"} (weights renormalised over available data): ${formula} = ${score}.`,
    breakdown,
  };
}

