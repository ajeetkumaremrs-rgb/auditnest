import { generateText } from "ai";
import { z } from "zod";

import type { AuditReport, Extracted, LighthouseSummary } from "./audit-shared";
import { createLovableAiGatewayProvider } from "./ai-gateway.server";
import { computeOverallScore } from "./audit-engine.server";

const aiSchema = z.object({
  summary: z.string(),
  homepageClarity: z.string(),
  ctaAnalysis: z.object({
    findings: z.array(z.string()),
    suggestedCta: z.string(),
  }),
  trust: z.object({
    detected: z.array(z.string()),
    missing: z.array(z.string()),
    notes: z.string(),
  }),
  ux: z.array(z.string()),
  mobile: z.array(z.string()),
  seo: z.object({
    metaTitle: z.string(),
    metaDescription: z.string(),
    headings: z.string(),
    imageAlt: z.string(),
    other: z.array(z.string()),
  }),
  accessibility: z.array(z.string()),
  performanceNotes: z.string(),
  conversion: z.array(z.string()),
  recommendations: z.array(
    z.object({
      problem: z.string(),
      why: z.string(),
      fix: z.string(),
      impact: z.string(),
      priority: z.enum(["high", "medium", "low"]),
    }),
  ),
  suggestions: z.object({
    headline: z.string().nullable(),
    cta: z.string().nullable(),
    hero: z.string().nullable(),
    pricing: z.string().nullable(),
    features: z.string().nullable(),
    testimonials: z.string().nullable(),
  }),
});

function buildWarnings(extracted: Extracted, lighthouse: LighthouseSummary): string[] {
  const warnings: string[] = [];
  if (extracted.blocked) {
    warnings.push("This website blocks automated crawlers. Results may be incomplete.");
    if (extracted.blockReason) warnings.push(extracted.blockReason);
  }
  if (extracted.renderMode === "rendered") {
    warnings.push("The page required JavaScript rendering; content was captured via a headless renderer.");
  }
  if (lighthouse.error) {
    warnings.push(
      lighthouse.error.toLowerCase().includes("rate limit")
        ? "Google PageSpeed rate limit exceeded. HTML analysis is still available."
        : `Lighthouse unavailable: ${lighthouse.error}`,
    );
  }
  return warnings;
}

/** Report used when the site blocked us — no fabricated SEO/UX/CTA analysis. */
function blockedReport(extracted: Extracted, lighthouse: LighthouseSummary): AuditReport {
  const { score, basis } = computeOverallScore(extracted, lighthouse);
  const na = "Not analysed — the site blocked automated access.";
  return {
    overallScore: score,
    scoreBasis: basis,
    warnings: buildWarnings(extracted, lighthouse),
    summary:
      `We could not read the real content of ${extracted.finalUrl}. ${extracted.blockReason ?? "The origin served an anti-bot page."} ` +
      "No SEO, UX or conversion scores were generated, because any result would be misleading.",
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
      notes: lighthouse.error ?? "Lighthouse data unavailable for a blocked page.",
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

export async function generateReport(
  extracted: Extracted,
  lighthouse: LighthouseSummary,
): Promise<AuditReport> {
  if (extracted.blocked) return blockedReport(extracted, lighthouse);

  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("Missing LOVABLE_API_KEY");
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

  let ai: z.infer<typeof aiSchema>;
  try {
    ai = aiSchema.parse(JSON.parse(normalized));
  } catch (error) {
    console.error("[audit] invalid AI report", { error, preview: normalized.slice(0, 500) });
    throw new Error("AI returned an invalid report");
  }

  const { score, basis } = computeOverallScore(extracted, lighthouse);

  return {
    overallScore: score,
    scoreBasis: basis,
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
