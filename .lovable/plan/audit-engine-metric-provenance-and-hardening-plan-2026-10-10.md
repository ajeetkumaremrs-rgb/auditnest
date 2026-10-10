# Audit engine: metric provenance and hardening plan

## Where every number comes from today

| Metric | Source | Type |
|---|---|---|
| Performance | Google PageSpeed (Lighthouse, mobile) category score | Measured |
| Accessibility | Lighthouse; falls back to `htmlEstimate.accessibility` | Measured, or heuristic |
| SEO | Lighthouse; falls back to `htmlEstimate.seo` | Measured, or heuristic |
| Best Practices | Lighthouse; falls back to `htmlEstimate.bestPractices` | Measured, or heuristic |
| UX | `uxScore()`: penalties for H1, headings, word count, nav, viewport, buttons | Heuristic |
| CTA | `ctaScore()`: penalties for CTA count, forms, generic wording | Heuristic |
| Conversion | `conversionScore()`: penalties for CTAs, forms, JSON-LD, meta description, internal links, word count | Heuristic |
| Overall | Weighted average (22/18/18/12/10/10/10), re-weighted over available parts; null if blocked | Calculated |
| FCP, LCP, CLS, TBT, TTI, SI | Lighthouse `displayValue` strings | Measured |
| All written text (summary, findings, recommendations, suggestions) | Gemini via the AI gateway, given the extracted JSON | AI text, never a score |

The PDF and report page only display stored values. They recompute nothing.

## Problems found

1. **Hidden heuristic fallback.** `report.performance.{accessibility,seo,bestPractices}Score` silently use HTML estimates when Lighthouse fails, while the section is labelled "Measured by Google Lighthouse" (`audit-report.server.ts` lines 217-219 and 350-352, plus the report page and PDF).
2. **Wrong `dataCoverage.lighthouse`.** It is hardcoded to `"complete"` at crawl time and never corrected (`audit-engine.server.ts`, around line 690).
3. **Markdown render skews the heuristics.** The `r.jina.ai` markdown mode produces no `<button>`, `<form>` or `<img>` tags, so UX, CTA and Conversion scores drop unfairly when that capture wins.
4. **Partial pages use a reduced heuristic.** SEO and accessibility estimates skip several checks but are not labelled as reduced.
5. **Mobile only.** The `desktop` strategy exists in the types but is never run.
6. **Per-process cache.** The PageSpeed cache lives only in one server instance's memory, so it is not shared between instances.
7. **Duplicated code.** The private-IP check in `normalizeUrl` appears twice.
8. **Blocked sites.** A blocked crawl assumes PageSpeed still saw the real page, which is never checked.

## Implementation plan

### `src/lib/audit-shared.ts`
- Add a `source: "lighthouse" | "html-estimate" | null` field per score in `AuditReport.performance`.
- Add `captureMode: "static" | "rendered-html" | "rendered-markdown"` to `Extracted`.

### `src/lib/audit-engine.server.ts`
- `renderOnce` / `fetchRendered`: return which mode won. Prefer HTML over markdown unless the HTML text is much shorter.
- `uxScore`, `ctaScore`, `conversionScore`: when `captureMode === "rendered-markdown"`, return null for the structural checks (buttons, forms, images) so they are marked "Unavailable" instead of penalised.
- `estimateFromHtml`: return a `reduced: true` flag for partial pages. `computeOverallScore` then records "HTML estimate (reduced)" in the breakdown source.
- Remove the duplicated private-IP block in `normalizeUrl`.
- `runLighthouse`: optionally run a `desktop` strategy in parallel when time allows, stored as `lighthouseDesktop`. This is optional and needs your approval.

### `src/lib/audit-report.server.ts`
- `generateReport`, `dataOnlyReport`, `blockedReport`: fill in the new per-score `source` field. Set `dataCoverage.lighthouse` from the actual Lighthouse result.
- Blocked sites: add a note when Lighthouse's final URL or screenshot suggests it was also challenged.

### `src/lib/audit-view.ts`
- Add a `scoreSourceLabel()` helper ("Lighthouse" or "HTML estimate") used by both the report page and the PDF.

### `src/routes/_authenticated/audit.$id.tsx` and `src/lib/audit-pdf.ts`
- Show a small source tag under each Accessibility, SEO and Best Practices score. Change the heading to "Lighthouse / HTML estimate" when mixed.
- Show the capture mode and a "reduced heuristic" note in the provenance section.

### `src/lib/audit.functions.ts`
- No logic change beyond passing the corrected coverage through.

## Out of scope unless you ask
- Moving the PageSpeed cache into the database (shared between instances).
- Changing the score weights.

## Verification
- Re-run vercel.com, openai.com and youtube.com. Confirm the scores are unchanged when Lighthouse succeeds, and that the source tags and "Unavailable" states are correct when it fails.
- Generate a PDF and check that the labels match the web report.
