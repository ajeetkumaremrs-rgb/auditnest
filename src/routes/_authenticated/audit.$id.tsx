import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { getAudit, runAudit } from "@/lib/audit.functions";
import type { AuditReport, Extracted, LighthouseSummary, Recommendation, ScoreComponent } from "@/lib/audit-shared";
import {
  band,
  bandTone,
  executiveSummary,
  formatDate,
  hostOf,
  lighthouseMetricRows,
  priorityActionPlan,
  severityCounts,
  sortedIssues,
  technicalRows,
  UNAVAILABLE_NOTE,
} from "@/lib/audit-view";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ExternalLink, Loader2, AlertTriangle, RotateCw, Download, ShieldCheck } from "lucide-react";
import { useState } from "react";

export const Route = createFileRoute("/_authenticated/audit/$id")({
  head: () => ({
    meta: [
      { title: "Audit report — AuditNest" },
      { name: "description", content: "Read a full AuditNest website audit report: scores, priority issues, SEO, accessibility, performance and a fix-first action plan." },
      { property: "og:title", content: "Audit report — AuditNest" },
      { property: "og:description", content: "A professional AuditNest website audit report with verified scores and a prioritised action plan." },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AuditView,
});

function AuditView() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const fn = useServerFn(getAudit);
  const runFn = useServerFn(runAudit);
  const { data, isLoading, error } = useQuery({
    queryKey: ["audit", id],
    queryFn: () => fn({ data: { id } }),
  });

  const retry = useMutation({
    mutationFn: (u: string) => runFn({ data: { url: u } }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["audits"] });
      navigate({ to: "/audit/$id", params: { id: res.id } });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Audit failed"),
  });

  const [downloading, setDownloading] = useState(false);

  if (isLoading) {
    return (
      <div className="min-h-screen grid place-items-center text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="min-h-screen grid place-items-center text-center px-4">
        <div>
          <AlertTriangle className="h-8 w-8 mx-auto mb-2 text-destructive" />
          <p className="mb-4">{error instanceof Error ? error.message : "Failed to load audit"}</p>
          <Link to="/dashboard"><Button>Back to dashboard</Button></Link>
        </div>
      </div>
    );
  }

  const { url, status, report, lighthouse, extracted } = data;

  const handleDownload = async () => {
    if (!report) return;
    setDownloading(true);
    try {
      const { downloadAuditPdf } = await import("@/lib/audit-pdf");
      await downloadAuditPdf({ url, createdAt: data.created_at, report, lighthouse, extracted, reportId: id });
      toast.success("Report downloaded");
    } catch (e) {
      toast.error(`Could not generate the PDF: ${e instanceof Error ? e.message : "unknown error"}.`);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="min-h-screen w-full overflow-x-hidden bg-muted/40">
      {/* Compact, non-blocking control bar */}
      <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto grid w-full max-w-4xl grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 px-3 py-2 sm:px-5 sm:py-3">
          <Link
            to="/dashboard"
            aria-label="Back to dashboard"
            className="inline-flex h-10 items-center gap-2 rounded-md px-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4 shrink-0" />
            <span className="hidden sm:inline">Dashboard</span>
          </Link>

          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-w-0 items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <span className="truncate">{hostOf(url)}</span>
            <ExternalLink className="h-3.5 w-3.5 shrink-0" />
          </a>

          <div className="flex shrink-0 items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-10"
              disabled={retry.isPending}
              onClick={() => retry.mutate(url)}
            >
              {retry.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCw className="h-4 w-4" />}
              <span className="ml-1.5 hidden sm:inline">Retry</span>
            </Button>
            {report && (
              <Button size="sm" className="h-10" onClick={handleDownload} disabled={downloading}>
                {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                <span className="ml-1.5 hidden sm:inline">{downloading ? "Preparing…" : "Download PDF"}</span>
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-4xl px-3 py-6 sm:px-5 sm:py-10">
        {status === "failed" && (
          <Card className="mb-6 border-destructive/40 p-5 sm:p-6">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
              <div className="min-w-0">
                <h2 className="font-semibold">Audit failed</h2>
                <p className="mt-1 break-words text-sm text-muted-foreground">{data.error ?? "Unknown error"}</p>
              </div>
            </div>
          </Card>
        )}

        {report && (
          <ReportView
            report={report}
            lighthouse={lighthouse}
            extracted={extracted}
            url={url}
            createdAt={data.created_at}
            reportId={id}
            onDownload={handleDownload}
            downloading={downloading}
          />
        )}
      </main>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function ReportView({
  report,
  lighthouse,
  extracted,
  url,
  createdAt,
  reportId,
  onDownload,
  downloading,
}: {
  report: AuditReport;
  lighthouse: LighthouseSummary | null;
  extracted: Extracted | null;
  url: string;
  createdAt: string;
  reportId: string;
  onDownload: () => void;
  downloading: boolean;
}) {
  const summaryLines = executiveSummary(report);
  const issues = sortedIssues(report);
  const plan = priorityActionPlan(report);
  const counts = severityCounts(report);
  const tech = technicalRows(extracted);
  const metricRows = lighthouseMetricRows(lighthouse);
  const scoreBand = band(report.overallScore);

  return (
    <article className="space-y-5 sm:space-y-6">
      {/* ---------- Report header ---------- */}
      <Card className="overflow-hidden p-0">
        <div className="border-b bg-card px-5 py-5 sm:px-8 sm:py-6">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
                  <ShieldCheck className="h-4.5 w-4.5" />
                </span>
                <span className="font-display text-lg font-semibold tracking-tight">AuditNest</span>
              </div>
              <h1 className="mt-3 font-display text-2xl font-semibold tracking-tight sm:text-3xl">
                Website Audit Report
              </h1>
            </div>
            <div className="shrink-0 text-right text-xs text-muted-foreground">
              <div>{formatDate(createdAt)}</div>
              <div className="mt-1 font-mono">ID {reportId.slice(0, 8)}</div>
            </div>
          </div>

          <div className="mt-5 rounded-lg border bg-muted/50 p-4">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Audited website</div>
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="mt-1 block break-all text-sm font-medium text-primary underline-offset-4 hover:underline sm:text-base"
            >
              {url}
            </a>
          </div>
        </div>

        {/* ---------- Overall score ---------- */}
        <div className="grid gap-6 px-5 py-6 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center sm:px-8 sm:py-8">
          <ScoreRing value={report.overallScore} />
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Overall website score</div>
            <div className="mt-1 font-display text-xl font-semibold sm:text-2xl">
              {scoreBand ?? "Data not available"}
            </div>
            <p className="mt-2 break-words text-sm leading-relaxed text-muted-foreground">
              Overall score is calculated from available audit components. Components without verified
              data are excluded and the remaining weights are renormalised.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {counts.high > 0 && <SeverityBadge priority="high" count={counts.high} />}
              {counts.medium > 0 && <SeverityBadge priority="medium" count={counts.medium} />}
              {counts.low > 0 && <SeverityBadge priority="low" count={counts.low} />}
            </div>
            <Button className="mt-5 h-11 w-full sm:w-auto" onClick={onDownload} disabled={downloading}>
              {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              <span className="ml-2">{downloading ? "Preparing PDF…" : "Download Report (PDF)"}</span>
            </Button>
          </div>
        </div>
      </Card>

      {/* ---------- Warnings ---------- */}
      {report.warnings?.length > 0 && (
        <Card className="border-warning/50 bg-warning/5 p-5 sm:p-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning-foreground" />
            <ul className="min-w-0 space-y-1.5 break-words text-sm">
              {report.warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          </div>
        </Card>
      )}

      {extracted?.blocked && (
        <Card className="border-warning/50 bg-warning/5 p-5 text-sm sm:p-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning-foreground" />
            <div className="min-w-0 break-words">
              <p className="font-medium">This website blocks automated crawlers, so content results are incomplete.</p>
              <p className="mt-1 text-muted-foreground">
                {extracted.blockReason ?? "An anti-bot or challenge page was served instead of the real content."}{" "}
                No SEO, UX, CTA or conversion scores were generated from it.
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* ---------- Executive summary ---------- */}
      <Section title="Executive summary">
        <div className="space-y-3 text-[15px] leading-relaxed">
          {summaryLines.map((line, i) => (
            <p key={i} className={i === 0 ? "font-medium" : "text-muted-foreground"}>{line}</p>
          ))}
        </div>
      </Section>

      {/* ---------- Score summary ---------- */}
      {(report.scoreBreakdown?.length ?? 0) > 0 && (
        <Section
          title="Score summary"
          subtitle="Only components with verified audit data receive a score."
        >
          <div className="grid grid-cols-1 gap-3 xs:grid-cols-2 sm:grid-cols-3">
            {report.scoreBreakdown!.map((c) => <ScoreCard key={c.key} c={c} />)}
          </div>
        </Section>
      )}

      {/* ---------- Top priority issues ---------- */}
      {issues.length > 0 && (
        <Section title="Top priority issues" subtitle="Ordered by severity, highest impact first.">
          <div className="space-y-4">
            {issues.map((r, i) => <IssueCard key={i} r={r} />)}
          </div>
        </Section>
      )}

      {/* ---------- Performance ---------- */}
      <Section
        title="Performance"
        subtitle={
          lighthouse
            ? `Measured by Google Lighthouse (${lighthouse.strategy})${lighthouse.cached ? " — cached result" : ""}.`
            : undefined
        }
      >
        {!lighthouse ? (
          <Unavailable reason="PageSpeed Insights did not return data for this audit." />
        ) : (
          <>
            <div className="mb-4 flex flex-wrap gap-2 text-xs">
              <Chip>
                {lighthouse.apiKeyUsed
                  ? "PageSpeed API key active (higher quota)"
                  : "Keyless mode — rate limits may apply"}
              </Chip>
              {typeof lighthouse.attempts === "number" && (
                <Chip>{lighthouse.attempts} attempt{lighthouse.attempts === 1 ? "" : "s"}</Chip>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <MiniScore label="Performance" score={lighthouse.performance} />
              <MiniScore label="Accessibility" score={lighthouse.accessibility} />
              <MiniScore label="SEO" score={lighthouse.seo} />
              <MiniScore label="Best Practices" score={lighthouse.bestPractices} />
            </div>
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {metricRows.map((m) => (
                <div key={m.label} className="min-w-0 rounded-lg border bg-muted/40 p-3">
                  <div className="break-words text-xs uppercase tracking-wider text-muted-foreground">{m.label}</div>
                  {m.value ? (
                    <div className="mt-1 font-display text-lg font-semibold">{m.value}</div>
                  ) : (
                    <div className="mt-1 text-sm text-muted-foreground">
                      Not available
                      <span className="block text-xs">{m.reason || UNAVAILABLE_NOTE}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
            {report.performance.notes && (
              <p className="mt-4 break-words text-sm leading-relaxed text-muted-foreground">
                {report.performance.notes}
              </p>
            )}
          </>
        )}
      </Section>

      {/* ---------- SEO ---------- */}
      <Section title="SEO" subtitle="Findings from the fetched page HTML.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Page title">{report.seo.metaTitle}</Field>
          <Field label="Meta description">{report.seo.metaDescription}</Field>
          <Field label="Heading structure">{report.seo.headings}</Field>
          <Field label="Image alt text">{report.seo.imageAlt}</Field>
        </div>
        <Bullets items={report.seo.other} className="mt-4" />
      </Section>

      {/* ---------- Accessibility ---------- */}
      <Section title="Accessibility">
        <Bullets items={report.accessibility} />
      </Section>

      {/* ---------- Mobile experience ---------- */}
      <Section title="Mobile experience">
        <Bullets items={report.mobile} />
      </Section>

      {/* ---------- User experience ---------- */}
      <Section title="User experience" subtitle="Heuristic recommendations based on the crawled page structure.">
        <div className="space-y-4">
          <div>
            <SubHeading>Homepage clarity</SubHeading>
            <p className="break-words text-[15px] leading-relaxed text-muted-foreground">{report.homepageClarity}</p>
          </div>
          <Bullets items={report.ux} />
          <div>
            <SubHeading>Trust signals</SubHeading>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <SignalList title="Detected" items={report.trust.detected} tone="success" />
              <SignalList title="Missing" items={report.trust.missing} tone="destructive" />
            </div>
            {report.trust.notes && (
              <p className="mt-3 break-words text-sm leading-relaxed text-muted-foreground">{report.trust.notes}</p>
            )}
          </div>
        </div>
      </Section>

      {/* ---------- Conversion ---------- */}
      <Section title="Conversion optimisation">
        <SubHeading>Call-to-action findings</SubHeading>
        <Bullets items={report.ctaAnalysis.findings} />
        {report.ctaAnalysis.suggestedCta && (
          <div className="mt-4 min-w-0 rounded-lg border bg-accent/40 p-4">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Suggested CTA</div>
            <div className="mt-1 break-words font-medium">{report.ctaAnalysis.suggestedCta}</div>
          </div>
        )}
        <SubHeading className="mt-5">Conversion audit</SubHeading>
        <Bullets items={report.conversion} />
      </Section>

      {/* ---------- Priority action plan ---------- */}
      {plan.length > 0 && (
        <Section title="Priority action plan" subtitle="The five most important fixes, in order.">
          <ol className="space-y-4">
            {plan.map((r, i) => (
              <li key={i} className="min-w-0 rounded-xl border p-4 sm:p-5">
                <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-3">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary/10 font-display text-sm font-semibold text-primary">
                    {i + 1}
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="break-words font-semibold">{r.problem}</h4>
                      <SeverityBadge priority={r.priority} />
                    </div>
                    <p className="mt-2 break-words text-sm leading-relaxed text-muted-foreground">
                      <span className="font-medium text-foreground">Why this comes first: </span>{r.why}
                    </p>
                    <p className="mt-1.5 break-words text-sm leading-relaxed text-muted-foreground">
                      <span className="font-medium text-foreground">Action: </span>{r.fix}
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </Section>
      )}

      {/* ---------- Suggested rewrites ---------- */}
      {Object.values(report.suggestions ?? {}).some(Boolean) && (
        <Section title="Suggested rewrites">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {Object.entries(report.suggestions).map(([k, v]) =>
              v ? (
                <div key={k} className="min-w-0 rounded-lg border p-4">
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">{k}</div>
                  <div className="mt-1 break-words text-sm leading-relaxed">{v}</div>
                </div>
              ) : null,
            )}
          </div>
        </Section>
      )}

      {/* ---------- Technical summary ---------- */}
      {tech.length > 0 && (
        <Section title="Technical summary">
          <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {tech.map((t) => (
              <div key={t.label} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3 rounded-lg bg-muted/50 px-3 py-2.5">
                <dt className="break-words text-sm text-muted-foreground">{t.label}</dt>
                <dd className="min-w-0 break-all text-right text-sm font-medium">
                  {t.value ?? <span className="font-normal text-muted-foreground">Not available</span>}
                </dd>
              </div>
            ))}
          </dl>
          {extracted?.captureWarning && (
            <p className="mt-3 break-words text-sm text-muted-foreground">{extracted.captureWarning}</p>
          )}
        </Section>
      )}

      {/* ---------- Provenance ---------- */}
      {(report.scoreBreakdown?.length ?? 0) > 0 && (
        <Section title="Score calculation & data provenance">
          {report.scoreBasis && (
            <p className="mb-4 break-words text-sm leading-relaxed text-muted-foreground">{report.scoreBasis}</p>
          )}
          <div className="space-y-3">
            {report.scoreBreakdown!.map((c) => (
              <div key={c.key} className="min-w-0 rounded-lg border p-4 text-sm">
                <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                  <span className="break-words font-medium">{c.label}</span>
                  <span className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">{c.status}</Badge>
                    <span className="text-xs text-muted-foreground">weight {Math.round(c.weight * 100)}%</span>
                    <span className="font-semibold">{c.value ?? "Not available"}</span>
                  </span>
                </div>
                <p className="break-words text-xs text-muted-foreground">Source: {c.source}</p>
                {c.inputs.length > 0 && (
                  <ul className="mt-2 grid list-disc grid-cols-1 gap-x-6 gap-y-1 pl-5 text-xs text-muted-foreground sm:grid-cols-2">
                    {c.inputs.map((x, i) => <li key={i} className="break-words">{x}</li>)}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      <p className="px-1 pb-4 text-center text-xs text-muted-foreground">
        Generated by AuditNest · {hostOf(url)} · {formatDate(createdAt)}
      </p>
    </article>
  );
}

/* ------------------------------ primitives ------------------------------ */

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <Card className="min-w-0 p-5 sm:p-7">
      <h2 className="break-words font-display text-xl font-semibold tracking-tight sm:text-2xl">{title}</h2>
      {subtitle && <p className="mt-1 break-words text-sm text-muted-foreground">{subtitle}</p>}
      <div className="mt-4 min-w-0">{children}</div>
    </Card>
  );
}

function SubHeading({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <h3 className={`mb-2 break-words text-base font-semibold ${className}`}>{children}</h3>;
}

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full bg-muted px-2.5 py-1 text-muted-foreground">{children}</span>;
}

function Unavailable({ reason }: { reason: string }) {
  return (
    <div className="rounded-lg border border-dashed p-4">
      <div className="font-medium">Data not available</div>
      <p className="mt-1 break-words text-sm text-muted-foreground">{reason}</p>
    </div>
  );
}

function Bullets({ items, className = "" }: { items?: string[]; className?: string }) {
  if (!items?.length) return <p className="text-[15px] text-muted-foreground">No issues detected in this category.</p>;
  return (
    <ul className={`space-y-2 ${className}`}>
      {items.map((x, i) => (
        <li key={i} className="grid grid-cols-[auto_minmax(0,1fr)] gap-2.5 text-[15px] leading-relaxed">
          <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
          <span className="break-words">{x}</span>
        </li>
      ))}
    </ul>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg border p-3">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 break-words text-sm leading-relaxed">{children}</div>
    </div>
  );
}

function ScoreCard({ c }: { c: ScoreComponent }) {
  const tone = bandTone(c.value);
  const color =
    tone === "success" ? "text-success" : tone === "warning" ? "text-warning-foreground" : tone === "destructive" ? "text-destructive" : "text-muted-foreground";
  return (
    <div className="min-w-0 rounded-xl border p-4">
      <div className="break-words text-xs uppercase tracking-wider text-muted-foreground">{c.label}</div>
      {c.value === null ? (
        <div className="mt-2 text-sm text-muted-foreground">
          Not available
          <span className="block text-xs">{UNAVAILABLE_NOTE}</span>
        </div>
      ) : (
        <>
          <div className={`mt-1 font-display text-3xl font-semibold ${color}`}>{c.value}</div>
          <div className="text-sm text-muted-foreground">{band(c.value)}</div>
        </>
      )}
    </div>
  );
}

function MiniScore({ label, score }: { label: string; score: number | null }) {
  const tone = bandTone(score);
  const color =
    tone === "success" ? "text-success" : tone === "warning" ? "text-warning-foreground" : tone === "destructive" ? "text-destructive" : "text-muted-foreground";
  return (
    <div className="min-w-0 rounded-xl border p-3 text-center">
      <div className="break-words text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-1 font-display font-semibold ${score === null ? "text-sm" : "text-2xl"} ${color}`}>
        {score ?? "Not available"}
      </div>
    </div>
  );
}

function SeverityBadge({ priority, count }: { priority: Recommendation["priority"]; count?: number }) {
  const styles =
    priority === "high"
      ? "bg-destructive/10 text-destructive border-destructive/30"
      : priority === "medium"
        ? "bg-warning/15 text-warning-foreground border-warning/40"
        : "bg-muted text-muted-foreground border-border";
  return (
    <span className={`inline-flex shrink-0 items-center rounded-md border px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ${styles}`}>
      {priority}{count !== undefined ? ` · ${count}` : ""}
    </span>
  );
}

function IssueCard({ r }: { r: Recommendation }) {
  return (
    <div className="min-w-0 rounded-xl border p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <SeverityBadge priority={r.priority} />
        <h4 className="min-w-0 break-words text-base font-semibold">{r.problem}</h4>
      </div>
      <dl className="mt-3 space-y-2 text-[15px] leading-relaxed">
        <IssueLine term="Why it matters">{r.why}</IssueLine>
        <IssueLine term="Recommended fix">{r.fix}</IssueLine>
        <IssueLine term="Expected impact">{r.impact}</IssueLine>
      </dl>
    </div>
  );
}

function IssueLine({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{term}</dt>
      <dd className="break-words text-muted-foreground">{children}</dd>
    </div>
  );
}

function SignalList({ title, items, tone }: { title: string; items: string[]; tone: "success" | "destructive" }) {
  const color = tone === "success" ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive";
  return (
    <div className="min-w-0">
      <div className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">{title}</div>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">None recorded</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {items.map((s, i) => (
            <Badge key={i} variant="secondary" className={`max-w-full whitespace-normal break-words ${color}`}>{s}</Badge>
          ))}
        </div>
      )}
    </div>
  );
}

function ScoreRing({ value }: { value: number | null }) {
  if (value === null) {
    return (
      <div className="mx-auto grid h-36 w-36 place-items-center rounded-full border-2 border-dashed border-muted-foreground/40 px-4 text-center sm:mx-0 sm:h-40 sm:w-40">
        <div>
          <div className="font-display text-2xl font-semibold text-muted-foreground">N/A</div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">not enough data</div>
        </div>
      </div>
    );
  }
  const v = Math.max(0, Math.min(100, value));
  const color = v >= 75 ? "text-success" : v >= 50 ? "text-warning-foreground" : "text-destructive";
  return (
    <div
      className="score-ring mx-auto grid h-36 w-36 place-items-center rounded-full sm:mx-0 sm:h-40 sm:w-40"
      style={{ ["--score" as any]: v }}
    >
      <div className="grid h-28 w-28 place-items-center rounded-full bg-card sm:h-32 sm:w-32">
        <div className="text-center">
          <div className={`font-display text-4xl font-semibold sm:text-5xl ${color}`}>{v}</div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">/ 100</div>
        </div>
      </div>
    </div>
  );
}
