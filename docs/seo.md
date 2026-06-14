# SEO Strategy — AnimeEdu

Search engine optimisation approach for the AnimeEdu platform. Covers metadata, page structure, content, and technical SEO.

---

## 1. SEO Context

AnimeEdu is an interactive web application (not a content site). Most pages are generated dynamically based on user input. This presents specific SEO challenges and opportunities:

**Challenges:**
- Generated content (images, simulations, 3D models) is user-specific and ephemeral
- Most pages are behind a tool interface (not crawlable rich content)
- No user accounts = no shareable profile or history pages

**Opportunities:**
- Tool pages (Scene Forge, Lab Engine, etc.) target high-value "interactive learning" keywords
- The home page and landing sections can be fully SSG (Static Site Generation)
- Bella, 3D models, and simulations are highly differentiating — unique content for tech-forward keywords

---

## 2. Page-Level Metadata

### Root layout (`app/layout.tsx`)
```typescript
export const metadata: Metadata = {
  title: "AnimeEdu — Your Learning Universe",
  description: "Learn anything through anime, simulations, and 3D models. AI-powered interactive education.",
  icons: { icon: "/favicon.svg" },
  // Add these:
  openGraph: {
    title: "AnimeEdu — Your Learning Universe",
    description: "Transform any topic into anime art, interactive simulations, and 3D models.",
    type: "website",
    url: "https://animeedu.app",
    images: [{ url: "/og-image.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "AnimeEdu — Your Learning Universe",
    description: "Transform any topic into anime art, interactive simulations, and 3D models.",
    images: ["/og-image.png"],
  },
}
```

### Per-page metadata targets

| Page | Title tag | Meta description | Primary keyword |
|------|----------|-----------------|-----------------|
| `/` | AnimeEdu — AI Learning Platform | Turn any topic into anime art, simulations & 3D models | ai educational platform |
| `/anime` | Scene Forge — Anime Learning Art Generator | Generate anime-style educational illustrations for any topic | anime education generator |
| `/simulation` | Lab Engine — Interactive Science Simulations | Create interactive HTML5 simulations for physics, chemistry, biology | interactive science simulations |
| `/model3d` | Holodeck — 3D Educational Model Generator | Generate 3D models of any educational object, viewable in browser | 3d educational models |
| `/story` | Chronicle — Anime Learning Series Creator | Transform any topic into a multi-episode anime story | educational anime series |
| `/gallery` | My Learning Gallery — AnimeEdu | Browse and download all your generated learning assets | learning asset gallery |

### Per-page metadata implementation
```typescript
// app/anime/page.tsx:
export const metadata: Metadata = {
  title: "Scene Forge — Anime Learning Art Generator | AnimeEdu",
  description: "Generate anime-style educational illustrations for any topic instantly. Powered by AI.",
}
```

---

## 3. Technical SEO

### Sitemap
Create `app/sitemap.ts`:
```typescript
import { MetadataRoute } from 'next'

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: 'https://animeedu.app', lastModified: new Date(), priority: 1.0 },
    { url: 'https://animeedu.app/anime', lastModified: new Date(), priority: 0.9 },
    { url: 'https://animeedu.app/simulation', lastModified: new Date(), priority: 0.9 },
    { url: 'https://animeedu.app/model3d', lastModified: new Date(), priority: 0.8 },
    { url: 'https://animeedu.app/story', lastModified: new Date(), priority: 0.8 },
    { url: 'https://animeedu.app/gallery', lastModified: new Date(), priority: 0.5 },
  ]
}
```

### Robots.txt
Create `app/robots.ts`:
```typescript
import { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/api/'],
    },
    sitemap: 'https://animeedu.app/sitemap.xml',
  }
}
```

### Canonical URLs
Add to each page's metadata:
```typescript
alternates: {
  canonical: 'https://animeedu.app/anime',
}
```

---

## 4. Structured Data (JSON-LD)

### Home page — SoftwareApplication schema
```typescript
// In app/page.tsx <head>:
const jsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "name": "AnimeEdu",
  "description": "AI-powered educational platform that generates anime art, simulations, and 3D models",
  "applicationCategory": "EducationalApplication",
  "operatingSystem": "Web",
  "offers": {
    "@type": "Offer",
    "price": "0",
    "priceCurrency": "USD"
  },
  "featureList": [
    "Anime-style educational image generation",
    "Interactive HTML5 science simulations",
    "3D educational model generation",
    "Multi-episode anime story creation",
    "AI learning assistant"
  ]
}
```

