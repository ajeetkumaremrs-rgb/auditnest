import { generateText } from "ai";

import type { AuditReport, Extracted, LighthouseSummary, Priority } from "./audit-shared";
import { createLovableAiGatewayProvider } from "./ai-gateway.server";
import { computeOverallScore } from "./audit-engine.server";

/* Models occasionally omit fields, return null, or use the wrong type.
   Normalize defensively instead of rejecting the whole report. */
const txt = (v: unknown): string =>
  typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : "";

const list = (v: unknown): string[] => {
  if (Array.isArray(v)) {
    return v
      .map((x) => (typeof x === "string" ? x : x == null ? "" : JSON.stringify(x)))
      .filter((x) => x.trim().length > 0);
  }
  const s = txt(v).trim();
  return s ? [s] : [];
};

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

const nullableTxt = (v: unknown): string | null => txt(v).trim() || null;

interface AiReport {
  summary: string;
  homepageClarity: string;
  ctaAnalysis: { findings: string[]; suggestedCta: string };
  trust: { detected: string[]; missing: string[]; notes: string };
  ux: string[];
  mobile: string[];
  seo: {
    metaTitle: string;
    metaDescription: string;
    headings: string;
    imageAlt: string;
    other: string[];
  };
  accessibility: string[];
  performanceNotes: string;
  conversion: string[];
  recommendations: {
    problem: string;
    why: string;
    fix: string;
    impact: string;
    priority: Priority;
  }[];
  suggestions: {
    headline: string | null;
    cta: string | null;
    hero: string | null;
    pricing: string | null;
    features: string | null;
    testimonials: string | null;
  };
}

function normalizeAi(raw: unknown): AiReport {
  const r = obj(raw);
  const cta = obj(r["ctaAnalysis"]);
  const trust = obj(r["trust"]);
  const seo = obj(r["seo"]);
  const sug = obj(r["suggestions"]);
  const recs = Array.isArray(r["recommendations"]) ? (r["recommendations"] as unknown[]) : [];

  return {
    summary: txt(r["summary"]),
    homepageClarity: txt(r["homepageClarity"]),
    ctaAnalysis: { findings: list(cta["findings"]), suggestedCta: txt(cta["suggestedCta"]) },
    trust: {
      detected: list(trust["detected"]),
      missing: list(trust["missing"]),
      notes: txt(trust["notes"]),
    },
    ux: list(r["ux"]),
    mobile: list(r["mobile"]),
    seo: {
      metaTitle: txt(seo["metaTitle"]),
      metaDescription: txt(seo["metaDescription"]),
      headings: txt(seo["headings"]),
      imageAlt: txt(seo["imageAlt"]),
      other: list(seo["other"]),
    },
    accessibility: list(r["accessibility"]),
    performanceNotes: txt(r["performanceNotes"]),
    conversion: list(r["conversion"]),
    recommendations: recs.map((item) => {
      const rec = obj(item);
      const p = txt(rec["priority"]).toLowerCase();
      return {
        problem: txt(rec["problem"]),
        why: txt(rec["why"]),
        fix: txt(rec["fix"]),
        impact: txt(rec["impact"]),
        priority: (p === "high" || p === "low" ? p : "medium") as Priority,
      };
    }).filter((rec) => rec.problem || rec.fix),
    suggestions: {
      headline: nullableTxt(sug["headline"]),
      cta: nullableTxt(sug["cta"]),
      hero: nullableTxt(sug["hero"]),
      pricing: nullableTxt(sug["pricing"]),
      features: nullableTxt(sug["features"]),
      testimonials: nullableTxt(sug["testimonials"]),
    },
  };
}



function buildWarnings(extracted: Extracted, lighthouse: LighthouseSummary): string[] {
  const warnings: string[] = [];
  if (extracted.blocked) {
    warnings.push("This website blocks automated crawlers. Results may be incomplete.");
    if (extracted.blockReason) warnings.push(extracted.blockReason);
  }
  if (extracted.partial && extracted.captureWarning) {
    warnings.push(extracted.captureWarning);
  }
  if (extracted.renderMode === "rendered") {
    warnings.push("The page required JavaScript rendering; content was captured with a headless browser.");
  }
  if (lighthouse.error) {
    warnings.push(
      lighthouse.error.toLowerCase().includes("rate limit")
        ? "Google PageSpeed rate limit exceeded. HTML analysis is still available."
        : `Lighthouse unavailable: ${lighthouse.error}`,
    );
  }
  const cov = extracted.dataCoverage;
  if (cov) {
    const lh = lighthouse.error ? "unavailable" : "complete";
    warnings.push(
      `Data coverage — metadata: ${cov.metadata}; page body (UX/CTA/conversion): ${cov.pageBody}; Lighthouse metrics: ${lh}.`,
    );
  }
  return warnings;
}


