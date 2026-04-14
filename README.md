# AP Calculus Platform

A high-stakes AP Calculus platform with Admin and Student Next.js applications sharing a Supabase backend.

## Structure

```
ap-calc-platform/
├── apps/
│   ├── admin/       # Admin app (port 3001)
│   └── student/     # Student app (port 3002)
├── packages/
│   ├── types/       # Shared types (Problem, TopicVector, etc.)
│   └── supabase/    # Shared Supabase client
├── package.json
├── pnpm-workspace.yaml
└── turbo.json
```

## Getting Started

### Prerequisites

- Node.js 18+
- npm 7+ (or pnpm)

### Install

```bash
npm install
```

### Environment

Copy `.env.example` to `.env.local` in the project root (or in each app) and set your Supabase credentials:

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

### Run Development

```bash
npm run dev
```

This starts both apps:
- **Admin**: http://localhost:3001
- **Student**: http://localhost:3002

### Build

```bash
npm run build
```

## Shared Types

The `Problem` type in `@ap-calc/types` includes:

- `latex_content` – LaTeX problem statement
- `answer` – Correct answer
- `distractors` – MCQ wrong options
- `difficulty` – 1–5
- `topic_vector` – AP Calc unit weights (Unit 1–10)
- `rubric` – LaTeX rubric

## Admin Preview Component

The admin app includes a `Preview` component that renders LaTeX in real-time using KaTeX and react-markdown. Supports inline (`$...$`) and display (`$$...$$`) math.
