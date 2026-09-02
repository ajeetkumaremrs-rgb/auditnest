import type { AuditReport, Extracted, LighthouseSummary, Recommendation, ScoreComponent } from "./audit-shared";

/* ------------------------------------------------------------------ *
 * Pure, data-driven derivations shared by the web preview and the PDF.
 * Nothing here invents data: every value comes from the stored audit.
 * ------------------------------------------------------------------ */

export type Band = "Excellent" | "Good" | "Needs Improvement" | "Poor";

export function band(score: number | null): Band | null {
  if (score === null || score === undefined) return null;
  if (score >= 90) return "Excellent";
  if (score >= 75) return "Good";
  if (score >= 50) return "Needs Improvement";
  return "Poor";
}

export function bandTone(score: number | null): "success" | "warning" | "destructive" | "muted" {
  if (score === null || score === undefined) return "muted";
  if (score >= 75) return "success";
  if (score >= 50) return "warning";
  return "destructive";
}

export const UNAVAILABLE_NOTE =
  "This metric could not be reliably collected during this audit.";

/** Components that actually have a measured/derived value. */
export function availableComponents(report: AuditReport): ScoreComponent[] {
  return (report.scoreBreakdown ?? []).filter((c) => c.value !== null);
}

export function unavailableComponents(report: AuditReport): ScoreComponent[] {
  return (report.scoreBreakdown ?? []).filter((c) => c.value === null);
}

/**
 * Executive summary built from the real strongest/weakest components and the
 * real issue counts. Falls back to the model summary only as supporting text.
 */
export function executiveSummary(report: AuditReport): string[] {
  const lines: string[] = [];
  const comps = availableComponents(report).slice().sort((a, b) => (b.value! - a.value!));
  const overall = report.overallScore;

  if (overall !== null) {
    lines.push(
      `This website scores ${overall}/100 overall (${band(overall)}). The score is calculated only from the ${comps.length} audit component${comps.length === 1 ? "" : "s"} that returned verified data.`,
    );
  } else {
    lines.push(
      "An overall score could not be calculated because not enough verified audit data was collected for this website.",
    );
  }

  const strong = comps.slice(0, 2).filter((c) => c.value! >= 75);
  const weak = comps.slice(-2).reverse().filter((c) => c.value! < 75);
  if (strong.length) {
    lines.push(
      `Strongest area${strong.length > 1 ? "s" : ""}: ${strong.map((c) => `${c.label} (${c.value})`).join(", ")}.`,
    );
  }
  if (weak.length) {
    lines.push(
      `Weakest area${weak.length > 1 ? "s" : ""}: ${weak.map((c) => `${c.label} (${c.value})`).join(", ")}.`,
    );
  }

  const counts = severityCounts(report);
  if (counts.high || counts.medium || counts.low) {
    const parts: string[] = [];
    if (counts.high) parts.push(`${counts.high} high-priority`);
    if (counts.medium) parts.push(`${counts.medium} medium-priority`);
    if (counts.low) parts.push(`${counts.low} low-priority`);
    lines.push(`We detected ${parts.join(", ")} issue${counts.high + counts.medium + counts.low === 1 ? "" : "s"}. The Priority Action Plan lists what to fix first.`);
  } else {
    lines.push("No prioritised issues were recorded for this audit.");
  }

  if (report.summary) lines.push(report.summary);
  return lines;
}

export function severityCounts(report: AuditReport) {
  const recs = report.recommendations ?? [];
  return {
    high: recs.filter((r) => r.priority === "high").length,
    medium: recs.filter((r) => r.priority === "medium").length,
    low: recs.filter((r) => r.priority === "low").length,
  };
}

const ORDER = { high: 0, medium: 1, low: 2 } as const;

export function sortedIssues(report: AuditReport): Recommendation[] {
  return (report.recommendations ?? [])
    .slice()
    .sort((a, b) => (ORDER[a.priority] ?? 3) - (ORDER[b.priority] ?? 3));
}

export function priorityActionPlan(report: AuditReport): Recommendation[] {
  return sortedIssues(report).slice(0, 5);
}

export interface MetricRow {
  label: string;
  value: string | null;
  reason?: string;
}

export function lighthouseMetricRows(lh: LighthouseSummary | null): MetricRow[] {
  const reason = lh?.error || UNAVAILABLE_NOTE;
  const defs: { key: keyof LighthouseSummary["metrics"]; label: string }[] = [
    { key: "fcp", label: "First Contentful Paint" },
    { key: "lcp", label: "Largest Contentful Paint" },
    { key: "cls", label: "Cumulative Layout Shift" },
    { key: "tbt", label: "Total Blocking Time" },
    { key: "tti", label: "Time to Interactive" },
    { key: "si", label: "Speed Index" },
  ];
  return defs.map(({ key, label }) => ({
    label,
    value: lh?.metrics?.[key] ?? null,
    reason,
  }));
}

export function technicalRows(ex: Extracted | null): MetricRow[] {
  if (!ex) return [];
  return [
    { label: "HTTP status", value: String(ex.statusCode) },
    { label: "Final URL", value: ex.finalUrl },
    { label: "HTTPS", value: ex.sslValid ? "Yes" : "No" },
    { label: "Viewport meta tag", value: ex.hasViewport ? "Found" : "Missing" },
    { label: "robots.txt", value: ex.hasRobots ? "Found" : "Missing" },
    { label: "sitemap.xml", value: ex.hasSitemap ? "Found" : "Missing" },
    { label: "Canonical URL", value: ex.canonical ?? null },
    { label: "Page title", value: ex.title ?? null },
    { label: "Word count", value: String(ex.wordCount) },
    { label: "H1 count", value: String(ex.h1Count) },
    { label: "Images detected", value: String(ex.images.total) },
    { label: "Images missing alt text", value: String(ex.images.missingAlt) },
    { label: "Internal links", value: String(ex.links.internal) },
    { label: "External links", value: String(ex.links.external) },
    { label: "Structured data blocks", value: String(ex.structuredData?.length ?? 0) },
    { label: "Render mode", value: ex.renderMode === "rendered" ? "Headless browser render" : "Static HTML fetch" },
  ];
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function severityLabel(p: Recommendation["priority"]): string {
  return p.toUpperCase();
}
