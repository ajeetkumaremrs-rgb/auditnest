import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { crawlSite, runLighthouse, normalizeUrl } from "./audit-engine.server";
import { generateReport } from "./audit-report.server";
import type { AuditReport, Extracted, LighthouseSummary } from "./audit-shared";

export const runAudit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ url: z.string().min(3).max(2000) }).parse(data))
  .handler(async ({ data, context }) => {
    const url = normalizeUrl(data.url);
    const { supabase, userId } = context;
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
      console.info("[audit] crawling", { auditId, url });
      const extracted = await crawlSite(url);
      console.info("[audit] crawl complete", { auditId, finalUrl: extracted.finalUrl });
      const lighthouse = await runLighthouse(extracted.finalUrl);
      console.info("[audit] PageSpeed complete", {
        auditId,
        performance: lighthouse.performance,
        error: lighthouse.error,
      });
      const report = await generateReport(extracted, lighthouse);
      console.info("[audit] AI report complete", { auditId, score: report.overallScore });

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
      console.info("[audit] completed", { auditId });
      return { id: auditId };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error("[audit] failed", { auditId, message, error: e });
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
