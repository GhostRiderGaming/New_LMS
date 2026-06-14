# Design System — AnimeEdu

Technical design specification covering visual language, component patterns, animation, and layout.

---

## 1. Design Philosophy

AnimeEdu uses a **dark anime aesthetic** — deep space backgrounds, glowing neon accents, glassmorphism panels, and cinematic typography. The UI must feel immersive and premium without being heavy. Every interaction should feel instantaneous or clearly in-progress.

Core principles:
- **Dark-first** — no light mode; designed exclusively for dark environments
- **Glow over shadow** — neon glow effects instead of box-shadows
- **Glass over solid** — frosted glass panels (`backdrop-filter: blur`) over opaque backgrounds
- **Motion is meaning** — animations communicate state, not just decoration

---

## 2. Color Palette

| Token | Hex | Usage |
|-------|-----|-------|
| `bg-base` | `#0a0a0f` | Page background |
| `bg-surface` | `#0f172a` | Card/panel backgrounds |
| `bg-elevated` | `#1e293b` | Hover states, input backgrounds |
| `accent-purple` | `#7c3aed` | Primary CTAs, nav active state |
| `accent-purple-light` | `#8b5cf6` | Simulation canvas accents, badges |
| `accent-cyan` | `#06b6d4` | Secondary actions, info, links |
| `accent-pink` | `#ec4899` | Bella UI, warnings, highlights |
| `text-primary` | `#ffffff` | Headings, labels |
| `text-secondary` | `#e2e8f0` | Body text |
| `text-muted` | `#94a3b8` | Captions, metadata |
| `border` | `#1e293b` | Panel borders |
| `selection` | `#4f46e5/30` | Text selection highlight |

CSS custom properties (in `globals.css`):
```css
:root {
  --color-bg: #0a0a0f;
  --color-surface: #0f172a;
  --color-elevated: #1e293b;
  --color-purple: #7c3aed;
  --color-purple-light: #8b5cf6;
  --color-cyan: #06b6d4;
  --color-pink: #ec4899;
}
```

---

## 3. Typography

| Element | Font | Size | Weight | Color |
|---------|------|------|--------|-------|
| Page title | Inter | 2xl–4xl | 700 | white |
| Section heading | Inter | xl | 600 | white |
| Body text | Inter | base (16px) | 400 | text-secondary |
| Caption / meta | Inter | sm (14px) | 400 | text-muted |
| Code | monospace | sm | 400 | cyan |
| Badge/tag | Inter | xs (12px) | 500 | depends on type |

Font loaded via `next/font/google`: `Inter({ subsets: ["latin"] })`. Applied to `<body>` in `layout.tsx`.

---

## 4. Spacing Scale (TailwindCSS defaults)

Standard Tailwind spacing. No custom scale. Key values:
- Page horizontal padding: `px-3 sm:px-6`
- Page vertical padding: `py-4 sm:py-6`
- Card padding: `p-4` or `p-6`
- Section gap: `gap-4` or `gap-6`
- Form element gap: `space-y-4`

---

## 5. Component Patterns

### Glass Panel
```css
/* Used for cards, modals, info boxes */
background: rgba(15, 23, 42, 0.8);
backdrop-filter: blur(12px);
-webkit-backdrop-filter: blur(12px);
border: 1px solid rgba(255, 255, 255, 0.1);
border-radius: 16px;
```

TailwindCSS equivalent: `bg-slate-900/80 backdrop-blur-md border border-white/10 rounded-2xl`

### Glow Button (Primary)
```css
background: linear-gradient(135deg, #7c3aed, #06b6d4);
box-shadow: 0 0 20px rgba(124, 58, 237, 0.4);
border-radius: 12px;
transition: all 0.2s ease;
```
On hover: `box-shadow: 0 0 30px rgba(124, 58, 237, 0.6); transform: translateY(-1px)`
On disabled: `opacity: 0.5; cursor: not-allowed`

### Input Field
```css
background: rgba(30, 41, 59, 0.6);
border: 1px solid rgba(255, 255, 255, 0.1);
border-radius: 12px;
color: white;
padding: 12px 16px;
```
On focus: `border-color: #7c3aed; box-shadow: 0 0 0 3px rgba(124, 58, 237, 0.2)`

### Type Badges
| Type | Color |
|------|-------|
| image | `bg-purple-500/20 text-purple-300 border-purple-500/30` |
| animation | `bg-pink-500/20 text-pink-300 border-pink-500/30` |
| simulation | `bg-cyan-500/20 text-cyan-300 border-cyan-500/30` |
| model3d | `bg-blue-500/20 text-blue-300 border-blue-500/30` |
| story | `bg-yellow-500/20 text-yellow-300 border-yellow-500/30` |

