# Portfolio Resume Addendum - Context Document

**Last Updated: 2025-12-07**

---

## Project Overview

Creating a visually striking single-page portfolio addendum to supplement Darrell Robinson's resume, showcasing two flagship projects that demonstrate mastery of React state management (hooks) and REST API integration.

---

## Key Decisions Made

### 1. Single Page Format
**Decision**: One-page PDF addendum, not multi-page
**Rationale**:
- Recruiters have limited time
- Forces focus on highest-impact content
- Supplements existing 2-page resume
- Easy to attach to applications

### 2. Two-Project Focus
**Decision**: Feature only RailTime and Watch the RIGHT Hook
**Rationale**:
- These are the most technically impressive projects
- Together they demonstrate: real-time systems + educational content
- Shows breadth: production app + technical documentation
- Other projects (AI Podcast, LiveDocs, Bot Framework) remain on main resume

### 3. Web-First, Print-Optimized
**Decision**: Build as Next.js page that exports well to PDF
**Rationale**:
- Can share as link OR PDF
- Easy to update and iterate
- Leverages existing project infrastructure
- Browser print dialog provides free PDF export

### 4. Design Language
**Decision**: "Technical Elegance" - modern, clean, confident
**Rationale**:
- Matches quality of the projects themselves
- Differentiates from cookie-cutter resume templates
- Appeals to engineering-focused companies
- Professional without being boring

---

## Key Files & Locations

### Source Resume
```
C:\Users\User\Desktop\darrell_robinson_914_772_2116.pdf
```

### Live Project URLs
```
RailTime:              https://railtime-seven.vercel.app/map
Watch the RIGHT Hook:  https://watch-the-right-hook.vercel.app/
```

### Implementation Location
```
C:\Users\User\Documents\RND\_dev_\TS\traintracker\src\app\portfolio\
├── page.tsx              # Main portfolio page
├── layout.tsx            # Optional: custom layout without sidebar
└── components/           # Page-specific components
```

### Alternative Location (Standalone)
If creating outside traintracker project:
```
C:\Users\User\Documents\RND\_dev_\TS\portfolio-page\
```

---

## Content Extraction

### From Main Resume (Page 1-2)

**Contact Info**:
- Name: Darrell Robinson
- Phone: (914) 772-2116
- Website: https://mta-playground.vercel.app
- GitHub: https://github.com/process-env

**Title**: Full-Stack Software Engineer | React/Next.js · Node.js · TypeScript

**Key Technical Skills to Highlight**:
- Frontend: React 18/19, Next.js 15, TypeScript, Tailwind CSS, shadcn/ui
- Backend: Node.js 22, Express.js, REST APIs, WebSocket, Socket.IO
- Database: PostgreSQL, Prisma, MongoDB
- Real-Time: Protocol Buffers (GTFS), Server-Sent Events, WebSockets

### RailTime Project Data

**From Resume**:
- 472+ Stations
- 27 Routes
- 1000+ Predictions/sec
- 8 Real-Time Feeds
- 95+ Lighthouse score
- Zero Downtime

**Technical Highlights**:
- Processes 8 concurrent GTFS-Realtime feeds with Protocol Buffer decoding
- Complex multi-dimensional state management with ReactFlow nodes/edges
- 11 custom REST API endpoints
- AI agent integration with OpenAI GPT-4
- 100% TypeScript coverage
- Solved 5 critical technical challenges:
  - Route ID normalization
  - Stale closure prevention
  - Direction toggle state
  - Platform granularity
  - Mobile hydration

**Tech Stack**:
Next.js 15, React 19, TypeScript, ReactFlow, Tailwind, shadcn/ui, Protocol Buffers, GPT-4, Vitest, Vercel

### Watch the RIGHT Hook Project Data

**From Website**:
- 25 Chapters
- 10 Parts
- 3 Appendices
- Live Code Playgrounds (Sandpack)

**Book Structure**:
- Part I: Foundations (core concepts, hook selection)
- Part II: State Hooks (useState, useReducer, useSyncExternalStore)
- Part III: Forms & Actions
- Part IV: Context & Data
- Part V: Effects (useEffect, layout effects)
- Part VI: Refs (useRef, imperative handles)
- Part VII: Performance (memoization, transitions)
- Part VIII: Custom Hooks (design, testing)
- Part IX: Patterns & Practices (code smells, migration)
- Part X: Appendices

**Design Style**: Wes Anderson-inspired (cream, camel, brown, red accents)

**Tech Stack**:
Next.js 16, MDX, Sandpack, Tailwind CSS, TypeScript

**What It Demonstrates**:
- Deep expertise in React hook architecture
- Ability to document complex technical concepts
- Teaching and knowledge-sharing capability
- Modern documentation practices (MDX, live examples)
- Complete coverage of React's hooks API

---

## Design References

### Color Palette

