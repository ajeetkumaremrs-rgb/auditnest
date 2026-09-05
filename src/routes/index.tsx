import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Sparkles, Gauge, Search, Target, Shield, Smartphone, ArrowRight } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "AuditNest – AI Website Audit Tool" },
      {
        name: "description",
        content:
          "Audit your website for SEO, performance, accessibility, UX and conversion issues with actionable recommendations.",
      },
      { property: "og:title", content: "AuditNest – AI Website Audit Tool" },
      {
        property: "og:description",
        content:
          "Get a detailed AI-powered audit of your website with clear issues, priorities and recommended fixes.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://auditnest.vercel.app/" },
      { property: "og:image", content: "https://auditnest.vercel.app/og-image.png" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "AuditNest – AI Website Audit Tool" },
      {
        name: "twitter:description",
        content:
          "Get a detailed AI-powered audit of your website with clear issues, priorities and recommended fixes.",
      },
      { name: "twitter:image", content: "https://auditnest.vercel.app/og-image.png" },
    ],
    links: [{ rel: "canonical", href: "https://auditnest.vercel.app/" }],
  }),
  component: Landing,
});

const features = [
  { icon: Gauge, title: "Real Lighthouse scores", desc: "Live performance, accessibility, SEO & best-practices via Google PageSpeed Insights." },
  { icon: Search, title: "Deep SEO audit", desc: "Titles, meta, headings, structured data, sitemap and robots — all checked." },
  { icon: Target, title: "Conversion analysis", desc: "AI flags weak CTAs, hero, trust signals and suggests concrete rewrites." },
  { icon: Smartphone, title: "Mobile experience", desc: "Mobile-first crawl and responsiveness issues surfaced." },
  { icon: Shield, title: "Security & trust", desc: "HTTPS, security headers and trust signals detected on the page." },
  { icon: Sparkles, title: "Prioritised fixes", desc: "Every issue with problem, why it matters, how to fix, expected impact." },
];

function Landing() {
  return (
    <div className="min-h-screen">
      <header className="border-b bg-background/70 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto flex items-center justify-between px-4 h-16">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-primary text-primary-foreground grid place-items-center">
              <Sparkles className="h-4 w-4" />
            </div>
            <span className="font-display font-semibold text-lg">AuditNest</span>
          </div>
          <div className="flex items-center gap-2">
            <Link to="/auth"><Button variant="ghost">Sign in</Button></Link>
            <Link to="/auth"><Button>Get started</Button></Link>
          </div>
        </div>
      </header>

      <section className="gradient-hero">
        <div className="max-w-4xl mx-auto px-4 py-24 text-center">
          <div className="inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1 text-xs font-medium mb-6">
            <Sparkles className="h-3 w-3 text-primary" /> AI-powered website audits
          </div>
          <h1 className="text-5xl md:text-6xl font-semibold tracking-tight mb-6">
            Audit any website.<br />
            <span className="text-primary">Fix what's costing you conversions.</span>
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto mb-8">
            Paste a URL. AuditNest crawls the page, runs a real Lighthouse test, and returns a prioritised AI report with concrete rewrites for your hero, CTA, SEO and UX.
          </p>
          <div className="flex justify-center gap-3">
            <Link to="/auth">
              <Button size="lg" className="gap-2">Run your first audit <ArrowRight className="h-4 w-4" /></Button>
            </Link>
          </div>
          <p className="mt-4 text-xs text-muted-foreground">Free to start · No credit card</p>
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-4 py-20">
        <div className="grid md:grid-cols-3 gap-6">
          {features.map((f) => (
            <div key={f.title} className="rounded-xl border bg-card p-6">
              <div className="h-10 w-10 rounded-lg bg-accent text-accent-foreground grid place-items-center mb-4">
                <f.icon className="h-5 w-5" />
              </div>
              <h3 className="font-semibold mb-1">{f.title}</h3>
              <p className="text-sm text-muted-foreground">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-t bg-muted/40">
        <div className="max-w-4xl mx-auto px-4 py-20 text-center">
          <h2 className="text-3xl md:text-4xl font-semibold mb-4">Real audits. Not templates.</h2>
          <p className="text-muted-foreground mb-8">Every AuditNest report is generated from a live crawl of your page and a real Google Lighthouse run — never boilerplate.</p>
          <Link to="/auth"><Button size="lg">Start free</Button></Link>
        </div>
      </section>

      <footer className="border-t py-8 text-center text-sm text-muted-foreground">
        © {new Date().getFullYear()} AuditNest
      </footer>
    </div>
  );
}
