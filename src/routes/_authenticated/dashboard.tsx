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
import { Sparkles, Loader2, ExternalLink, LogOut, Plus } from "lucide-react";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — ConvertIQ" },
      { name: "description", content: "Run new website audits and review your history." },
      { property: "og:title", content: "Dashboard — ConvertIQ" },
      { property: "og:description", content: "Run real AI website audits and review your ConvertIQ report history." },
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
            <span className="font-display font-semibold text-lg">ConvertIQ</span>
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
            Paste any public URL. ConvertIQ crawls the page, runs Lighthouse, and generates an AI report — usually in under a minute.
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
          {mutation.isPending && <AuditProgress />}

        </Card>

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
  { label: "Fetching page…", at: 0 },
  { label: "Rendering page (if JS-protected)…", at: 8 },
  { label: "Running Lighthouse (auto-retries on rate limits)…", at: 16 },
  { label: "Generating AI report…", at: 45 },
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
        Elapsed {elapsed}s — PageSpeed retries automatically (2s, 5s, 10s) if Google rate-limits us.
      </p>
    </div>
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