/** Report used when the site blocked us — no fabricated SEO/UX/CTA analysis. */
function blockedReport(extracted: Extracted, lighthouse: LighthouseSummary): AuditReport {
  const { score, basis, breakdown } = computeOverallScore(extracted, lighthouse);
  const na = "Not analysed — the site blocked automated access.";
  const lighthouseOk =
    !lighthouse.error &&
    [lighthouse.performance, lighthouse.accessibility, lighthouse.seo, lighthouse.bestPractices].some(
      (v) => typeof v === "number",
    );
  return {
    overallScore: score,
    scoreBasis: basis,
    scoreBreakdown: breakdown,
    warnings: buildWarnings(extracted, lighthouse),
    summary:
      `We could not read the real content of ${extracted.finalUrl}. ${extracted.blockReason ?? "The origin served an anti-bot page."} ` +
      "No SEO, UX or conversion scores were generated, because any result would be misleading." +
      (lighthouseOk
        ? " Google PageSpeed / Lighthouse metrics were measured independently and are shown below — they remain valid."
        : ""),
    homepageClarity: na,
    ctaAnalysis: { findings: [], suggestedCta: na },
    trust: { detected: [], missing: [], notes: na },
    ux: [],
    mobile: [],
    seo: { metaTitle: na, metaDescription: na, headings: na, imageAlt: na, other: [] },
    accessibility: [],
    performance: {
      performanceScore: lighthouse.performance,
      accessibilityScore: lighthouse.accessibility,
      seoScore: lighthouse.seo,
      bestPracticesScore: lighthouse.bestPractices,
      notes: lighthouseOk
        ? "These scores come from Google PageSpeed Insights (Lighthouse), which loads the page in a real browser, so they are unaffected by the crawler being blocked."
        : lighthouse.error ?? "Lighthouse data unavailable for a blocked page.",
    },
    conversion: [],
    recommendations: [
      {
        problem: "The site blocks automated crawlers",
        why: "Bot protection prevents audit tools — and some search/AI crawlers — from reading the page.",
        fix: "Allow reputable crawlers in your WAF/bot-protection rules, or run the audit from an allow-listed IP.",
        impact: "Enables a complete, accurate audit and avoids blocking legitimate indexing bots.",
        priority: "high",
      },
    ],
    suggestions: {},
  };
}

/** Measured-data-only report, used when the AI narrative cannot be produced. */
export function dataOnlyReport(
  extracted: Extracted,
  lighthouse: LighthouseSummary,
  note: string,
): AuditReport {
  const { score, basis, breakdown } = computeOverallScore(extracted, lighthouse);
  const na = "Unavailable — the written analysis could not be generated for this audit.";
  return {
    overallScore: score,
    scoreBasis: basis,
    scoreBreakdown: breakdown,
    warnings: [...buildWarnings(extracted, lighthouse), note],
    summary: `${note} All measured scores, Lighthouse metrics and technical findings below come from the completed audit steps.`,
    homepageClarity: na,
    ctaAnalysis: { findings: [], suggestedCta: na },
    trust: { detected: [], missing: [], notes: na },
    ux: [],
    mobile: [],
    seo: { metaTitle: na, metaDescription: na, headings: na, imageAlt: na, other: [] },
    accessibility: [],
    performance: {
      performanceScore: lighthouse.performance,
      accessibilityScore: lighthouse.accessibility ?? extracted.htmlEstimate.accessibility,
      seoScore: lighthouse.seo ?? extracted.htmlEstimate.seo,
      bestPracticesScore: lighthouse.bestPractices ?? extracted.htmlEstimate.bestPractices,
      notes: lighthouse.error ?? "Measured by Google PageSpeed Insights (Lighthouse).",
    },
    conversion: [],
    recommendations: [],
    suggestions: {},
  };
}

const AI_TIMEOUT_MS = 40000;

