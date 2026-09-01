import type { AuditReport, Extracted, LighthouseSummary } from "./audit-shared";

const MARGIN = 48;
const PAGE_W = 595.28; // A4 portrait pt
const PAGE_H = 841.89;
const CONTENT_W = PAGE_W - MARGIN * 2;

export interface PdfInput {
  url: string;
  createdAt: string;
  report: AuditReport;
  lighthouse: LighthouseSummary | null;
  extracted: Extracted | null;
}

export async function downloadAuditPdf(input: PdfInput) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4" });

  const dateStr = new Date(input.createdAt).toLocaleString();
  let y = MARGIN;

  const ensure = (needed: number) => {
    if (y + needed > PAGE_H - MARGIN - 24) {
      doc.addPage();
      y = MARGIN;
    }
  };

  const text = (
    value: string,
    opts: { size?: number; bold?: boolean; gap?: number; color?: [number, number, number]; indent?: number } = {},
  ) => {
    const size = opts.size ?? 10;
    doc.setFont("helvetica", opts.bold ? "bold" : "normal");
    doc.setFontSize(size);
    doc.setTextColor(...(opts.color ?? [30, 30, 30]));
    const indent = opts.indent ?? 0;
    const lines = doc.splitTextToSize(value, CONTENT_W - indent) as string[];
    for (const line of lines) {
      ensure(size + 4);
      doc.text(line, MARGIN + indent, y);
      y += size + 3;
    }
    y += opts.gap ?? 0;
  };

  const heading = (value: string) => {
    ensure(40);
    y += 10;
    doc.setDrawColor(220);
    doc.line(MARGIN, y - 8, PAGE_W - MARGIN, y - 8);
    text(value, { size: 13, bold: true, gap: 4 });
  };

  const kv = (label: string, value: string | null | undefined, reason = "no data captured") => {
    text(`${label}: ${value != null && value !== "" ? value : `Unavailable — ${reason}`}`, { indent: 8 });
  };

  const na = (v: number | null | undefined, reason: string) =>
    v === null || v === undefined ? `Unavailable — ${reason}` : `${v}/100`;

  // ---------- Header ----------
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.setTextColor(20, 20, 20);
  doc.text("AuditNest", MARGIN, y + 6);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(110);
  doc.text("Website Audit Report", PAGE_W - MARGIN, y + 6, { align: "right" });
  y += 26;
  doc.setDrawColor(30);
  doc.line(MARGIN, y, PAGE_W - MARGIN, y);
  y += 20;

  text(`Audited website: ${input.url}`, { size: 11, bold: true });
  text(`Audit date: ${dateStr}`, { size: 10, color: [110, 110, 110], gap: 8 });

  // ---------- Score summary ----------
  const overall = input.report.overallScore;
  ensure(70);
  doc.setDrawColor(220);
  doc.roundedRect(MARGIN, y, CONTENT_W, 58, 6, 6);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(28);
  doc.setTextColor(20);
  doc.text(overall === null ? "N/A" : String(overall), MARGIN + 18, y + 38);
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(110);
  doc.text("Overall score", MARGIN + 18, y + 52);
  const basis = doc.splitTextToSize(
    input.report.scoreBasis || (overall === null ? "Unavailable — not enough verified data" : ""),
    CONTENT_W - 140,
  ) as string[];
  doc.text(basis.slice(0, 4), MARGIN + 130, y + 20);
  y += 74;

  text(input.report.summary || "Unavailable — no summary generated", { gap: 4 });

  // ---------- Component scores ----------
  heading("Component scores");
  const breakdown = input.report.scoreBreakdown ?? [];
  if (breakdown.length === 0) {
    text("Unavailable — no component breakdown recorded for this audit.", { indent: 8 });
  } else {
    for (const c of breakdown) {
      text(
        `${c.label}: ${c.value === null ? `Unavailable — ${c.status === "unavailable" ? "data not captured" : "not measured"}` : c.value} ` +
          `(weight ${Math.round(c.weight * 100)}%, ${c.status})`,
        { bold: true, indent: 8 },
      );
      text(`Source: ${c.source}`, { size: 9, color: [110, 110, 110], indent: 16 });
      for (const i of c.inputs) text(`• ${i}`, { size: 9, color: [90, 90, 90], indent: 20 });
      y += 4;
    }
  }

  // ---------- Lighthouse ----------
  heading("Lighthouse / PageSpeed Insights");
  const lh = input.lighthouse;
  if (!lh) {
    text("Unavailable — PageSpeed Insights did not return data for this audit.", { indent: 8 });
  } else {
    const reason = lh.error || "metric not reported by Lighthouse";
    kv("Performance", lh.performance === null ? null : String(lh.performance), reason);
    kv("Accessibility", lh.accessibility === null ? null : String(lh.accessibility), reason);
    kv("SEO", lh.seo === null ? null : String(lh.seo), reason);
    kv("Best Practices", lh.bestPractices === null ? null : String(lh.bestPractices), reason);
    y += 4;
    text("Core Web Vitals & metrics", { bold: true, indent: 8 });
    kv("FCP (First Contentful Paint)", lh.metrics.fcp, reason);
    kv("LCP (Largest Contentful Paint)", lh.metrics.lcp, reason);
    kv("CLS (Cumulative Layout Shift)", lh.metrics.cls, reason);
    kv("TBT (Total Blocking Time)", lh.metrics.tbt, reason);
    kv("TTI (Time to Interactive)", lh.metrics.tti, reason);
    kv("SI (Speed Index)", lh.metrics.si, reason);
    text(`Strategy: ${lh.strategy}${lh.cached ? " (cached)" : ""}`, { size: 9, color: [110, 110, 110], indent: 8 });
    if (lh.error) text(`Note: ${lh.error}`, { size: 9, color: [110, 110, 110], indent: 8 });
  }
  text(`Notes: ${input.report.performance.notes || "Unavailable — no notes generated"}`, { indent: 8 });

  // ---------- Warnings ----------
  heading("Warnings & data coverage");
  if (input.report.warnings?.length) {
    for (const w of input.report.warnings) text(`• ${w}`, { indent: 8 });
  } else {
    text("No warnings recorded.", { indent: 8 });
  }
  const cov = input.extracted?.dataCoverage;
  if (cov) {
    text(`Metadata: ${cov.metadata} | Page body: ${cov.pageBody} | Lighthouse: ${cov.lighthouse}`, { indent: 8 });
  }
  if (input.extracted?.blocked) {
    text(`Crawler blocked — ${input.extracted.blockReason ?? "anti-bot challenge page served"}`, { indent: 8 });
  }

  // ---------- Issues by severity ----------
  heading("Detected issues by severity");
  const recs = input.report.recommendations ?? [];
  if (recs.length === 0) {
    text("Unavailable — no issues were recorded for this audit.", { indent: 8 });
  } else {
    for (const level of ["high", "medium", "low"] as const) {
      const group = recs.filter((r) => r.priority === level);
      if (!group.length) continue;
      ensure(110);
      text(`${level.toUpperCase()} severity (${group.length})`, { size: 11, bold: true, gap: 2 });
      group.forEach((r, i) => {
        ensure(60);
        text(`${i + 1}. ${r.problem}`, { bold: true, indent: 8 });
        text(`Why it matters: ${r.why}`, { indent: 16 });
        text(`Recommended fix: ${r.fix}`, { indent: 16 });
        text(`Expected impact: ${r.impact}`, { indent: 16, gap: 4 });
      });
    }
  }

  // ---------- Category findings ----------
  heading("Homepage clarity");
  text(input.report.homepageClarity || "Unavailable — not generated", { indent: 8 });

  heading("Call-to-action");
  for (const f of input.report.ctaAnalysis.findings ?? []) text(`• ${f}`, { indent: 8 });
  text(`Suggested CTA: ${input.report.ctaAnalysis.suggestedCta || "Unavailable — not generated"}`, { indent: 8 });

  heading("Trust signals");
  text(`Detected: ${input.report.trust.detected?.join(", ") || "Unavailable — none detected"}`, { indent: 8 });
  text(`Missing: ${input.report.trust.missing?.join(", ") || "—"}`, { indent: 8 });
  text(input.report.trust.notes || "", { indent: 8 });

  const list = (title: string, items: string[] | undefined) => {
    heading(title);
    if (!items?.length) text("No issues found.", { indent: 8 });
    else for (const i of items) text(`• ${i}`, { indent: 8 });
  };
  list("User experience", input.report.ux);
  list("Mobile experience", input.report.mobile);

  heading("SEO");
  kv("Meta title", input.report.seo.metaTitle);
  kv("Meta description", input.report.seo.metaDescription);
  kv("Headings", input.report.seo.headings);
  kv("Image alt text", input.report.seo.imageAlt);
  for (const o of input.report.seo.other ?? []) text(`• ${o}`, { indent: 8 });

  list("Accessibility", input.report.accessibility);
  list("Conversion audit", input.report.conversion);

  heading("Suggested rewrites");
  const sugg = Object.entries(input.report.suggestions ?? {}).filter(([, v]) => v);
  if (!sugg.length) text("Unavailable — no rewrites generated.", { indent: 8 });
  for (const [k, v] of sugg) text(`${k}: ${v}`, { indent: 8 });

  // ---------- Technical crawl ----------
  heading("Technical crawl findings");
  const ex = input.extracted;
  if (!ex) {
    text("Unavailable — the crawler did not capture page data.", { indent: 8 });
  } else {
    kv("Final URL", ex.finalUrl);
    kv("HTTP status", String(ex.statusCode));
    kv("robots.txt", ex.hasRobots ? "Found" : "Not found at /robots.txt");
    kv("sitemap.xml", ex.hasSitemap ? "Found" : "Not found at /sitemap.xml");
    kv("HTTPS / SSL", ex.sslValid ? "Valid HTTPS" : "Not served over HTTPS");
    kv("Viewport meta", ex.hasViewport ? "Present" : "Missing");
    kv("Word count", String(ex.wordCount));
    kv("H1 count", String(ex.h1Count));
    kv("Images (missing alt)", `${ex.images.total} (${ex.images.missingAlt})`);
    kv("Links internal / external", `${ex.links.internal} / ${ex.links.external}`);
    kv("Render mode", ex.renderMode);
    if (ex.captureWarning) text(`Capture warning: ${ex.captureWarning}`, { indent: 8 });
  }

  // ---------- Footer on every page ----------
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(130);
    const left = doc.splitTextToSize(`${input.url} — ${dateStr}`, CONTENT_W - 90)[0] as string;
    doc.text(left, MARGIN, PAGE_H - 24);
    doc.text(`Page ${p} of ${pages}`, PAGE_W - MARGIN, PAGE_H - 24, { align: "right" });
  }

  const host = safeHost(input.url);
  doc.save(`auditnest-report-${host}-${new Date(input.createdAt).toISOString().slice(0, 10)}.pdf`);
}

function safeHost(url: string) {
  try {
    return new URL(url).hostname.replace(/[^a-z0-9.-]/gi, "");
  } catch {
    return "site";
  }
}
