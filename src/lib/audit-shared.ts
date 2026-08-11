export interface HtmlEstimate {
  seo: number | null;
  accessibility: number | null;
  bestPractices: number | null;
}

export interface Extracted {
  finalUrl: string;
  statusCode: number;
  /** True when the origin served an anti-bot / challenge page instead of real content. */
  blocked: boolean;
  blockReason: string | null;
  /** True when useful metadata was captured but the page body requires client-side JavaScript. */
  partial: boolean;
  captureWarning: string | null;
  /** "static" = plain fetch, "rendered" = fetched through a JS-rendering proxy. */
  renderMode: "static" | "rendered";
  title: string | null;
  metaDescription: string | null;
  canonical: string | null;
  favicon: string | null;
  language: string | null;
  headings: { tag: string; text: string }[];
  h1Count: number;
  buttons: string[];
  ctas: string[];
  forms: { action: string | null; inputs: number }[];
  navLinks: string[];
  images: { total: number; missingAlt: number; samples: { src: string; alt: string | null }[] };
  links: { internal: number; external: number; samples: string[] };
  structuredData: any[];
  openGraph: Record<string, string>;
  twitter: Record<string, string>;
  hasViewport: boolean;
  hasRobots: boolean;
  hasSitemap: boolean;
  securityHeaders: Record<string, string | null>;
  sslValid: boolean;
  textSample: string;
  wordCount: number;
  /** Deterministic scores derived from the HTML only. Null when the page was blocked. */
  htmlEstimate: HtmlEstimate;
}

export interface LighthouseSummary {
  performance: number | null;
  accessibility: number | null;
  bestPractices: number | null;
  seo: number | null;
  metrics: {
    fcp: string | null;
    lcp: string | null;
    cls: string | null;
    tbt: string | null;
    tti: string | null;
    si: string | null;
  };
  screenshot: string | null;
  strategy: "mobile" | "desktop";
  fetchTime: string | null;
  error?: string;
  /** Number of retries performed before giving up / succeeding. */
  attempts?: number;
  /** True when served from the 10-minute cache. */
  cached?: boolean;
  /** True when a PageSpeed API key was used (higher quota), false for keyless mode. */
  apiKeyUsed?: boolean;
}

export type Priority = "high" | "medium" | "low";

export interface Recommendation {
  problem: string;
  why: string;
  fix: string;
  impact: string;
  priority: Priority;
}

export interface Suggestions {
  headline?: string | null;
  cta?: string | null;
  hero?: string | null;
  pricing?: string | null;
  features?: string | null;
  testimonials?: string | null;
}

export interface AuditReport {
  /** Null when there was not enough real data to score the page. Never a guessed number. */
  overallScore: number | null;
  /** Explains exactly which data the score was computed from. */
  scoreBasis: string;
  /** User-facing warnings, e.g. crawler blocked or PageSpeed rate limited. */
  warnings: string[];
  summary: string;
  homepageClarity: string;
  ctaAnalysis: {
    findings: string[];
    suggestedCta: string;
  };
  trust: {
    detected: string[];
    missing: string[];
    notes: string;
  };
  ux: string[];
  mobile: string[];
  seo: {
    metaTitle: string;
    metaDescription: string;
    headings: string;
    imageAlt: string;
    other: string[];
  };
  accessibility: string[];
  performance: {
    performanceScore: number | null;
    accessibilityScore: number | null;
    seoScore: number | null;
    bestPracticesScore: number | null;
    notes: string;
  };
  conversion: string[];
  recommendations: Recommendation[];
  suggestions: Suggestions;
}
