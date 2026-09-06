import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import {
  crawlSite,
  runLighthouse,
  normalizeUrl,
  createBudget,
  remaining,
  InvalidUrlError,
} from "./audit-engine.server";
import { generateReport, dataOnlyReport } from "./audit-report.server";
import type { AuditReport, Extracted, LighthouseSummary } from "./audit-shared";

/** Hard ceiling for the collection phase; the report is generated from whatever finished. */
const COLLECTION_TIMEOUT_MS = 55000;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} exceeded its ${Math.round(ms / 1000)}s time budget`)), ms),
    ),
  ]);
}

export const runAudit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ url: z.string().min(3).max(2000) }).parse(data))
  .handler(async ({ data, context }) => {
    // Step 1 — validate the URL before anything else is started.
    let url: string;
    try {
      url = normalizeUrl(data.url);
    } catch (e) {
      const message =
        e instanceof InvalidUrlError ? e.message : `"${data.url}" is not a valid website URL.`;
      console.warn("[audit:step]", { url: data.url, step: "validating-url", error: message });
      throw new Error(message);
    }

    const { supabase, userId } = context;
    const budget = createBudget(url);
    const startedAt = Date.now();
    console.info("[audit] starting", { userId, url });

    const { data: inserted, error: insertErr } = await supabase
      .from("audits")
      .insert({ user_id: userId, url, status: "pending" })
      .select("id")
      .single();
    if (insertErr || !inserted) {
      console.error("[audit] database insert failed", insertErr);
      throw new Error(insertErr?.message ?? "Failed to create audit");
    }
    const auditId = inserted.id;

    try {
      // Steps 2-5 — crawl and PageSpeed run concurrently; each is independently
      // time-boxed so one slow or failing component never blocks the other.
      const [crawlResult, lighthouseResult] = await Promise.allSettled([
        withTimeout(crawlSite(url, budget), COLLECTION_TIMEOUT_MS, "Website fetch"),
        withTimeout(runLighthouse(url, budget), COLLECTION_TIMEOUT_MS, "PageSpeed check"),
      ]);

      if (crawlResult.status === "rejected") {
        // Without any page data there is nothing real to report on.
        throw crawlResult.reason instanceof Error
          ? crawlResult.reason
          : new Error(String(crawlResult.reason));
      }
      const extracted = crawlResult.value;

      const lighthouse: LighthouseSummary =
        lighthouseResult.status === "fulfilled"
          ? lighthouseResult.value
          : {
              performance: null,
              accessibility: null,
              bestPractices: null,
              seo: null,
              metrics: { fcp: null, lcp: null, cls: null, tbt: null, tti: null, si: null },
              screenshot: null,
              strategy: "mobile",
              fetchTime: null,
              error:
                lighthouseResult.reason instanceof Error
                  ? lighthouseResult.reason.message
                  : String(lighthouseResult.reason),
              attempts: 0,
              apiKeyUsed: false,
            };

      console.info("[audit] collection complete", {
        auditId,
        url,
        finalUrl: extracted.finalUrl,
        status: extracted.statusCode,
        blocked: extracted.blocked,
        renderMode: extracted.renderMode,
        performance: lighthouse.performance,
        lighthouseError: lighthouse.error,
        attempts: lighthouse.attempts,
        elapsedMs: Date.now() - startedAt,
      });

      // Step 6-7 — analysis + report, capped by whatever time is left.
      const aiBudget = Math.max(8000, remaining(budget) - 5000);
      let report: AuditReport;
      try {
        report = await generateReport(extracted, lighthouse, aiBudget);
      } catch (e) {
        console.error("[audit] report generation failed", {
          auditId,
          url,
          error: e instanceof Error ? e.message : String(e),
        });
        report = dataOnlyReport(
          extracted,
          lighthouse,
          "Some audit data could not be collected: the written AI analysis failed.",
        );
      }
      console.info("[audit] report complete", {
        auditId,
        url,
        score: report.overallScore,
        elapsedMs: Date.now() - startedAt,
      });

      const { error: updErr } = await supabase
        .from("audits")
        .update({
          status: "complete",
          extracted: extracted as any,
          lighthouse: lighthouse as any,
          report: report as any,
        })
        .eq("id", auditId);
      if (updErr) throw new Error(updErr.message);
      console.info("[audit] completed", { auditId, elapsedMs: Date.now() - startedAt });
      return { id: auditId };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error("[audit] failed", { auditId, url, message, elapsedMs: Date.now() - startedAt });
      await supabase.from("audits").update({ status: "failed", error: message }).eq("id", auditId);
      throw new Error(message);
    }
  });


export const listAudits = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("audits")
      .select("id,url,status,created_at,report")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return (data ?? []).map((row: any) => ({
      id: row.id as string,
      url: row.url as string,
      status: row.status as string,
      created_at: row.created_at as string,
      overallScore:
        row.report && typeof row.report === "object"
          ? ((row.report as any).overallScore ?? null)
          : null,
    }));
  });

export const getAudit = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("audits")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Audit not found");
    return row as {
      id: string;
      url: string;
      status: string;
      extracted: Extracted | null;
      lighthouse: LighthouseSummary | null;
      report: AuditReport | null;
      error: string | null;
      created_at: string;
    };
  });
