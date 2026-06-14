# UX Specification — AnimeEdu

Interaction design, feedback patterns, micro-interactions, and usability guidelines.

---

## 1. Core UX Principles

1. **Immediate feedback** — Every user action produces a visible response within 100ms (button state change, spinner, toast), even if the actual work takes longer.
2. **Progressive disclosure** — Show only what's needed for the current step. Advanced options are accessible but not in the way.
3. **Fail gracefully** — Every error state shows a specific, actionable message. Never show raw exception text to users.
4. **Non-blocking generation** — Users can navigate to other features while a generation job runs. The job system is async.
5. **Persistent Bella** — The AI assistant is always available without interrupting the user's workflow. She is non-modal and non-intrusive by default.

---

## 2. Input Patterns

### Topic Input
- **Placeholder:** "Enter a topic, e.g. 'Photosynthesis', 'Newton's Laws'..."
- **Max length:** 500 characters (counter shown at 400+ chars)
- **Validation:** Client-side check before API call — empty input shows inline error, not toast
- **Auto-focus:** Topic input auto-focuses on page load
- **Enter key:** Submits the form when input is focused

### Style/Category Dropdown
- Visual icons alongside text options (📚 Classroom, 🔬 Laboratory, 🌿 Outdoor, ✨ Fantasy)
- Default: first option pre-selected
- No multi-select — single choice only

### Episode Count (Story)
- Segmented button control (not dropdown): 1 | 2 | 3 | 4 | 5 | 6
- Tooltip on hover: "More episodes = longer generation time"

### Generate Button
- Label changes based on state:
  - Idle: "Generate"
  - Loading: "Generating..." (with spinner)
  - Complete: "Generate Again"
- Disabled during active generation
- Keyboard shortcut: Cmd/Ctrl+Enter when any input in the form is focused

---

## 3. Job Progress UX

### JobProgressBar behaviour
```
Submit → Button disabled + "Generating..." label
       → JobProgressBar appears below form
       │
       ├─ Status: "queued" → bar pulses, "Queued — waiting for worker..."
       ├─ Status: "processing" → bar animates, "Generating your content..."
       ├─ Status: "complete" → bar fills green, brief success animation, result renders
       └─ Status: "failed" → bar fills red, error message shows, "Try again" button
```