### Tool pages — WebApplication schema
Each generation page should declare itself as a specific WebApplication:
```typescript
{
  "@type": "WebApplication",
  "name": "Scene Forge — Anime Art Generator",
  "url": "https://animeedu.app/anime",
  "description": "Generate anime-style educational illustrations for any learning topic",
  "applicationCategory": "EducationalApplication"
}
```

---

## 5. Content SEO Strategy

### Home page content sections (landing)
The home page should contain real, crawlable content (not just the tool UI):

1. **Hero section** — H1: "Turn Any Topic Into Anime Art, Simulations & 3D Models"
2. **How it works** — 3-step explanation with icons
3. **Feature showcase** — Screenshot/demo of each tool (Scene Forge, Lab Engine, Holodeck, Chronicle)
4. **Bella intro** — "Your AI learning companion, Bella"
5. **Sample topics** — Pre-generated examples for popular subjects (SEO-friendly content)
6. **FAQ section** — Answers common questions about AI education tools (targets long-tail)

### Sample generated content pages (future)
For SEO, consider creating publicly-shareable asset pages:
- `/share/{asset_id}` — publicly viewable generated asset
- Each page has structured metadata, topic as title, generated image as OG image
- Indexed by search engines for topic-based queries

---

## 6. Performance SEO (Core Web Vitals)

### LCP (Largest Contentful Paint) — target < 2.5s
- Hero image optimised: `next/image` with `priority` flag
- Fonts loaded via `next/font` (no FOUT)
- No render-blocking scripts (Live2D loaded `beforeInteractive` but is small)

### FID/INP (Interaction to Next Paint) — target < 200ms
- All heavy computations (Three.js, Live2D) deferred to idle via `requestIdleCallback`
- React hydration split via `dynamic()` imports for heavy 3D components

### CLS (Cumulative Layout Shift) — target < 0.1
- Reserve space for dynamic content (fixed aspect ratio containers for generated images)
- Skeleton screens for loading states (no layout jumps)
- Fonts declared with `size-adjust` or pre-loaded to prevent FOUT

### Implementation
```typescript
// Lazy-load heavy 3D/Live2D components:
const ModelViewer3D = dynamic(() => import('@/components/model3d/ModelViewer3D'), {
  ssr: false,
  loading: () => <LoadingSpinner />
})

const BellaPresence = dynamic(() => import('@/components/bella/BellaPresence'), {
  ssr: false
})
```

---

## 7. Social Sharing

### OG Image
Create a static `public/og-image.png` (1200×630) showing:
- AnimeEdu logo
- Dark anime theme
- Sample generated anime art
- Tagline

### Dynamic OG images (future)
For shareable asset pages (`/share/{id}`), generate dynamic OG images using Next.js `ImageResponse`:
```typescript
// app/share/[id]/opengraph-image.tsx:
import { ImageResponse } from 'next/og'
export const runtime = 'edge'

export default async function OGImage({ params }) {
  const asset = await getAsset(params.id)
  return new ImageResponse(
    <div style={{ background: '#0a0a0f', display: 'flex' }}>
      <img src={asset.presigned_url} />
      <h1 style={{ color: 'white' }}>{asset.topic}</h1>
    </div>
  )
}
```

---

## 8. Keyword Research Targets

### Primary keywords (high intent)
- "ai education anime generator"
- "interactive science simulations online"
- "educational 3d model generator"
- "ai learning assistant"

### Secondary keywords
- "anime style educational content"
- "HTML5 physics simulation generator"
- "interactive biology simulation"
- "AI teaching assistant for students"

### Long-tail keywords
- "generate anime art from topic"
- "free interactive photosynthesis simulation"
- "3D animal cell model browser"
- "educational anime story generator"

### Content for each keyword
- Long-tail keywords map to sample generated content pages
- Primary keywords target home page and tool pages
- "Bella" can own "AI learning assistant" keyword with dedicated landing section

---

## 9. Accessibility as SEO Signal

Google uses accessibility signals in ranking. Ensure:
- All images have descriptive `alt` text (topic as alt for generated images)
- Heading hierarchy is correct (one H1 per page)
- Navigation is keyboard-accessible
- Sufficient color contrast (WCAG 2.1 AA)
- No content hidden from assistive technology that's visible to users
