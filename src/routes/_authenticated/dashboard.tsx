import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { listAudits, runAudit } from "@/lib/audit.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Sparkles, Loader2, ExternalLink, LogOut, Plus, Check, AlertTriangle } from "lucide-react";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — AuditNest" },
      { name: "description", content: "Run new website audits and review your history." },
      { property: "og:title", content: "Dashboard — AuditNest" },
      { property: "og:description", content: "Run real AI website audits and review your AuditNest report history." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [url, setUrl] = useState("");

  const listFn = useServerFn(listAudits);
  const runFn = useServerFn(runAudit);

  const { data: audits, isLoading } = useQuery({
    queryKey: ["audits"],
    queryFn: () => listFn(),
  });

  // Realtime: any insert/update on the user's audits refreshes the live view.
  useEffect(() => {
    const channel = supabase
      .channel("audits-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "audits" }, () => {
        qc.invalidateQueries({ queryKey: ["audits"] });
      })
      .subscribe();
    // Polling fallback while something is running, in case realtime is unavailable.
    const t = setInterval(() => {
      const list = qc.getQueryData<any[]>(["audits"]);
      if (list?.some((a) => a.status === "pending")) qc.invalidateQueries({ queryKey: ["audits"] });
    }, 4000);
    return () => {
      clearInterval(t);
      supabase.removeChannel(channel);
    };
  }, [qc]);

  const live = (audits ?? []).filter(
    (a) => a.status === "pending" && Date.now() - new Date(a.created_at).getTime() < 3 * 60_000,
  );
  const recentFinished = (audits ?? [])
    .filter((a) => a.status !== "pending" && Date.now() - new Date(a.created_at).getTime() < 10 * 60_000)
    .slice(0, 3);

  const mutation = useMutation({
    mutationFn: (u: string) => runFn({ data: { url: u } }),
    onSuccess: (res) => {
      toast.success("Audit ready");
      qc.invalidateQueries({ queryKey: ["audits"] });
      navigate({ to: "/audit/$id", params: { id: res.id } });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Audit failed"),
  });

  const handleSignOut = async () => {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b bg-background">
        <div className="max-w-6xl mx-auto flex items-center justify-between px-4 h-16">
          <Link to="/" className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-primary text-primary-foreground grid place-items-center">
              <Sparkles className="h-4 w-4" />
            </div>
            <span className="font-display font-semibold text-lg">AuditNest</span>
          </Link>
          <Button variant="ghost" size="sm" onClick={handleSignOut}>
            <LogOut className="h-4 w-4 mr-1" /> Sign out
          </Button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-10">
        <Card className="p-8 mb-10 gradient-hero">
          <h1 className="text-3xl font-semibold mb-2">Run a new audit</h1>
          <p className="text-muted-foreground mb-6">
            Paste any public URL. AuditNest crawls the page, runs Lighthouse, and generates an AI report — usually in under a minute.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!url.trim() || mutation.isPending) return;
              mutation.mutate(url.trim());
            }}
            className="flex flex-col sm:flex-row gap-3"
          >
            <Input
              type="text"
              inputMode="url"
              placeholder="https://example.com"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={mutation.isPending}
              className="text-base"
            />
            <Button type="submit" size="lg" disabled={mutation.isPending || !url.trim()} className="gap-2">
              {mutation.isPending ? <><Loader2 className="h-4 w-4 animate-spin" /> Auditing…</> : <><Plus className="h-4 w-4" /> Run audit</>}
            </Button>
          </form>
          {mutation.isPending && live.length === 0 && <AuditProgress />}

        </Card>

        {(live.length > 0 || recentFinished.length > 0) && (
          <section className="mb-10">
            <div className="mb-4 flex items-center gap-2">
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/60" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-primary" />
              </span>
              <h2 className="text-xl font-semibold">Live audits</h2>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {[...live, ...recentFinished].map((a) => (
                <LiveAuditCard key={a.id} audit={a} />
              ))}
            </div>
          </section>
        )}

        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="text-xl font-semibold">Recent audits</h2>
          {audits && <span className="text-sm text-muted-foreground">{audits.length} total</span>}
        </div>

        {isLoading ? (
          <div className="py-16 grid place-items-center text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : !audits || audits.length === 0 ? (
          <Card className="p-12 text-center text-muted-foreground">
            No audits yet. Run your first one above.
          </Card>
        ) : (
          <div className="grid gap-3">
            {audits.map((a) => (
              <Link key={a.id} to="/audit/$id" params={{ id: a.id }}>
                <Card className="p-4 flex items-center justify-between hover:border-primary/60 transition-colors">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium truncate max-w-[50vw]">{a.url}</span>
                      <StatusBadge status={a.status} />
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(a.created_at).toLocaleString()}
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    {typeof a.overallScore === "number" && <ScorePill value={a.overallScore} />}
                    <ExternalLink className="h-4 w-4 text-muted-foreground" />
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

const STEPS = [
  { label: "Validating URL", at: 0 },
  { label: "Fetching website", at: 1 },
  { label: "Checking SEO", at: 6 },
  { label: "Checking performance", at: 10 },
  { label: "Checking accessibility", at: 16 },
  { label: "Analyzing results", at: 24 },
  { label: "Generating report", at: 32 },
];


function AuditProgress() {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const activeIndex = STEPS.reduce((acc, s, i) => (elapsed >= s.at ? i : acc), 0);

  return (
    <div className="mt-5 space-y-2">
      {STEPS.map((s, i) => (
        <div key={s.label} className="flex items-center gap-2 text-sm">
          {i < activeIndex ? (
            <Check className="h-4 w-4 text-success" />
          ) : i === activeIndex ? (
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
          ) : (
            <div className="h-4 w-4 rounded-full border border-muted-foreground/40" />
          )}
          <span className={i <= activeIndex ? "" : "text-muted-foreground"}>{s.label}</span>
        </div>
      ))}
      <p className="pt-1 text-xs text-muted-foreground">
        Elapsed {elapsed}s — most audits finish in under a minute. If a check fails or times out, you still get a report from the data we did collect.
      </p>
    </div>
  );
}


const LIVE_STAGES = [
  { key: "validating", label: "Validating URL" },
  { key: "collecting", label: "Fetching website & PageSpeed" },
  { key: "seo", label: "Checking SEO & accessibility" },
  { key: "performance", label: "Checking performance" },
  { key: "report", label: "Generating report" },
  { key: "complete", label: "Complete" },
];

type LiveAudit = {
  id: string;
  url: string;
  status: string;
  created_at: string;
  stage: string | null;
  error: string | null;
  overallScore: number | null;
  events: { at: number; stage: string; level: "info" | "warn" | "error"; message: string }[];
};

function LiveAuditCard({ audit }: { audit: LiveAudit }) {
  const [now, setNow] = useState(() => Date.now());
  const running = audit.status === "pending";
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);
  const elapsed = Math.max(0, Math.round((now - new Date(audit.created_at).getTime()) / 1000));
  const seen = new Set(audit.events.map((e) => e.stage));
  const errored = new Set(audit.events.filter((e) => e.level !== "info").map((e) => e.stage));

  return (
    <Card className="p-4 min-w-0">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <div className="font-medium break-words">{audit.url}</div>
          <div className="text-xs text-muted-foreground">
            {running ? `Running · ${elapsed}s` : `Finished · ${new Date(audit.created_at).toLocaleTimeString()}`}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {typeof audit.overallScore === "number" && <ScorePill value={audit.overallScore} />}
          <StatusBadge status={audit.status} />
        </div>
      </div>

      <ol className="space-y-1.5 mb-3">
        {LIVE_STAGES.map((s) => {
          const done = seen.has(s.key) || audit.status === "complete";
          const isCurrent = running && audit.stage === s.key;
          const warn = errored.has(s.key);
          return (
            <li key={s.key} className="flex items-center gap-2 text-sm">
              {isCurrent ? (
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
              ) : warn ? (
                <AlertTriangle className="h-4 w-4 text-warning-foreground" />
              ) : done ? (
                <Check className="h-4 w-4 text-success" />
              ) : (
                <div className="h-4 w-4 rounded-full border border-muted-foreground/40" />
              )}
              <span className={done || isCurrent ? "" : "text-muted-foreground"}>{s.label}</span>
            </li>
          );
        })}
      </ol>

      {audit.events.length > 0 && (
        <div className="rounded-md bg-muted/60 p-2 max-h-40 overflow-y-auto space-y-1 font-mono text-[11px]">
          {audit.events.map((e, i) => (
            <div
              key={i}
              className={`break-words ${
                e.level === "error" ? "text-destructive" : e.level === "warn" ? "text-warning-foreground" : "text-muted-foreground"
              }`}
            >
              <span className="opacity-60">{(e.at / 1000).toFixed(1)}s</span> {e.message}
            </div>
          ))}
        </div>
      )}

      {audit.status === "failed" && audit.error && (
        <p className="mt-2 text-sm text-destructive break-words">{audit.error}</p>
      )}
      {audit.status === "complete" && (
        <Link to="/audit/$id" params={{ id: audit.id }} className="mt-3 inline-flex text-sm font-medium text-primary">
          View full report →
        </Link>
      )}
    </Card>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    complete: { label: "Complete", className: "bg-success/15 text-success" },
    pending: { label: "Pending", className: "bg-warning/15 text-warning-foreground" },
    failed: { label: "Failed", className: "bg-destructive/15 text-destructive" },
  };
  const m = map[status] ?? { label: status, className: "" };
  return <Badge variant="secondary" className={m.className}>{m.label}</Badge>;
}

function ScorePill({ value }: { value: number }) {
  const color =
    value >= 80 ? "text-success" : value >= 50 ? "text-warning-foreground" : "text-destructive";
  return (
    <div className="text-right">
      <div className={`text-2xl font-semibold font-display ${color}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">score</div>
    </div>
  );
}