**Primary (Navy-based)**:
```css
--navy-900: #0f172a;
--navy-800: #1e293b;
--navy-700: #334155;
```

**Accent (Blue - matches resume)**:
```css
--blue-500: #3b82f6;
--blue-600: #2563eb;
--blue-700: #1d4ed8;
```

**Neutral**:
```css
--white: #ffffff;
--gray-50: #f9fafb;
--gray-100: #f3f4f6;
--gray-400: #9ca3af;
--gray-600: #4b5563;
```

**Warm (for book section)**:
```css
--cream: #fefce8;
--amber-100: #fef3c7;
```

### Typography

**Headings**: Inter, system-ui, -apple-system, sans-serif
- h1: 28px, bold, tracking-tight
- h2: 20px, semibold
- h3: 16px, medium

**Body**: Inter, system-ui, sans-serif
- Body: 12px, regular
- Small: 10px, regular

**Monospace**: JetBrains Mono, Fira Code, monospace
- Code: 10px

### Layout Grid

```
┌─────────────────────────────────────────────────────────────────┐
│ MARGIN: 0.5in                                                   │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ HEADER: Name | Title | Contact (centered)                   │ │
│ │ Height: ~0.8in                                              │ │
│ ├─────────────────────────────────────────────────────────────┤ │
│ │                                                             │ │
│ │  ┌───────────────────────┐  ┌───────────────────────────┐  │ │
│ │  │                       │  │                           │  │ │
│ │  │     PROJECT 1         │  │       PROJECT 2           │  │ │
│ │  │     RAILTIME          │  │   WATCH THE RIGHT HOOK    │  │ │
│ │  │                       │  │                           │  │ │
│ │  │  • Visual preview     │  │  • Visual preview         │  │ │
│ │  │  • Metrics (4 cols)   │  │  • Metrics (4 cols)       │  │ │
│ │  │  • Key highlights     │  │  • Demonstrates           │  │ │
│ │  │  • Tech stack         │  │  • Tech stack             │  │ │
│ │  │  • URL                │  │  • URL                    │  │ │
│ │  │                       │  │                           │  │ │
│ │  └───────────────────────┘  └───────────────────────────┘  │ │
│ │                                                             │ │
│ │  Height: ~8.5in                                             │ │
│ │  Gap: 24px between columns                                  │ │
│ ├─────────────────────────────────────────────────────────────┤ │
│ │ FOOTER: "Portfolio Projects Supplement | 2025"              │ │
│ │ Height: ~0.3in                                              │ │
│ └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

---

## Dependencies

### Existing in Project
- Next.js 16
- React 19
- Tailwind CSS 4
- TypeScript
- Lucide React (icons)

### May Need to Add
- None required - all can be done with existing stack

### Optional Enhancements
- `html2canvas` - for screenshot generation
- `qrcode.react` - for QR codes linking to live projects

---

## ATS Considerations

### What ATS Systems Parse
1. Plain text content
2. Semantic HTML structure (h1, h2, ul, li)
3. Keywords (job titles, skills, technologies)
4. Contact information patterns
5. URLs and links

### What to Avoid
1. Text in images (use real text)
2. Complex CSS that hides content
3. JavaScript-only rendered content
4. Non-standard fonts embedded as images
5. Tables for layout (use CSS Grid)

### Keywords to Include
```
React, Next.js, TypeScript, Node.js, REST API, WebSocket,
Protocol Buffers, PostgreSQL, MongoDB, Tailwind CSS,
Real-time, Full-stack, State Management, Custom Hooks,
Technical Documentation, API Design, Performance Optimization
```

---

## Competitive Differentiation

### What Makes This Stand Out

1. **Visual Quality**: Not a Word template - custom designed
2. **Technical Depth**: Shows actual architecture decisions
3. **Working Products**: Links to live, deployed applications
4. **Dual Demonstration**: Production code + technical writing
5. **Modern Stack**: Current technologies, not outdated

### Target Audience
- Engineering managers reviewing candidates
- Technical recruiters at startups/scale-ups
- Companies valuing frontend/full-stack expertise
- Teams using React, Next.js, TypeScript

---

## Success Criteria

### Must Have
- [ ] Fits on single 8.5" x 11" page
- [ ] Prints correctly with colors
- [ ] All text selectable/searchable
- [ ] Both projects have equal visual weight
- [ ] Contact info clearly visible
- [ ] Live URLs included

### Should Have
- [ ] Visual preview images for each project
- [ ] Tech stack badges/pills
- [ ] Metrics displayed prominently
- [ ] Professional, modern design

### Nice to Have
- [ ] QR codes for mobile scanning
- [ ] Subtle animations for web view
- [ ] Dark/light mode toggle (web only)

---

## Related Documentation

- Plan: `portfolio-resume-addendum-plan.md`
- Tasks: `portfolio-resume-addendum-tasks.md`
- Main resume: `C:\Users\User\Desktop\darrell_robinson_914_772_2116.pdf`

