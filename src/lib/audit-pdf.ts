import type { AuditReport, Extracted, LighthouseSummary, Recommendation } from "./audit-shared";
import {
  band,
  executiveSummary,
  formatDate,
  hostOf,
  lighthouseMetricRows,
  priorityActionPlan,
  sortedIssues,
  technicalRows,
  UNAVAILABLE_NOTE,
} from "./audit-view";

/* ------------------------------------------------------------------ *
 * A4 PDF renderer with a block-flow layout engine:
 * every block is measured before it is drawn, so a block never splits
 * across pages, headings always stay with their first block, and pages
 * are only created when the remaining content genuinely does not fit.
 * ------------------------------------------------------------------ */

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const M = 52; // page margin
const FOOTER_H = 34;
const CONTENT_W = PAGE_W - M * 2;
const BOTTOM = PAGE_H - M - FOOTER_H;

const INK: RGB = [26, 28, 38];
const SOFT: RGB = [104, 110, 128];
const LINE: RGB = [223, 226, 234];
const BRAND: RGB = [86, 74, 214];
const GOOD: RGB = [24, 132, 88];
const WARN: RGB = [176, 108, 12];
const BAD: RGB = [190, 46, 46];

type RGB = [number, number, number];

export interface PdfInput {
  url: string;
  createdAt: string;
  report: AuditReport;
  lighthouse: LighthouseSummary | null;
  extracted: Extracted | null;
  reportId?: string;
}

type Doc = any;

/** A measured, drawable unit of content. */
interface Block {
  height: number;
  draw: (y: number) => void;
  /** Keep this block on the same page as the next one. */
  keepWithNext?: boolean;
}

export async function downloadAuditPdf(input: PdfInput) {
  const { jsPDF } = await import("jspdf");
  const doc: Doc = new jsPDF({ unit: "pt", format: "a4", compress: true });

  const blocks = buildBlocks(doc, input);
  flow(doc, blocks);
  drawFooters(doc, input);

  doc.save(`auditnest-report-${safeHost(input.url)}-${new Date(input.createdAt).toISOString().slice(0, 10)}.pdf`);
}

/* --------------------------- layout engine --------------------------- */

function flow(doc: Doc, blocks: Block[]) {
  let y = M;
  let first = true;

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    // Height that must fit: this block plus any keep-with-next chain.
    let needed = b.height;
    let j = i;
    while (blocks[j].keepWithNext && j + 1 < blocks.length) {
      j++;
      needed += blocks[j].height;
    }

    if (!first && y + needed > BOTTOM) {
      doc.addPage();
      y = M;
    }
    first = false;
    b.draw(y);
    y += b.height;
  }
}

/* ------------------------------ helpers ------------------------------ */

function setFont(doc: Doc, size: number, bold = false, color: RGB = INK) {
  doc.setFont("helvetica", bold ? "bold" : "normal");
  doc.setFontSize(size);
  doc.setTextColor(color[0], color[1], color[2]);
}

function wrap(doc: Doc, value: string, size: number, bold: boolean, width: number): string[] {
  setFont(doc, size, bold);
  return doc.splitTextToSize(value ?? "", width) as string[];
}

/** Paragraph block. */
function para(
  doc: Doc,
  value: string,
  opts: { size?: number; bold?: boolean; color?: RGB; indent?: number; gapAfter?: number; lead?: number } = {},
): Block {
  const size = opts.size ?? 10.5;
  const lead = opts.lead ?? size * 1.42;
  const indent = opts.indent ?? 0;
  const gap = opts.gapAfter ?? 6;
  const lines = wrap(doc, value, size, !!opts.bold, CONTENT_W - indent);
  return {
    height: lines.length * lead + gap,
    draw: (y) => {
      setFont(doc, size, !!opts.bold, opts.color ?? INK);
      let cy = y + size;
      for (const l of lines) {
        doc.text(l, M + indent, cy);
        cy += lead;
      }
    },
  };
}

