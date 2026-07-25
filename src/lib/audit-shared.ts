export interface Extracted {
  finalUrl: string;
  statusCode: number;
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
  structuredData: unknown[];
  hasViewport: boolean;
  hasRobots: boolean;
  hasSitemap: boolean;
  securityHeaders: Record<string, string | null>;
  sslValid: boolean;
  textSample: string;
  wordCount: number;
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
  headline?: string;
  cta?: string;
  hero?: string;
  pricing?: string;
  features?: string;
  testimonials?: string;
}

export interface AuditReport {
  overallScore: number;
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