### WebSocket vs Polling
- Frontend first attempts WebSocket connection to `ws://…/jobs/{job_id}/ws`
- If WebSocket unavailable (e.g. deployment platform doesn't support it): falls back to 2-second polling
- Polling stops automatically on complete/failed status

### Long-running jobs
- After 10 seconds with no status change: "Still working — this may take a moment..."
- After 30 seconds: "Complex generation in progress — you can navigate away and come back"
- Navigation away from page: job continues; user can check status in Gallery

---

## 4. Toast Notifications

Used for brief, non-blocking status messages. Auto-dismiss after 4s.

| Trigger | Toast type | Message |
|---------|-----------|---------|
| Safety violation (422) | Error | "That topic isn't allowed on this platform" |
| Rate limit (429) | Warning | "Slow down — try again in a moment" |
| Network error | Error | "Can't reach the server — check your connection" |
| Job failed | Error | [job.error_message humanised] |
| XP awarded | Success | "+10 XP — Scene created!" |
| Asset deleted | Info | "Asset deleted" |
| Copy to clipboard | Success | "Copied!" |
| Export ZIP started | Info | "Preparing your export..." |

Toast position: top-right. Maximum 3 toasts visible simultaneously (FIFO queue).

---

## 5. Empty States

Each page has a designed empty state shown before first generation:

### Scene Forge (empty)
- Large anime-style illustration (static, not generated)
- Heading: "Turn any topic into anime art"
- Subtext: "Enter a topic above to generate your first scene"
- Sample topics as clickable chips: "Photosynthesis", "The Water Cycle", "Newton's Laws"

### Lab Engine (empty)
- Code/circuit illustration
- Heading: "Build interactive simulations"
- Sample topics: "Pendulum Physics", "DNA Replication", "Pythagorean Theorem"

### Holodeck (empty)
- 3D wireframe cube illustration
- Heading: "Generate 3D educational models"
- Sample objects: "DNA helix", "Solar system", "Animal cell"

### Chronicle (empty)
- Storybook illustration
- Heading: "Create your anime learning series"
- Sample topics: "The French Revolution", "Evolution and Natural Selection"

### Gallery (empty)
- Empty shelf illustration
- Heading: "No assets yet"
- CTA button: "Go generate something!"

---

## 6. Result Card UX

### AnimeSceneCard
- Image fills card (16:9 or 2:3 depending on orientation)
- Caption bar at bottom (matches in-image overlay)
- Bottom row: style badge, topic text (truncated), download icon, XP badge
- Hover: slight scale-up (1.02), glow intensifies
- Click image: lightbox modal with full resolution

### SimulationFrame
- Iframe renders at 100% card width, 400px height default
- Resize handle to expand/collapse height
- "Open Fullscreen" button (top-right of frame)
- "Download HTML" button

### ModelViewer3D
- Canvas fills card, 400px height
- Orbit controls enabled by default
- Auto-rotate toggleable via icon button
- Download GLB button (bottom-right)
- Loading state: grey shimmer → Three.js canvas

### StoryPlayer
- Episode tabs / sidebar list
- Active scene highlighted
- Scene image (left) + description/caption (right) on desktop
- Stacked (image top, text bottom) on mobile
- Prev/Next scene navigation buttons

---

## 7. Bella UX Details

### Avatar states and transitions
| State | Visual | Duration |
|-------|--------|----------|
| Idle | Float animation, occasional blink | Continuous |
| Listening | Waveform pulse, pink glow | During recording |
| Thinking | Head tilt, spinner overlay | 0–3s |
| Speaking | Lip sync animation to TTS audio | Audio duration |
| Happy | Bouncy animation | 1.5s then idle |
| Error | Slight shake | 0.5s then idle |

### Chat panel keyboard UX
- `Escape` closes panel
- `Enter` sends message (not newline — Bella is conversational, not a doc editor)
- `Shift+Enter` adds newline (not used in practice given context)
- Panel traps focus when open (accessibility)

### Microphone flow
1. User clicks mic button → browser permission prompt (if first time)
2. Recording indicator: pulsing red dot + timer
3. Click again to stop OR auto-stop at 30s
4. Transcription spinner → transcript appears in text field
5. User can edit before sending or send immediately via Enter

### Onboarding message
On first session, Bella auto-opens (once) with:
> "Hi! I'm Bella 👋 I'm here to help you learn. Try asking me about any topic, or use the tools above to generate anime art, simulations, and more!"

Shown once per browser; dismissed on interaction or close button.

---

## 8. Mobile UX

### Navigation
- GameHUD collapses nav links into a hamburger menu on `< md`
- Bella panel: full-width drawer from bottom on mobile instead of right-side panel
- All touch targets: minimum 44×44px

### Generation pages
- Form and result stacked vertically
- Progress bar spans full width
- Result card fills screen width with horizontal scroll for wide content

### Gallery
- Single column on mobile, 2 columns on sm+, 3 columns on lg+
- Swipe gestures supported on image lightbox

---

## 9. Onboarding / Discoverability

- Module cards on home page (`/`) describe each feature with icon, title, description, and "Try it" CTA
- Sample topic chips pre-populate on each page's empty state — lower barrier to first generation
- Bella proactively introduces features on first visit
- "What can I learn here?" prompt in Bella's suggested messages

---

## 10. Performance UX

| Action | Target perceived time | Technique |
|--------|----------------------|-----------|
| Page load | < 2s | Next.js static generation, font preload |
| Job submission | < 300ms visible feedback | Button state change immediate |
| Image display | Instant after URL available | `next/image` with blur placeholder |
| Simulation iframe | < 500ms | Preload via hidden iframe |
| 3D viewer | < 1s to first render | Suspense fallback spinner |
| Bella reply text | < 3s | Stream reply text as it arrives (future) |
