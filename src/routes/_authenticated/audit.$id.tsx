import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getAudit } from "@/lib/audit.functions";
import type { AuditReport, Extracted, LighthouseSummary, Priority } from "@/lib/audit-shared";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ExternalLink, Loader2, AlertTriangle } from "lucide-react";

export const Route = createFileRoute("/_authenticated/audit/$id")({
  head: () => ({
    meta: [
      { title: "Audit report — ConvertIQ" },
      { name: "description", content: "Review a ConvertIQ AI website audit report with SEO, UX, performance, and conversion insights." },
      { property: "og:title", content: "Audit report — ConvertIQ" },
      { property: "og:description", content: "A detailed ConvertIQ website audit report for SEO, UX, performance, and conversion improvements." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AuditView,
});

function AuditView() {
  const { id } = Route.useParams();
  const fn = useServerFn(getAudit);
  const { data, isLoading, error } = useQuery({
    queryKey: ["audit", id],
    queryFn: () => fn({ data: { id } }),
  });

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

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b bg-background">
        <div className="max-w-5xl mx-auto flex items-center justify-between px-4 h-16">
          <Link to="/dashboard" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> Dashboard
          </Link>
          <a href={url} target="_blank" rel="noreferrer" className="text-sm inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
            {url} <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-10 space-y-6">
        {status === "failed" && (
          <Card className="p-6 border-destructive/40">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
              <div>
                <h2 className="font-semibold mb-1">Audit failed</h2>
                <p className="text-sm text-muted-foreground">{data.error ?? "Unknown error"}</p>
              </div>
            </div>
          </Card>
        )}

        {report && <ReportView report={report} lighthouse={lighthouse} extracted={extracted} />}
      </main>
    </div>
  );
}

function ReportView({
  report,
  lighthouse,
  extracted,
}: {
  report: AuditReport;
  lighthouse: LighthouseSummary | null;
  extracted: Extracted | null;
}) {
  return (
    <>
      <Card className="p-8">
        <div className="flex flex-col md:flex-row gap-8 items-center">
          <ScoreRing value={report.overallScore} />
          <div className="flex-1">
            <h1 className="text-2xl font-semibold mb-2">Overall audit score</h1>
            <p className="text-muted-foreground">{report.summary}</p>
          </div>
        </div>
      </Card>

      {lighthouse && (
        <Section title="Lighthouse performance">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <MetricCard label="Performance" score={lighthouse.performance} />
            <MetricCard label="Accessibility" score={lighthouse.accessibility} />
            <MetricCard label="SEO" score={lighthouse.seo} />
            <MetricCard label="Best Practices" score={lighthouse.bestPractices} />
          </div>
          <div className="mt-4 grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
            {Object.entries(lighthouse.metrics).map(([k, v]) => (
              <div key={k} className="rounded-lg bg-muted p-3">
                <div className="text-xs uppercase text-muted-foreground tracking-wider">{k}</div>
                <div className="font-medium">{v ?? "—"}</div>
              </div>
            ))}
          </div>
          {lighthouse.error && (
            <p className="mt-3 text-xs text-muted-foreground">Note: {lighthouse.error}</p>
          )}
          <p className="mt-3 text-sm text-muted-foreground">{report.performance.notes}</p>
        </Section>
      )}

      <Section title="Homepage clarity"><P>{report.homepageClarity}</P></Section>

      <Section title="Call-to-action">
        <ul className="list-disc pl-5 space-y-1 text-sm">
          {report.ctaAnalysis.findings.map((f, i) => <li key={i}>{f}</li>)}
        </ul>
        <div className="mt-4 rounded-lg border bg-accent/40 p-4 text-sm">
          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Suggested CTA</div>
          <div className="font-medium">{report.ctaAnalysis.suggestedCta}</div>
        </div>
      </Section>

      <Section title="Trust signals">
        <div className="grid md:grid-cols-2 gap-4">
          <SignalList title="Detected" items={report.trust.detected} tone="success" />
          <SignalList title="Missing" items={report.trust.missing} tone="destructive" />
        </div>
        <P className="mt-4">{report.trust.notes}</P>
      </Section>

      <Section title="User experience">
        <BulletList items={report.ux} />
      </Section>

      <Section title="Mobile experience">
        <BulletList items={report.mobile} />
      </Section>

      <Section title="SEO">
        <dl className="grid md:grid-cols-2 gap-4 text-sm mb-4">
          <Row label="Meta title">{report.seo.metaTitle}</Row>
          <Row label="Meta description">{report.seo.metaDescription}</Row>
          <Row label="Headings">{report.seo.headings}</Row>
          <Row label="Image alt text">{report.seo.imageAlt}</Row>
        </dl>
        <BulletList items={report.seo.other} />
      </Section>

      <Section title="Accessibility"><BulletList items={report.accessibility} /></Section>

      <Section title="Conversion audit"><BulletList items={report.conversion} /></Section>

      <Section title="Prioritised recommendations">
        <div className="space-y-4">
          {report.recommendations.map((r, i) => <RecCard key={i} r={r} />)}
        </div>
      </Section>

      <Section title="Competitor-level rewrites">
        <div className="grid md:grid-cols-2 gap-4">
          {Object.entries(report.suggestions).map(([k, v]) =>
            v ? (
              <div key={k} className="rounded-lg border p-4">
                <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">{k}</div>
                <div className="text-sm">{v}</div>
              </div>
            ) : null,
          )}
        </div>
      </Section>

      {extracted && (
        <Section title="What we crawled">
          <div className="grid md:grid-cols-2 gap-3 text-sm">
            <Kv k="Final URL" v={extracted.finalUrl} />
            <Kv k="Status" v={String(extracted.statusCode)} />
            <Kv k="Title" v={extracted.title ?? "—"} />
            <Kv k="Words" v={String(extracted.wordCount)} />
            <Kv k="H1s" v={String(extracted.h1Count)} />
            <Kv k="Images (missing alt)" v={`${extracted.images.total} (${extracted.images.missingAlt})`} />
            <Kv k="Links int/ext" v={`${extracted.links.internal} / ${extracted.links.external}`} />
            <Kv k="HTTPS" v={extracted.sslValid ? "Yes" : "No"} />
            <Kv k="robots.txt" v={extracted.hasRobots ? "Found" : "Missing"} />
            <Kv k="sitemap.xml" v={extracted.hasSitemap ? "Found" : "Missing"} />
          </div>
        </Section>
      )}
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="p-6">
      <h2 className="text-lg font-semibold mb-4">{title}</h2>
      {children}
    </Card>
  );
}
function P({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <p className={`text-sm text-muted-foreground ${className}`}>{children}</p>;
}
function BulletList({ items }: { items: string[] }) {
  if (!items?.length) return <P>No issues found.</P>;
  return <ul className="list-disc pl-5 space-y-1 text-sm">{items.map((x, i) => <li key={i}>{x}</li>)}</ul>;
}
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">{label}</div>
      <div>{children}</div>
    </div>
  );
}
function Kv({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-lg bg-muted p-3">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{k}</div>
      <div className="font-medium break-all">{v}</div>
    </div>
  );
}
function SignalList({ title, items, tone }: { title: string; items: string[]; tone: "success" | "destructive" }) {
  const color = tone === "success" ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive";
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">{title}</div>
      {items.length === 0 ? (
        <P>—</P>
      ) : (
        <div className="flex flex-wrap gap-2">
          {items.map((s, i) => <Badge key={i} variant="secondary" className={color}>{s}</Badge>)}
        </div>
      )}
    </div>
  );
}
function RecCard({ r }: { r: { problem: string; why: string; fix: string; impact: string; priority: Priority } }) {
  const tone: Record<Priority, string> = {
    high: "bg-destructive/15 text-destructive",
    medium: "bg-warning/15 text-warning-foreground",
    low: "bg-success/15 text-success",
  };
  return (
    <div className="rounded-lg border p-5">
      <div className="flex items-start justify-between gap-4 mb-2">
        <h3 className="font-semibold">{r.problem}</h3>
        <Badge className={tone[r.priority]}>{r.priority}</Badge>
      </div>
      <div className="grid md:grid-cols-3 gap-3 text-sm">
        <Field label="Why it matters">{r.why}</Field>
        <Field label="How to fix">{r.fix}</Field>
        <Field label="Expected impact">{r.impact}</Field>
      </div>
    </div>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">{label}</div>
      <div>{children}</div>
    </div>
  );
}

function MetricCard({ label, score }: { label: string; score: number | null }) {
  const color = score === null ? "" : score >= 80 ? "text-success" : score >= 50 ? "text-warning-foreground" : "text-destructive";
  return (
    <div className="rounded-lg border p-4 text-center">
      <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">{label}</div>
      <div className={`text-3xl font-semibold font-display ${color}`}>{score ?? "—"}</div>
    </div>
  );
}

function ScoreRing({ value }: { value: number }) {
  const v = Math.max(0, Math.min(100, value));
  const color = v >= 80 ? "text-success" : v >= 50 ? "text-warning-foreground" : "text-destructive";
  return (
    <div
      className="score-ring rounded-full h-40 w-40 grid place-items-center"
      style={{ ["--score" as any]: v }}
    >
      <div className="bg-card rounded-full h-32 w-32 grid place-items-center">
        <div className="text-center">
          <div className={`text-5xl font-semibold font-display ${color}`}>{v}</div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">/ 100</div>
        </div>
      </div>
    </div>
  );
}