export async function generateReport(
  extracted: Extracted,
  lighthouse: LighthouseSummary,
  timeoutMs = AI_TIMEOUT_MS,
): Promise<AuditReport> {
  if (extracted.blocked) return blockedReport(extracted, lighthouse);

  const key = process.env.LOVABLE_API_KEY;
  if (!key) {
    return dataOnlyReport(extracted, lighthouse, "Some audit data could not be collected: the AI analysis service is not configured.");
  }
  const gateway = createLovableAiGatewayProvider(key);
  const model = gateway("google/gemini-2.5-flash");


  const compactExtracted = {
    ...extracted,
    textSample: extracted.textSample.slice(0, 2500),
    images: { ...extracted.images, samples: extracted.images.samples.slice(0, 5) },
    structuredData: extracted.structuredData.slice(0, 2),
  };
  const compactLighthouse = { ...lighthouse, screenshot: null };

  const prompt = `You are a senior conversion + SEO strategist auditing a real website. Use ONLY the extracted data below — never invent facts, metrics or numbers. If a signal is missing from the data, say it was not measured instead of guessing. Be specific and quote elements you saw (headings, CTA text). Keep each list under 8 items.

URL: ${extracted.finalUrl}
Content capture mode: ${extracted.renderMode === "rendered" ? "JavaScript-rendered" : "static HTML"}
Partial JavaScript shell: ${extracted.partial ? "YES — analyse metadata only; do not infer page-body UX, CTA, trust, or conversion findings" : "no"}
Lighthouse available: ${lighthouse.error ? `NO — ${lighthouse.error}` : "yes"}

EXTRACTED PAGE DATA (JSON):
${JSON.stringify(compactExtracted, null, 2)}

LIGHTHOUSE (PageSpeed Insights, mobile):
${JSON.stringify(compactLighthouse, null, 2)}

Return ONLY valid JSON with this exact shape and no markdown fences:
{
  "summary": string,
  "homepageClarity": string,
  "ctaAnalysis": { "findings": string[], "suggestedCta": string },
  "trust": { "detected": string[], "missing": string[], "notes": string },
  "ux": string[],
  "mobile": string[],
  "seo": { "metaTitle": string, "metaDescription": string, "headings": string, "imageAlt": string, "other": string[] },
  "accessibility": string[],
  "performanceNotes": string,
  "conversion": string[],
  "recommendations": [{ "problem": string, "why": string, "fix": string, "impact": string, "priority": "high"|"medium"|"low" }],
  "suggestions": { "headline": string|null, "cta": string|null, "hero": string|null, "pricing": string|null, "features": string|null, "testimonials": string|null }
}
Do not output any numeric score — scores are computed separately from measured data. If Lighthouse is unavailable, performanceNotes must say so plainly rather than estimating speed.`;

  const { text } = await generateText({ model, prompt });
  const normalized = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");

  // Models occasionally wrap JSON in prose; take the outermost JSON object.
  const start = normalized.indexOf("{");
  const end = normalized.lastIndexOf("}");
  const jsonText = start >= 0 && end > start ? normalized.slice(start, end + 1) : normalized;

  let ai: AiReport;
  try {
    ai = normalizeAi(JSON.parse(jsonText));
  } catch (error) {
    console.error("[audit] invalid AI report", { error, preview: normalized.slice(0, 800) });
    // Never fail the whole audit on a malformed model response — the measured
    // crawl + Lighthouse data is still real and worth showing.
    ai = normalizeAi({
      summary: normalized.slice(0, 1200) || "The AI narrative could not be generated for this audit.",
      performanceNotes: lighthouse.error ?? "",
    });
  }
  if (!ai.summary) ai.summary = "The AI narrative was incomplete; measured data is shown below.";


  const { score, basis, breakdown } = computeOverallScore(extracted, lighthouse);

  return {
    overallScore: score,
    scoreBasis: basis,
    scoreBreakdown: breakdown,
    warnings: buildWarnings(extracted, lighthouse),
    summary: ai.summary,
    homepageClarity: ai.homepageClarity,
    ctaAnalysis: ai.ctaAnalysis,
    trust: ai.trust,
    ux: ai.ux,
    mobile: ai.mobile,
    seo: ai.seo,
    accessibility: ai.accessibility,
    performance: {
      // Never fabricated: measured Lighthouse first, deterministic HTML estimate as fallback.
      performanceScore: lighthouse.performance,
      accessibilityScore: lighthouse.accessibility ?? extracted.htmlEstimate.accessibility,
      seoScore: lighthouse.seo ?? extracted.htmlEstimate.seo,
      bestPracticesScore: lighthouse.bestPractices ?? extracted.htmlEstimate.bestPractices,
      notes: ai.performanceNotes,
    },
    conversion: ai.conversion,
    recommendations: ai.recommendations,
    suggestions: ai.suggestions,
  };
}