function sectionHeading(doc: Doc, title: string, subtitle?: string): Block {
  const titleLines = wrap(doc, title, 15, true, CONTENT_W);
  const subLines = subtitle ? wrap(doc, subtitle, 9.5, false, CONTENT_W) : [];
  const h = 20 + titleLines.length * 19 + (subLines.length ? subLines.length * 13 + 2 : 0) + 8;
  return {
    keepWithNext: true,
    height: h,
    draw: (y) => {
      doc.setDrawColor(LINE[0], LINE[1], LINE[2]);
      doc.setLineWidth(0.8);
      doc.line(M, y + 8, PAGE_W - M, y + 8);
      setFont(doc, 15, true, INK);
      let cy = y + 8 + 20;
      for (const l of titleLines) {
        doc.text(l, M, cy);
        cy += 19;
      }
      if (subLines.length) {
        setFont(doc, 9.5, false, SOFT);
        cy += 2;
        for (const l of subLines) {
          doc.text(l, M, cy);
          cy += 13;
        }
      }
    },
  };
}

function spacer(h: number): Block {
  return { height: h, draw: () => {} };
}

function toneFor(v: number | null): RGB {
  if (v === null) return SOFT;
  if (v >= 75) return GOOD;
  if (v >= 50) return WARN;
  return BAD;
}

function labelValueGrid(doc: Doc, rows: { label: string; value: string | null; reason?: string }[], cols = 2): Block {
  const gutter = 14;
  const colW = (CONTENT_W - gutter * (cols - 1)) / cols;
  const cells = rows.map((r) => {
    const labelLines = wrap(doc, r.label, 8.5, false, colW - 16);
    const text = r.value ?? "Not available";
    const valueLines = wrap(doc, text, 10.5, true, colW - 16);
    const extra = r.value ? [] : wrap(doc, r.reason || UNAVAILABLE_NOTE, 8, false, colW - 16);
    const h = 10 + labelLines.length * 11 + valueLines.length * 13 + (extra.length ? extra.length * 10 + 2 : 0) + 10;
    return { r, labelLines, valueLines, extra, h };
  });

  // Row heights
  const rowHeights: number[] = [];
  for (let i = 0; i < cells.length; i += cols) {
    rowHeights.push(Math.max(...cells.slice(i, i + cols).map((c) => c.h)));
  }
  const total = rowHeights.reduce((a, b) => a + b + 8, 0);

  return {
    height: total + 4,
    draw: (y) => {
      let cy = y;
      for (let i = 0; i < cells.length; i += cols) {
        const rowH = rowHeights[i / cols];
        cells.slice(i, i + cols).forEach((c, k) => {
          const x = M + k * (colW + gutter);
          doc.setFillColor(248, 249, 252);
          doc.setDrawColor(LINE[0], LINE[1], LINE[2]);
          doc.roundedRect(x, cy, colW, rowH, 5, 5, "FD");
          let ty = cy + 10 + 8;
          setFont(doc, 8.5, false, SOFT);
          for (const l of c.labelLines) {
            doc.text(l, x + 8, ty);
            ty += 11;
          }
          setFont(doc, 10.5, true, c.r.value ? INK : SOFT);
          for (const l of c.valueLines) {
            doc.text(l, x + 8, ty + 2);
            ty += 13;
          }
          if (c.extra.length) {
            setFont(doc, 8, false, SOFT);
            for (const l of c.extra) {
              doc.text(l, x + 8, ty + 3);
              ty += 10;
            }
          }
        });
        cy += rowH + 8;
      }
    },
  };
}

