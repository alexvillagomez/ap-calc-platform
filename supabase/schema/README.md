# Per-Course Schema Organization

The platform keeps **each course's data in its own set of tables** — this is a
deliberate constraint of the course-engine unification (the shared FRAMEWORK is
unified in code, but the DATABASE stays separate per course). There is **no**
shared `course_*` table and no plan to migrate to one.

## Naming convention (the per-course "folder")

Every course owns a table namespace identified by its **table prefix**:

| Course family | Prefix    | Registry `tablePrefix` |
|---------------|-----------|------------------------|
| Math (precalc + calc_ab) | `math_` | `"math"` |
| MCAT Biology  | `mcat_`   | `"mcat"` |
| _A new course_ | `<course>_` | `"<course>"` |

The prefix IS the folder: `math_*` and `mcat_*` are two fully independent table
sets with the same role-for-role shape. The shared engine resolves the prefix
from `COURSE_REGISTRY[courseId].tablePrefix` (see
`apps/student/lib/courseEngine/config.ts`) — the already-unified libs
(`questionEnrichment.ts`, `refresherGenerator.ts`, `bestKeyword.ts`) take a
`system: "math" | "mcat"` value that maps to the same prefix.

Per-prefix table inventories live alongside this file:

- [`math.md`](math.md) — the `math_*` tables
- [`mcat.md`](mcat.md) — the `mcat_*` tables

## Why migrations stay flat (don't break the runner)

The Supabase CLI migration runner reads `supabase/migrations/*.sql` **flat**, in
timestamp order, and does not recurse into subdirectories. Splitting migrations
into per-course subfolders would break ordering and the runner, so migration
**files** remain flat in `supabase/migrations/`. This `supabase/schema/`
directory is the per-course **organization layer** (docs + naming convention)
that gives each course a clear "folder" without disturbing the runner. In this
repo migrations are also applied manually in the Supabase SQL editor.

When you add a migration, name it so its course is obvious from the filename,
e.g. `20260701000000_mcat_chem_tables.sql`, and list its tables in the matching
`supabase/schema/<prefix>.md`.

## Adding a new course = own tables + a registry entry

1. Create `<course>_*` tables mirroring the role-for-role shape (see `math.md`
   for the canonical role list). Name the migration `..._<course>_tables.sql`.
2. Seed taxonomy into `<course>_categories` / `<course>_keywords` (+ optional
   `<course>_prereq_edges`).
3. Add a `CourseConfig` entry to `COURSE_REGISTRY` (taxonomy ref + emphasis curve
   + `tablePrefix`).
4. Run the course's seed + embed scripts.

No new flow / lib / component / route code — the shared engine handles the rest.
API routes stay per-course (thin `/api/<family>/*` wrappers over the shared core).