---

## 6. Animation Tokens

### CSS Keyframe Animations (defined in `globals.css`)

```css
/* Pulsing glow — used on Bella avatar, active elements */
@keyframes pulse-glow {
  0%, 100% { box-shadow: 0 0 15px rgba(124, 58, 237, 0.4); }
  50% { box-shadow: 0 0 30px rgba(124, 58, 237, 0.8), 0 0 60px rgba(6, 182, 212, 0.3); }
}

/* Float — used on Bella avatar idle */
@keyframes float {
  0%, 100% { transform: translateY(0px); }
  50% { transform: translateY(-10px); }
}

/* Shimmer — used on loading skeletons */
@keyframes shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
```

### Framer Motion Variants

**Page enter:**
```typescript
const pageVariants = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.4 } },
  exit: { opacity: 0, y: -20 }
}
```

**Card appear:**
```typescript
const cardVariants = {
  initial: { opacity: 0, scale: 0.95 },
  animate: { opacity: 1, scale: 1, transition: { duration: 0.3 } }
}
```

**Stagger children:**
```typescript
const containerVariants = {
  animate: { transition: { staggerChildren: 0.1 } }
}
```

---

## 7. Layout Structure

### Navigation (GameHUD)
- Fixed top bar, height 56px (`mt-14` on main content)
- Left: logo + brand name
- Center: navigation links (Scene Forge | Lab Engine | Holodeck | Chronicle | Gallery)
- Right: XP counter + level badge

### Page layout
```
<html class="dark">
  <body class="min-h-screen bg-black text-white">
    <div class="universe-bg" />     ← animated star field
    <GameHUD />                      ← fixed top nav
    <main class="relative min-h-[calc(100vh-56px)] mt-14 z-10 px-3 sm:px-6 py-4 sm:py-6">
      {children}
    </main>
    <BellaPresence />               ← floating bottom-right
  </body>
</html>
```

### Universe Background
```css
.universe-bg {
  position: fixed;
  inset: 0;
  z-index: 0;
  background: radial-gradient(ellipse at top, #1a0533 0%, #0a0a0f 60%);
  /* Animated star particles via CSS pseudo-elements or canvas */
}
```

---

## 8. Responsive Breakpoints (Tailwind defaults)

| Breakpoint | Min-width | Usage |
|-----------|----------|-------|
| (default) | 320px | Mobile — single column |
| `sm` | 640px | 2-column grids |
| `md` | 768px | Full nav labels visible |
| `lg` | 1024px | 3-column grids, side panels |
| `xl` | 1280px | Max content width |

Mobile-first: all base styles are for 320px+ viewport. Desktop styles are `sm:` / `md:` overrides.

---

## 9. Bella UI Design

### Floating Button (collapsed)
- Bottom-right: `fixed bottom-6 right-6 z-50`
- Circle: `w-16 h-16 rounded-full`
- Glow: `pulse-glow` animation
- Content: Live2D avatar mini-render or PNG fallback

### Chat Panel (expanded)
- Anchored above button: `fixed bottom-24 right-6 z-50`
- Width: `w-80 sm:w-96`
- Height: max `h-[500px]`
- Glass panel styling
- Scrollable message list + fixed input bar at bottom
- Input: text field + mic button + send button

### Message Bubbles
- User: right-aligned, `bg-purple-600/30 border-purple-500/30`
- Bella: left-aligned, `bg-cyan-900/30 border-cyan-500/30`
- Timestamps in muted text below each bubble

---

## 10. Loading States

### JobProgressBar
- Appears immediately on job submit
- Shows status text: "Queued...", "Generating your content...", "Complete!", "Failed"
- Progress bar: indeterminate animation while processing, fills to 100% on complete
- Color: purple → cyan gradient

### Skeleton Screens
- Applied while asset data is fetching (gallery, story scenes)
- `shimmer` animation on placeholder card shapes

### 3D Viewer Loading
- `<Suspense fallback={<LoadingSpinner />}>` wraps `useGLTF` hook
- Spinning purple ring overlay on canvas until GLB resolves

---

## 11. Accessibility

- All interactive elements have `aria-label` or visible text labels
- Focus rings: `focus:outline-none focus:ring-2 focus:ring-purple-500`
- Keyboard navigation supported: Tab through all inputs and buttons
- Color contrast ratio: text on bg-surface meets WCAG 2.1 AA (≥ 4.5:1)
- Reduced motion: `@media (prefers-reduced-motion: reduce)` disables float/pulse animations
- Simulation iframes have `title` attribute for screen readers
- Images have `alt` attributes (topic as alt text for generated images)