function scoreCards(
  doc: Doc,
  items: { label: string; value: number | null; note?: string }[],
  cols = 3,
): Block {
  const gutter = 12;
  const colW = (CONTENT_W - gutter * (cols - 1)) / cols;
  const cells = items.map((it) => {
    const labelLines = wrap(doc, it.label, 8.5, false, colW - 16);
    const naLines = it.value === null ? wrap(doc, it.note || UNAVAILABLE_NOTE, 7.5, false, colW - 16) : [];
    const h = 10 + labelLines.length * 11 + (it.value === null ? naLines.length * 9.5 + 14 : 34) + 10;
    return { it, labelLines, naLines, h };
  });
  const rowHeights: number[] = [];
  for (let i = 0; i < cells.length; i += cols) {
    rowHeights.push(Math.max(...cells.slice(i, i + cols).map((c) => c.h)));
  }
  const total = rowHeights.reduce((a, b) => a + b + 10, 0);

  return {
    height: total + 4,
    draw: (y) => {
      let cy = y;
      for (let i = 0; i < cells.length; i += cols) {
        const rowH = rowHeights[i / cols];
        cells.slice(i, i + cols).forEach((c, k) => {
          const x = M + k * (colW + gutter);
          doc.setDrawColor(LINE[0], LINE[1], LINE[2]);
          doc.setFillColor(255, 255, 255);
          doc.roundedRect(x, cy, colW, rowH, 6, 6, "FD");
          let ty = cy + 18;
          setFont(doc, 8.5, false, SOFT);
          for (const l of c.labelLines) {
            doc.text(l, x + 8, ty);
            ty += 11;
          }
          if (c.it.value === null) {
            setFont(doc, 9.5, true, SOFT);
            doc.text("Not available", x + 8, ty + 8);
            ty += 18;
            setFont(doc, 7.5, false, SOFT);
            for (const l of c.naLines) {
              doc.text(l, x + 8, ty);
              ty += 9.5;
            }
          } else {
            setFont(doc, 22, true, toneFor(c.it.value));
            doc.text(String(c.it.value), x + 8, ty + 18);
            setFont(doc, 8.5, false, SOFT);
            doc.text(band(c.it.value) ?? "", x + 8 + doc.getTextWidth(String(c.it.value)) + 8, ty + 18);
          }
        });
        cy += rowH + 10;
      }
    },
  };
}

function severityColor(p: Recommendation["priority"]): RGB {
  return p === "high" ? BAD : p === "medium" ? WARN : SOFT;
}

function issueCard(doc: Doc, r: Recommendation, index?: number): Block {
  const pad = 12;
  const innerW = CONTENT_W - pad * 2;
  const badgeW = 46;
  const titlePrefix = index !== undefined ? `${index}. ` : "";
  const titleLines = wrap(doc, titlePrefix + r.problem, 11.5, true, innerW - badgeW - 8);
  const fields: { k: string; v: string }[] = [
    { k: "What we found", v: r.problem },
    { k: "Why it matters", v: r.why },
    { k: "Recommended fix", v: r.fix },
    { k: "Expected impact", v: r.impact },
  ].filter((f) => !!f.v);
  const fieldLines = fields.map((f) => ({
    k: f.k,
    lines: wrap(doc, f.v, 9.8, false, innerW - 8),
  }));

  const bodyH = fieldLines.reduce((a, f) => a + 11 + f.lines.length * 13 + 5, 0);
  const h = pad + Math.max(titleLines.length * 14, 16) + 8 + bodyH + pad;

  return {
    height: h + 10,
    draw: (y) => {
      doc.setDrawColor(LINE[0], LINE[1], LINE[2]);
      doc.setFillColor(255, 255, 255);
      doc.roundedRect(M, y, CONTENT_W, h, 6, 6, "FD");

      // severity badge
      const sc = severityColor(r.priority);
      doc.setDrawColor(sc[0], sc[1], sc[2]);
      doc.setFillColor(255, 255, 255);
      doc.roundedRect(M + pad, y + pad, badgeW, 14, 3, 3, "FD");
      setFont(doc, 7.5, true, sc);
      doc.text(r.priority.toUpperCase(), M + pad + badgeW / 2, y + pad + 9.5, { align: "center" });

      setFont(doc, 11.5, true, INK);
      let ty = y + pad + 11;
      for (const l of titleLines) {
        doc.text(l, M + pad + badgeW + 8, ty);
        ty += 14;
      }
      ty = y + pad + Math.max(titleLines.length * 14, 16) + 8;

      for (const f of fieldLines) {
        setFont(doc, 7.5, true, SOFT);
        doc.text(f.k.toUpperCase(), M + pad, ty);
        ty += 11;
        setFont(doc, 9.8, false, INK);
        for (const l of f.lines) {
          doc.text(l, M + pad, ty + 4);
          ty += 13;
        }
        ty += 5;
      }
    },
  };
}

