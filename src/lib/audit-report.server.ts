import { generateText, NoObjectGeneratedError, Output } from "ai";
import { z } from "zod";

import type { AuditReport, Extracted, LighthouseSummary } from "./audit-shared";
import { createLovableAiGatewayProvider } from "./ai-gateway.server";

const reportSchema = z.object({
  overallScore: z.number(),
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
  performance: z.object({
    performanceScore: z.number().nullable(),
    accessibilityScore: z.number().nullable(),
    seoScore: z.number().nullable(),
    bestPracticesScore: z.number().nullable(),
    notes: z.string(),
  }),
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

export async function generateReport(
  extracted: Extracted,
  lighthouse: LighthouseSummary,
): Promise<AuditReport> {
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

  const prompt = `You are a senior conversion + SEO strategist auditing a real website. Use ONLY the extracted data below — do not invent facts. Be specific, quote elements you saw (headings, CTA text) where relevant. Keep each list under 8 items. Priorities must reflect real business impact.

URL: ${extracted.finalUrl}

EXTRACTED PAGE DATA (JSON):
${JSON.stringify(compactExtracted, null, 2)}

LIGHTHOUSE (PageSpeed Insights, mobile):
${JSON.stringify(compactLighthouse, null, 2)}

Produce a JSON audit that matches the requested schema. overallScore is a weighted score 0-100 combining clarity, CTA, trust, UX, mobile, SEO, accessibility, performance, and conversion. If a Lighthouse score is unavailable use null. For suggestions provide concrete rewrites (an actual headline, an actual CTA button label, etc.) or null when not applicable.`;

  try {
    const { output } = await generateText({
      model,
      output: Output.object({ schema: reportSchema }),
      prompt,
    });
    return output as AuditReport;
  } catch (err) {
    if (NoObjectGeneratedError.isInstance(err)) {
      try {
        const parsed = JSON.parse(err.text ?? "{}");
        return reportSchema.parse(parsed) as AuditReport;
      } catch {
        throw new Error("AI returned an unparseable report");
      }
    }
    throw err;
  }
}