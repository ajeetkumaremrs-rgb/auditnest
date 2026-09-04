# ConvertIQ Insights

Build a production-ready AI SaaS called "ConvertIQ".



The goal is NOT to create a fake demo.



The application must actually analyze any public website URL and generate a real AI-powered website audit.



Core Workflow



1. User signs up using Google or Email.



2. User enters any website URL.



3. The backend must:

- Crawl the homepage.

- Extract HTML content.

- Read page title, meta title, meta description.

- Extract headings (H1-H6).

- Extract buttons and CTAs.

- Detect forms.

- Detect navigation.

- Detect images and alt text.

- Detect internal/external links.

- Detect favicon.

- Detect structured data if available.

- Take a screenshot of the website.

- Analyze mobile responsiveness.

- Measure performance using Google Lighthouse/PageSpeed Insights API.

- Detect broken links.

- Detect missing SEO elements.

- Detect accessibility issues.

- Detect security headers.

- Detect SSL status.



4. Send all extracted data to OpenAI GPT.



GPT must generate a professional website audit.



The report should include:



## Overall Score (0-100)



### Homepage Clarity

Explain whether visitors immediately understand what the business does.



### Call-To-Action Analysis

- Missing CTA

- Weak CTA

- Multiple conflicting CTAs

- Suggested CTA



### Trust Analysis

Detect:

- Testimonials

- Reviews

- Customer logos

- Security badges

- Contact information

- Social proof



### User Experience

Detect:

- Visual hierarchy

- Too much text

- Poor spacing

- Confusing navigation

- Button visibility

- Readability



### Mobile Experience

Explain all mobile issues.



### SEO Audit

Analyze:

- Meta title

- Meta description

- Heading structure

- Keywords

- Image alt text

- Canonical tags

- Sitemap

- Robots.txt



### Accessibility

Analyze:

- Color contrast

- Missing labels

- Alt text

- Keyboard accessibility



### Performance

Use Lighthouse/PageSpeed Insights.



Show:

- Performance Score

- Accessibility Score

- SEO Score

- Best Practices Score



### Conversion Audit

AI should identify:

- Missing trust signals

- Weak hero section

- Weak headline

- Weak offer

- Weak CTA

- Poor pricing presentation

- Missing urgency

- Missing FAQs



### AI Recommendations



For every issue provide:



Problem



Why it matters



How to fix it



Expected business impact



Priority:

High / Medium / Low



### Competitor-Level Suggestions



AI should suggest:

- Better headline

- Better CTA

- Better hero section

- Better pricing copy

- Better feature section

- Better testimonials layout



### Export



Allow users to:

- Download PDF report

- Share report

- Save report history



Dashboard



Users can:

- View previous audits

- Re-run audits

- Compare reports over time



Subscription



Free

- 3 audits/month



Pro

- Unlimited audits

- PDF Export

- AI Recommendations

- Website Comparison

- Team Workspace



Admin Dashboard



Show:

- Users

- Reports

- Revenue

- Active subscriptions

- Audit history



Technology



Frontend:

Next.js

Tailwind CSS

React



Backend:

Node.js



Database:

Supabase



Authentication:

Google OAuth



AI:

OpenAI GPT



Website Crawling:

Playwright + Cheerio



Performance:

Google Lighthouse API + PageSpeed Insights API



PDF:

React PDF



Payments:

Stripe



Deployment:

Vercel



The application must perform real website crawling, real Lighthouse analysis, and real AI auditing. Never generate fake reports or placeholder data.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/a1106b83-6191-4124-83ed-e15e5079b6de).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