function bullets(doc: Doc, items: string[] | undefined, emptyText = "No issues detected in this category."): Block[] {
  if (!items?.length) return [para(doc, emptyText, { color: SOFT, size: 10 })];
  return items.map((it) => {
    const lines = wrap(doc, it, 10.2, false, CONTENT_W - 16);
    return {
      height: lines.length * 14 + 4,
      draw: (y: number) => {
        doc.setFillColor(BRAND[0], BRAND[1], BRAND[2]);
        doc.circle(M + 3, y + 6.5, 1.8, "F");
        setFont(doc, 10.2, false, INK);
        let cy = y + 10;
        for (const l of lines) {
          doc.text(l, M + 16, cy);
          cy += 14;
        }
      },
    };
  });
}

/* ------------------------------- content ------------------------------- */

function buildBlocks(doc: Doc, input: PdfInput): Block[] {
  const { report, lighthouse, extracted, url } = input;
  const b: Block[] = [];
  const dateStr = formatDate(input.createdAt);

  /* ---- Cover header ---- */
  b.push({
    height: 96,
    keepWithNext: true,
    draw: (y) => {
      doc.setFillColor(BRAND[0], BRAND[1], BRAND[2]);
      doc.roundedRect(M, y, 22, 22, 5, 5, "F");
      setFont(doc, 12, true, [255, 255, 255]);
      doc.text("A", M + 11, y + 15, { align: "center" });
      setFont(doc, 15, true, INK);
      doc.text("AuditNest", M + 30, y + 16);
      setFont(doc, 9, false, SOFT);
      doc.text(dateStr, PAGE_W - M, y + 10, { align: "right" });
      if (input.reportId) doc.text(`Report ID ${input.reportId.slice(0, 8)}`, PAGE_W - M, y + 22, { align: "right" });
      setFont(doc, 23, true, INK);
      doc.text("Website Audit Report", M, y + 58);
      doc.setDrawColor(LINE[0], LINE[1], LINE[2]);
      doc.line(M, y + 76, PAGE_W - M, y + 76);
    },
  });

  const urlLines = wrap(doc, url, 11, true, CONTENT_W - 24);
  b.push({
    height: 26 + urlLines.length * 14 + 18,
    keepWithNext: true,
    draw: (y) => {
      const h = 26 + urlLines.length * 14;
      doc.setFillColor(248, 249, 252);
      doc.setDrawColor(LINE[0], LINE[1], LINE[2]);
      doc.roundedRect(M, y, CONTENT_W, h, 5, 5, "FD");
      setFont(doc, 8, false, SOFT);
      doc.text("AUDITED WEBSITE", M + 12, y + 14);
      setFont(doc, 11, true, BRAND);
      let cy = y + 28;
      for (const l of urlLines) {
        doc.text(l, M + 12, cy);
        cy += 14;
      }
    },
  });

  /* ---- Overall score ---- */
  const overall = report.overallScore;
  const basisLines = wrap(
    doc,
    "Overall score is calculated from available audit components. Components without verified data are excluded and the remaining weights are renormalised.",
    9,
    false,
    CONTENT_W - 150,
  );
  b.push({
    height: 92,
    draw: (y) => {
      doc.setDrawColor(LINE[0], LINE[1], LINE[2]);
      doc.setFillColor(255, 255, 255);
      doc.roundedRect(M, y, CONTENT_W, 80, 6, 6, "FD");
      setFont(doc, 40, true, toneFor(overall));
      doc.text(overall === null ? "N/A" : String(overall), M + 20, y + 50);
      setFont(doc, 9, false, SOFT);
      doc.text("Overall website score", M + 20, y + 66);
      setFont(doc, 13, true, toneFor(overall));
      doc.text(band(overall) ?? "Data not available", M + 130, y + 30);
      setFont(doc, 9, false, SOFT);
      let cy = y + 44;
      for (const l of basisLines) {
        doc.text(l, M + 130, cy);
        cy += 12;
      }
    },
  });

  /* ---- Executive summary ---- */
  b.push(sectionHeading(doc, "Executive summary"));
  const summary = executiveSummary(report);
  summary.forEach((line, i) =>
    b.push(para(doc, line, { size: 10.5, bold: i === 0, color: i === 0 ? INK : SOFT, gapAfter: 6 })),
  );

  /* ---- Warnings ---- */
  if (report.warnings?.length) {
    b.push(sectionHeading(doc, "Audit warnings"));
    b.push(...bullets(doc, report.warnings, "No warnings recorded."));
    b.push(spacer(6));
  }
  if (extracted?.blocked) {
    b.push(
      para(doc, `Crawler blocked — ${extracted.blockReason ?? "an anti-bot challenge page was served."}`, {
        size: 10,
        color: BAD,
      }),
    );
  }

  /* ---- Score summary ---- */
  const breakdown = report.scoreBreakdown ?? [];
  if (breakdown.length) {
    b.push(sectionHeading(doc, "Score summary", "Only components with verified audit data receive a score."));
    b.push(scoreCards(doc, breakdown.map((c) => ({ label: c.label, value: c.value })), 3));
  }

  /* ---- Priority issues ---- */
  const issues = sortedIssues(report);
  if (issues.length) {
    b.push(sectionHeading(doc, "Top priority issues", "Ordered by severity, highest impact first."));
    issues.forEach((r) => b.push(issueCard(doc, r)));
  }

  /* ---- Performance ---- */
  b.push(
    sectionHeading(
      doc,
      "Performance",
      lighthouse ? `Measured by Google Lighthouse (${lighthouse.strategy})${lighthouse.cached ? " — cached result" : ""}.` : undefined,
    ),
  );
  if (!lighthouse) {
    b.push(para(doc, "Data not available", { bold: true, size: 10.5 }));
    b.push(para(doc, "PageSpeed Insights did not return data for this audit.", { color: SOFT, size: 9.5 }));
  } else {
    b.push(
      scoreCards(
        doc,
        [
          { label: "Performance", value: lighthouse.performance },
          { label: "Accessibility", value: lighthouse.accessibility },
          { label: "SEO", value: lighthouse.seo },
          { label: "Best Practices", value: lighthouse.bestPractices },
        ],
        4,
      ),
    );
    b.push(labelValueGrid(doc, lighthouseMetricRows(lighthouse), 3));
    if (report.performance.notes) b.push(para(doc, report.performance.notes, { color: SOFT, size: 9.8 }));
  }

  /* ---- SEO ---- */
  b.push(sectionHeading(doc, "SEO", "Findings from the fetched page HTML."));
  b.push(
    labelValueGrid(
      doc,
      [
        { label: "Page title", value: report.seo.metaTitle || null },
        { label: "Meta description", value: report.seo.metaDescription || null },
        { label: "Heading structure", value: report.seo.headings || null },
        { label: "Image alt text", value: report.seo.imageAlt || null },
      ],
      2,
    ),
  );
  b.push(...bullets(doc, report.seo.other, "No additional SEO issues detected."));

  /* ---- Accessibility ---- */
  b.push(sectionHeading(doc, "Accessibility"));
  b.push(...bullets(doc, report.accessibility));

  /* ---- Mobile ---- */
  b.push(sectionHeading(doc, "Mobile experience"));
  b.push(...bullets(doc, report.mobile));

  /* ---- UX ---- */
  b.push(sectionHeading(doc, "User experience", "Heuristic recommendations based on the crawled page structure."));
  if (report.homepageClarity) b.push(para(doc, report.homepageClarity, { size: 10.2, color: SOFT }));
  b.push(...bullets(doc, report.ux));
  b.push(spacer(4));
  b.push(
    labelValueGrid(
      doc,
      [
        { label: "Trust signals detected", value: report.trust.detected?.join(", ") || null, reason: "No trust signals were detected on the page." },
        { label: "Trust signals missing", value: report.trust.missing?.join(", ") || null, reason: "No missing trust signals were recorded." },
      ],
      2,
    ),
  );
  if (report.trust.notes) b.push(para(doc, report.trust.notes, { color: SOFT, size: 9.8 }));

  /* ---- Conversion ---- */
  b.push(sectionHeading(doc, "Conversion optimisation"));
  b.push(...bullets(doc, report.ctaAnalysis.findings, "No call-to-action findings were recorded."));
  if (report.ctaAnalysis.suggestedCta) {
    b.push(spacer(4));
    b.push(labelValueGrid(doc, [{ label: "Suggested CTA", value: report.ctaAnalysis.suggestedCta }], 1));
  }
  b.push(...bullets(doc, report.conversion));

  /* ---- Action plan ---- */
  const plan = priorityActionPlan(report);
  if (plan.length) {
    b.push(sectionHeading(doc, "Priority action plan", "The most important fixes, in order."));
    plan.forEach((r, i) => b.push(issueCard(doc, r, i + 1)));
  }

  /* ---- Suggested rewrites ---- */
  const sugg = Object.entries(report.suggestions ?? {}).filter(([, v]) => !!v) as [string, string][];
  if (sugg.length) {
    b.push(sectionHeading(doc, "Suggested rewrites"));
    b.push(labelValueGrid(doc, sugg.map(([k, v]) => ({ label: k, value: v })), 2));
  }

  /* ---- Technical summary ---- */
  const tech = technicalRows(extracted);
  if (tech.length) {
    b.push(sectionHeading(doc, "Technical summary"));
    b.push(labelValueGrid(doc, tech, 2));
    if (extracted?.captureWarning) b.push(para(doc, extracted.captureWarning, { color: SOFT, size: 9.5 }));
  }

  /* ---- Provenance ---- */
  if (breakdown.length) {
    b.push(sectionHeading(doc, "Score calculation & data provenance"));
    if (report.scoreBasis) b.push(para(doc, report.scoreBasis, { color: SOFT, size: 9.8 }));
    for (const c of breakdown) {
      b.push(
        para(
          doc,
          `${c.label}: ${c.value === null ? "Not available" : c.value} · weight ${Math.round(c.weight * 100)}% · ${c.status}`,
          { bold: true, size: 10, gapAfter: 2 },
        ),
      );
      b.push(para(doc, `Source: ${c.source}`, { size: 8.8, color: SOFT, indent: 10, gapAfter: 2 }));
      for (const i of c.inputs) b.push(para(doc, `• ${i}`, { size: 8.8, color: SOFT, indent: 16, gapAfter: 1 }));
      b.push(spacer(5));
    }
  }

  return b;
}

/* ------------------------------- footers ------------------------------- */

function drawFooters(doc: Doc, input: PdfInput) {
  const pages = doc.getNumberOfPages();
  const host = hostOf(input.url);
  const dateStr = formatDate(input.createdAt);
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setDrawColor(LINE[0], LINE[1], LINE[2]);
    doc.setLineWidth(0.6);
    doc.line(M, PAGE_H - M - 18, PAGE_W - M, PAGE_H - M - 18);
    setFont(doc, 8, false, SOFT);
    const left = (doc.splitTextToSize(`Generated by AuditNest  |  ${host}  |  ${dateStr}`, CONTENT_W - 90) as string[])[0];
    doc.text(left, M, PAGE_H - M - 4);
    doc.text(`Page ${p} of ${pages}`, PAGE_W - M, PAGE_H - M - 4, { align: "right" });
  }
}

function safeHost(url: string) {
  return hostOf(url).replace(/[^a-z0-9.-]/gi, "") || "site";
}
