# Key Pages

Read when working on routing, page behavior, or the demo journey. For deeper architecture see [student.md](student.md) and [admin.md](admin.md).

## Admin app (port 3001)
| Page | Purpose |
|------|---------|
| `/input` | Paste problem JSON to insert into `rag_examples`. Single object or comma-separated/array bulk insert. AP Calc / Precalc toggle. |
| `/generate` | Generate AP Calc problems via GPT-4o, assess difficulty, approve & save to `problems`. |
| `/rag-examples` | Browse and manage RAG example problems. |
| `/rag-agent` | Batch MCQ generation from PDFs via SSE streaming agent. |
| `/keywords` | Keyword catalog — view, embed, manage `learn_keywords`. |
| `/tagging` | Four-dimensional keyword tagging pipeline (topic/action/representation/prerequisite). |

## Student app (port 3002)
| Page | Purpose |
|------|---------|
| `/` | **Onboarding gate.** Logged-out visitors see the pre-login `<Onboarding/>` walkthrough (CTAs route to `/login?register=1`). Logged-in users are redirected by stage: diagnostic done → `/demo-practice`, else → `/demo`. |
| `/login` | Login / register tabs. `?register=1` opens the register tab (`useSearchParams`, wrapped in `<Suspense>`). On success, routes by the `diagnosticCompletedAt` flag returned from the API: done → `/demo-practice`, else → `/demo`. |
| `/demo` | Adaptive diagnostic — pulls real `rag_examples`, tracks per-skill strengths, rating + flagging per answer. Requires login (auth-guards to `/login`). **Mount guard:** a returning user who already completed the diagnostic is redirected to `/demo-practice`. On finish, marks completion (`POST /api/demo/complete`) and shows a FeedbackReport with a **"Start practice →"** button. **Logout → `/`.** |
| `/demo-practice` | Post-diagnostic practice hub. Loads weak Polynomials keywords from `/api/learn/progress`, sorts by priority (needs_lesson → needs_practice → in_progress → not_started; mastered filtered), queues top 8. **Resumes the saved position** (keyword / phase / lesson step) from `/api/demo-practice/position` instead of always starting at `queue[0]`; falls back to `queue[0]` when nothing is saved. Auto-advance (Duolingo-style 3s RAF countdown), streak dots (○○○), 3-correct advances, 2-wrong auto-lesson. **Logout → `/`.** `loadPracticeProblem` reads `sessionId` from `localStorage` at call time (avoids a stale-closure 400 from `startKeyword`'s `[]` deps). |
| `/progress` | Student report — **Polynomials only** (other categories hidden, data preserved). Category → Umbrella → Individual skill, with low-sample flags. See [progress-report.md](progress-report.md). |
| `/precalc` | Main student portal — Recommended Path, Free Practice, Lessons, Lookup, Progress modes. |
| `/precalc/practice` | Adaptive free practice (requires login). |
| `/precalc/diagnostic` | Diagnostic mode (requires login). |

The continue-progress routing (onboarding → diagnostic → practice resume, logout → onboarding) is described in [journey-routing.md](journey-routing.md).
