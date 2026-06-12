# Precalculus Content Outline
**Adaptive Learning Platform — Math Research**
*Compiled: 2026-06-11 | Branch: math-system*

This document grounds LLM question/flashcard generation in the official AP Precalculus
Course and Exam Description (CED) and in the algebra-foundations categories already
present in the database. It mirrors the structure of `apps/student/lib/mcatContentOutline.ts`.

---

## Sources

| Document | URL |
|---|---|
| AP Precalculus CED (official PDF) | https://apcentral.collegeboard.org/media/pdf/ap-precalculus-course-and-exam-description.pdf |
| AP Precalculus Exam page (College Board) | https://apcentral.collegeboard.org/courses/ap-precalculus/exam |
| AP Precalculus Course page (College Board) | https://apcentral.collegeboard.org/courses/ap-precalculus |
| AP Students exam page | https://apstudents.collegeboard.org/courses/ap-precalculus/assessment |
| AP Precalculus Wikipedia | https://en.wikipedia.org/wiki/AP_Precalculus |
| Albert.io overview | https://www.albert.io/blog/ap-precalculus-overview/ |
| Albert.io FRQ guide | https://www.albert.io/blog/ap-precalculus-frq/ |
| AdmissionSight exam guide | https://admissionsight.com/ap-precalculus-exam/ |
| FlipMath / FlippedMath topic pages | https://precalculus.flippedmath.com/ |
| Fiveable topic guides | https://fiveable.me/ap-pre-calc/ |

> **Verification note:** Topic numbers and names for Units 1–3 were cross-checked against
> the Wikipedia article (which mirrors the official CED list), Albert.io, and Fiveable topic
> guides. Unit exam weighting (30–40%, 27–40%, 30–35%) was confirmed across three
> independent sources. Learning objectives were derived from the CED-aligned descriptions
> on Fiveable, FlippedMath, and Albert.io; they faithfully represent the APPC CED language
> but are not verbatim CED text (the CED PDF could not be parsed by fetch tools).

---

## Part 1 — Algebra Foundations Layer

These seven categories live in the `learn_categories` table and are the prerequisite layer
beneath AP Precalculus. Each entry below summarises the **umbrella topics** extracted
directly from the corresponding `insert_*.sql` file.

### F1. Number Systems and Properties (`number_systems_and_properties`)

| Umbrella topic | Scope summary |
|---|---|
| Real Number Classification | Membership in ℕ, ℤ, ℚ, irrational, ℝ; containment chain; decimal forms |
| Number Representations | Fractions, decimals, percents, place value, expanded form, scientific notation |
| Integer Divisibility and Factor Structure | Divisibility rules, factors, multiples, primes, prime factorization, GCF, LCM, remainders |
| Signed Number Structure | Opposites, absolute value, magnitude, number-line distance, sign of products/quotients, signed arithmetic |
| Rational Number Arithmetic | Fraction ops (common/unlike denominators), fraction multiplication/division, complex fractions, decimal arithmetic |
| Percent and Proportional Number Structure | Percent as rate per hundred, percent of a number, percent increase/decrease factors, percent change, ratios, unit rates |
| Real Number Order and Comparison | Number-line location, ordering rational and irrational numbers, benchmark comparisons, inequality symbols |
| Real Number Operation Properties | Commutative, associative, distributive, identity, inverse, zero, closure for ℝ / ℤ / ℚ / irrationals |
| Numeric Expression Structure | Order of operations, grouping symbols, fraction-bar and absolute-value grouping, exponent precedence, negative-base parentheses |
| Approximation, Estimation, and Bounds | Rounding, truncation, compatible numbers, bounds from rounded values, order-of-magnitude reasoning |

**Foundation yield signal:** High across the board; every AP Precalc unit requires
clean real-number arithmetic. Signed-number, fraction, and exponent-precedence fluency
are load-bearing throughout Units 1–3.

---

### F2. Algebraic Expressions (`algebraic_expressions`)

| Umbrella topic | Scope summary |
|---|---|
| Algebraic Expression Structure | Variables, constants, coefficients, terms, factors, monomials; expression vs. equation boundary; notation reading |
| Substitution into Expressions | Single/multi-variable numeric substitution; negative/zero/fraction values; substitution into powers and groups; formula evaluation |
| Like Terms and Term Collection | Identifying like/unlike terms; combining integer/fraction/decimal coefficients; constant collection; additive-inverse cancellation |
| Distribution and Expansion | Distribution by positive/negative/fraction/variable factors; monomial over binomial/trinomial; subtraction of grouped expressions; nested distribution |
| Equivalent Expression Properties | Equivalence via collection/distribution; testing by substitution; counterexample for non-equivalence; coefficient matching |
| Verbal-to-Symbolic Expression Structure | Addition/subtraction/multiplication/division phrases; grouped-sum/difference phrases; power phrases; consecutive-integer expressions |
| Algebraic Expression Order and Grouping | Precedence with variables; nested grouping; coefficient attached to group; power-vs-coefficient scope; fraction-bar structure |

**Foundation yield signal:** Medium-high. Distribution and equivalent expressions are
exercised heavily in polynomial manipulation (Unit 1). Verbal-to-symbolic feeds
modeling topics (1.13, 1.14, 2.5, 3.7). Order-of-grouping underlies rational function
work and logarithm manipulation.

---

### F3. Linear Equations and Inequalities (`linear_equations_and_inequalities`)

| Umbrella topic | Scope summary |
|---|---|
| Linear Equation Foundations | Equation structure, solution meaning/verification, balance principle, properties of equality, variable isolation |
| One-Step Linear Equations | Addition/subtraction/multiplication/division equations; signed, fraction, decimal coefficients; zero/negative solutions |
| Two-Step Linear Equations | ax ± b = c structure; reverse operation order; fraction/decimal coefficients; variables on right side |
| Multi-Step Linear Equations | Like-term collection, distribution, variables on both sides, clearing fractions/decimals, cross-products, no-solution/identity cases |
| Literal Equations and Formula Rearrangement | Isolating one variable, factoring out the target variable, standard formula rearrangement (slope-intercept, area formulas) |
| Linear Inequality Foundations | Inequality symbols, solution meaning, properties of inequality (positive/negative multiplication), boundary values, number-line/interval notation |
| One- and Two-Step Linear Inequalities | Single inverse-operation inequalities; sign-flip requirement; fraction/decimal coefficients |
| Multi-Step Linear Inequalities | Distribution, like-term collection, variables on both sides, no-solution/all-real cases |
| Compound Linear Inequalities | AND/OR intervals, bounded solutions, contradictions, unions |
| Linear Equation and Inequality Interpretation | Identifying valid solution types, recognising special cases |

**Foundation yield signal:** Medium. Solving equations feeds 2.13 (exponential/log
equations) and 3.10 (trig equations). Literal-equation fluency is critical for
rearranging function formulas in all three units. Interval notation is the language of
domain/range in Unit 2 and Unit 3.

---

### F4. Systems of Equations (`systems_of_equations`)

| Umbrella topic | Scope summary |
|---|---|
| Systems Foundations and Solution Sets | Simultaneous solutions, ordered pairs/triples, verification, consistent/inconsistent, independent/dependent terminology |
| Graphical Systems of Linear Equations | Intersection reading, slope-intercept/standard-form graphing, parallel/coincident cases, estimating intersections |
| Substitution Method for Linear Systems | Explicit variable, isolating before substituting, signed/fraction/decimal expressions, one-variable reduction, special cases |
| Elimination Method for Linear Systems | Opposite/matching coefficients, adding/subtracting equations, scaling one/both equations, special cases |
| Linear System Preparation and Structure | Clearing denominators/decimals, distributing, collecting terms, method selection |
| Special-Case and Parameter Linear Systems | Proportional coefficients (parallel vs. coincident), parameter values for 0/1/∞ solutions |
| Three-Variable Linear Systems | Elimination to two-variable system, back substitution, ordered triples, free variables |
| Systems of Linear Inequalities | Boundary lines, shading, overlap regions, feasible regions |
| Nonlinear Systems of Equations | At least one nonlinear equation; intersection interpretation; substitution/elimination approach |
| Structured Linear System Relationships | Algebraic relationship patterns naturally forming systems |

**Foundation yield signal:** Medium-low for AP Precalc directly, but systems of
equations reappear in 1.9 (rational function vertical asymptotes), 2.13 (solving log/exp
equations by substitution), and implicitly in function-model construction (1.14, 2.14).

---

### F5. Polynomials (`polynomials`)

| Umbrella topic | Scope summary |
|---|---|
| Polynomial Structure and Classification | Expression definition, term structure, degree, standard form, mono/bi/trinomial, univariate/multivariable |
| Polynomial Values and Identities | Evaluation at numeric inputs (including negative/fraction), function notation, equivalent expressions, coefficient comparison |
| Polynomial Addition and Subtraction | Like-term alignment, sign negation, cancellation, additive inverse, closure, degree after ops |
| Polynomial Multiplication and Special Products | Monomial×monomial/polynomial, binomial×binomial/trinomial, general multiplication; squares, difference-of-squares, cube patterns |
| GCF Factoring and Grouping | Numeric/variable GCF, factoring GCF from binomials/trinomials, negative GCF, grouping with 4 terms, common binomial factor |
| Quadratic and Special-Form Factoring | Monic/non-monic trinomials, ac method, perfect-square trinomials, difference of squares, sum/difference of cubes, quadratic-form polynomials |
| Polynomial Division and Factor Theorems | Monomial divisors, long division, synthetic division, Remainder Theorem, Factor Theorem |
| Polynomial Equations and Roots | Factoring to solve, zero-product property, real vs. complex roots |
| Polynomial Zeros and Graph Behavior | Zeros from factored form, multiplicity, end behavior, intercepts, smoothness |
| Polynomial Tables and Finite Differences | Degree recognition from equally spaced tables |

**Foundation yield signal:** Very high. Unit 1 is built almost entirely on polynomial
structure: topics 1.4–1.6 directly require polynomial zeros, end behavior, and
factoring. Quadratic factoring and complex roots underlie 1.5. Special products appear
in 1.11 (equivalent representations).

---

### F6. Exponents and Radicals (`exponents_and_radicals`)

| Umbrella topic | Scope summary |
|---|---|
| Exponent Notation and Structure | Base/exponent identification, repeated multiplication, parenthesized vs. unparenthesized bases, precedence |
| Integer Exponent Laws | Product rule, quotient rule, power-of-power, power-of-product, power-of-quotient (all integer exponents) |
| Zero and Negative Exponent Structure | Zero-exponent rule (nonzero base), negative exponent as reciprocal, movement across fraction bar, variable restrictions |
| Scientific Notation with Powers of Ten | Multiplication/division/addition/subtraction in scientific notation, coefficient adjustment, comparison |
| Rational Exponent Structure | Unit-fraction exponents as roots, m/n form (root index and power), equivalence with radical notation, exponent laws extended to rationals |
| Radical Notation and Root Structure | Radicand/index identification, principal square root, even/odd root structure, domain conditions |
| Radical Factor Structure and Rewriting | Perfect-square/cube/nth-power factors, product rule for radicals, simplest radical form, variable radical expressions |
| Radical Operations and Like Radicals | Adding/subtracting like radicals, multiplying/dividing radicals, FOIL with radicals, special radical products |
| Rationalizing and Radical Denominators | Monomial radical denominators, conjugate rationalization, nth-root denominators |
| Radical Equations and Rational-Exponent Equations | Isolation of radical, powering to remove radical, extraneous solutions, rational-exponent equations |

**Foundation yield signal:** Very high. Exponent laws are the algebraic engine behind
Unit 2 (exponential functions, logarithm manipulation, 2.4, 2.9, 2.12). Rational
exponents directly link to 2.3 and 2.4. Radical structure is prerequisite for complex
zeros (1.5).

---

### F7. Representations (`representations`)

| Representation keyword | Scope |
|---|---|
| Symbolic | Mathematical symbols — expressions, equations, inequalities, functions, systems |
| Verbal | Word problems, phrase translations, mathematical descriptions |
| Contextual | Real-world situations with units, constraints, interpretive demands |
| Graphical | Coordinate plane, curves, number lines, shaded regions |
| Tabular | Input-output tables, frequency tables, finite-difference tables |
| Diagram | Geometric figures, labeled shapes, measurement diagrams |
| Exact form | Fractions, radicals, π, logarithms as exact answers |
| Approximate form | Decimal approximations, estimation, rounding |

**Foundation yield signal:** Cross-cutting. The three AP Precalculus Mathematical
Practices (Procedural/Symbolic Fluency, Multiple Representations, Communication and
Reasoning) map directly onto these representation categories; every exam question
exercises at least one.

---

## Part 2 — AP Precalculus Course Outline (Units 1–4)

### Exam Format and Weighting

**Source:** AP Central exam page + AP Students assessment page (confirmed across three sources)

| Section | Questions | Time | Calc? | % of Score |
|---|---|---|---|---|
| **Section I Part A** (MC) | 28 | 80 min | ✗ | ~43.75% |
| **Section I Part B** (MC) | 12 | 40 min | ✓ required | ~18.75% |
| **Section II Part A** (FRQ) | 2 | 30 min | ✓ required | ~18.75% |
| **Section II Part B** (FRQ) | 2 | 30 min | ✗ | ~18.75% |
| **TOTAL** | **44** | **3 hr** | — | **100%** |

**Section I total: 62.5% of score | Section II total: 37.5% of score**

> **Format note (2026–27 change):** College Board has announced an upcoming revision
> to question counts and section timing effective May 2027. The format above reflects the
> 2024/2025/2026 exam format.

#### FRQ Task Types (fixed every year)

| FRQ # | Task type | Calc | Primary units |
|---|---|---|---|
| 1 | Function Concepts (composition, inverse, zeros, end behavior) | ✓ | 1, 2 |
| 2 | Modeling a Non-Periodic Context (polynomial, exponential, or logarithmic) | ✓ | 1, 2 |
| 3 | Modeling a Periodic Context (sinusoidal model construction + analysis) | ✗ | 3 |
| 4 | Symbolic Manipulations (exponent/log/trig identities; solving equations) | ✗ | 2, 3 |

#### Mathematical Practices

| Practice | Exam weight | Description |
|---|---|---|
| **MP1: Procedural and Symbolic Fluency** | 39–48% | Algebraically manipulate functions, equations, and expressions |
| **MP2: Multiple Representations** | 20–27% | Translate mathematical information among representations |
| **MP3: Communication and Reasoning** | 32–39% | Communicate with precise language; justify conclusions |

#### Unit exam weighting

| Unit | Exam weight | Notes |
|---|---|---|
| Unit 1: Polynomial and Rational Functions | **30–40%** | Largest possible share; most variable |
| Unit 2: Exponential and Logarithmic Functions | **27–40%** | Nearly equal to Unit 1 at top of range |
| Unit 3: Trigonometric and Polar Functions | **30–35%** | Narrowest band; consistently heavy |
| Unit 4: Parameters, Vectors, Matrices | **0%** | NOT assessed on exam |

---

### Unit 1 — Polynomial and Rational Functions (30–40% of exam)

> High-exam-yield unit. FRQs 1 and 2 draw heavily from here. Function concepts (covariation,
> rate of change) and rational-function asymptotes are consistent MC question pools.

| # | Topic name | Learning objective summary | Exam yield | Rationale |
|---|---|---|---|---|
| 1.1 | Change in Tandem | Describe how input and output values of a function co-vary; compare function values across representations | **0.75** | Foundational covariation reasoning appears in FRQ 1 (function concepts) and many MC items; central to the unit's conceptual arc |
| 1.2 | Rates of Change | Calculate and interpret average rate of change over an interval; sign indicates direction of co-variation | **0.80** | Rate-of-change calculation appears in FRQ 2 (non-periodic modeling) and multiple MC questions; high unit centrality |
| 1.3 | Rates of Change in Linear and Quadratic Functions | Recognize constant rate of change (linear) vs. changing rate of change (quadratic); connect to concavity | **0.72** | Lays conceptual groundwork for distinguishing function families; referenced in FRQ 2 context questions |
| 1.4 | Polynomial Functions and Rates of Change | Describe rate-of-change behavior for polynomial functions; connect interval behavior to degree | **0.68** | Bridges rate-of-change concepts to polynomial structure; moderate MC frequency |
| 1.5 | Polynomial Functions and Complex Zeros | Identify real and complex/non-real zeros of polynomials using the Fundamental Theorem; relate to irreducible quadratic factors | **0.55** | Complex zeros appear occasionally in MC; less emphasis than real-zero analysis |
| 1.6 | Polynomial Functions and End Behavior | Determine end behavior from degree and leading coefficient; connect to limits at ±∞ | **0.82** | End behavior is heavily tested; appears in FRQ 1 (end behavior task) and consistent MC pool |
| 1.7 | Rational Functions and End Behavior | Determine end behavior / horizontal asymptotes of rational functions from degree comparison of numerator and denominator | **0.78** | Rational function end behavior is a reliable MC topic; also tested in FRQ 1 |
| 1.8 | Rational Functions and Zeros | Identify zeros of rational functions from zeros of the numerator (not cancelled by denominator) | **0.65** | Zeros of rationals appear in MC questions; interconnected with 1.9 and 1.10 |
| 1.9 | Rational Functions and Vertical Asymptotes | Identify vertical asymptotes where denominator = 0 and factor does not cancel with numerator | **0.76** | Vertical asymptotes are among the most-tested rational-function concepts; frequent MC |
| 1.10 | Rational Functions and Holes | Identify removable discontinuities (holes) where common factors cancel | **0.62** | Holes appear regularly in MC; requires factoring fluency |
| 1.11 | Equivalent Representations of Polynomial and Rational Expressions | Rewrite polynomial/rational expressions using factoring, long division, partial fractions | **0.70** | Algebraic manipulation; feeds FRQ 4 (symbolic manipulations) and MC computation |
| 1.12 | Transformations of Functions | Construct g(x) as an additive and/or multiplicative transformation of f(x); vertical/horizontal translation, dilation, reflection | **0.85** | Transformations appear throughout MC and every FRQ; among the most cross-unit skills in the course |
| 1.13 | Function Model Selection and Assumption Articulation | Select appropriate function type for a context; state assumptions and limitations of a model | **0.73** | Core skill for FRQ 2 (justify model selection); also MC interpretation items |
| 1.14 | Function Model Construction and Application | Construct polynomial/rational function models from context or data; apply to answer questions | **0.78** | FRQ 2 explicitly asks students to construct and apply non-periodic models; high FRQ weight |

---

### Unit 2 — Exponential and Logarithmic Functions (27–40% of exam)

> Consistently tested at high weight. FRQs 2 and 4 both draw from this unit.
> Exponential modeling and logarithm manipulation are the two most visible topic clusters
> in released exams.

| # | Topic name | Learning objective summary | Exam yield | Rationale |
|---|---|---|---|---|
| 2.1 | Change in Arithmetic and Geometric Sequences | Distinguish constant additive change (arithmetic) from constant multiplicative change (geometric); connect to linear vs. exponential functions | **0.65** | Conceptual bridge from discrete sequences to continuous functions; moderate MC frequency |
| 2.2 | Change in Linear and Exponential Functions | Compare rates of change: linear functions have constant additive change, exponential have constant proportional (multiplicative) change | **0.72** | A central conceptual distinction tested in MC modeling questions and FRQ 2 justifications |
| 2.3 | Exponential Functions | Define and interpret exponential functions f(x) = ab^x; identify base, initial value, growth/decay; domain and range | **0.80** | Core function type; appears in FRQ 2 and throughout MC; high unit centrality |
| 2.4 | Exponential Function Manipulation | Rewrite exponential expressions using exponent laws; connect to equivalent forms including rational exponents | **0.78** | Algebraic manipulation of exponentials; required for FRQ 4 (symbolic manipulations) and log-solving |
| 2.5 | Exponential Function Context and Data Modeling | Construct exponential models from real-world data; interpret parameters in context; use technology for regression | **0.82** | FRQ 2 regularly features exponential modeling with context; high-frequency skill |
| 2.6 | Competing Function Model Validation | Use residual plots and comparison criteria to validate or critique function model choices | **0.55** | Model validation appears in FRQ 2 (justify/identify limitations); moderate but targeted |
| 2.7 | Composition of Functions | Evaluate, construct, and decompose compositions of two or more functions; use function notation correctly | **0.75** | FRQ 1 covers composition; also tested in MC; important for inverse functions (2.8) |
| 2.8 | Inverse Functions | Determine input-output pairs of an inverse; identify invertible domains; connect f and f⁻¹ graphically and algebraically | **0.80** | FRQ 1 frequently involves inverse functions; consistent MC topic; feeds log-as-inverse-of-exp |
| 2.9 | Logarithmic Expressions | Evaluate and interpret logarithmic expressions; connect log to the question "what exponent?" | **0.75** | Prerequisite for 2.10–2.13; logarithm evaluation is MC-staple |
| 2.10 | Inverses of Exponential Functions | Establish the logarithm as the inverse of the exponential; use log to "undo" an exponential | **0.78** | Critical conceptual link; drives ability to solve exponential equations in 2.13 |
| 2.11 | Logarithmic Functions | Graph and analyze logarithmic functions; domain, range, intercepts, asymptotic behavior | **0.72** | Function analysis of log functions appears in MC and FRQ 1 |
| 2.12 | Logarithmic Function Manipulation | Apply product, quotient, and power rules for logarithms; rewrite expressions in equivalent forms | **0.85** | FRQ 4 (symbolic manipulations) regularly requires log rule application; very high FRQ weight |
| 2.13 | Exponential and Logarithmic Equations and Inequalities | Solve exponential and logarithmic equations and inequalities using inverse relationships and log properties | **0.88** | FRQ 4 Part 2 asks for solving; also MC; one of the most heavily tested symbolic skills |
| 2.14 | Logarithmic Function Context and Data Modeling | Construct logarithmic models from data; interpret parameters; use technology for regression | **0.70** | Less frequent than exponential modeling but does appear in FRQ 2 contexts |
| 2.15 | Semi-log Plots | Use semi-logarithmic plots to linearize exponential data; interpret slope and intercept of linearized data | **0.45** | Niche topic; less tested but included in CED; appears occasionally in MC |

---

### Unit 3 — Trigonometric and Polar Functions (30–35% of exam)

> FRQ 3 is exclusively dedicated to this unit (sinusoidal modeling). FRQ 4 Part 1 often
> involves solving trig equations. Sinusoidal modeling is the single most-tested cluster
> in Unit 3 based on FRQ structure.

| # | Topic name | Learning objective summary | Exam yield | Rationale |
|---|---|---|---|---|
| 3.1 | Periodic Phenomena | Identify and describe periodic phenomena; define period, amplitude, midline in context; distinguish periodic from non-periodic | **0.72** | Conceptual foundation for all of Unit 3; appears in FRQ 3 setup and MC context items |
| 3.2 | Sine, Cosine, and Tangent | Define sine, cosine, and tangent via right-triangle ratios and unit-circle coordinates; connect degree and radian measure | **0.78** | Core function definitions; prerequisite for all subsequent trig topics; MC staple |
| 3.3 | Sine and Cosine Function Values | Evaluate sine and cosine at special angles (0, π/6, π/4, π/3, π/2, and their reflections); use unit circle | **0.80** | Exact-value evaluation is required for FRQ 4 (no-calculator) and MC Part A |
| 3.4 | Sine and Cosine Function Graphs | Identify key features (amplitude, period, intercepts, max/min) from graphs of sine and cosine; sketch from features | **0.82** | Graph reading and sketching appear in FRQ 3 and throughout MC |
| 3.5 | Sinusoidal Functions | Define sinusoidal function y = A sin(B(x – C)) + D; identify amplitude, period, phase shift, midline, frequency | **0.90** | Highest-yield topic in Unit 3; FRQ 3 is entirely about constructing and analyzing sinusoidal models |
| 3.6 | Sinusoidal Function Transformations | Construct transformed sinusoidals from parent functions; connect parameters to amplitude, period, phase shift, vertical shift | **0.88** | FRQ 3 requires parameter identification and transformation interpretation; very high weight |
| 3.7 | Sinusoidal Function Context and Data Modeling | Construct sinusoidal models from real-world periodic data; interpret parameters in context; validate model | **0.90** | FRQ 3 task type directly; consistently highest-yield modeling task in the course |
| 3.8 | The Tangent Function | Analyze properties of tan(x): period π, vertical asymptotes, zeros, undefined values; compare to sine/cosine | **0.55** | Tangent appears in MC but not in FRQ task types; moderate weight |
| 3.9 | Inverse Trigonometric Functions | Define arcsin, arccos, arctan with restricted domains; evaluate at special values; interpret in context | **0.65** | Appears in FRQ 4 (symbolic) and MC; required for solving trig equations (3.10) |
| 3.10 | Trigonometric Equations and Inequalities | Solve trig equations algebraically using inverse functions and unit circle; find general solutions | **0.82** | FRQ 4 Part 1 regularly involves solving trig equations; also MC |
| 3.11 | Secant, Cosecant, and Cotangent Functions | Define reciprocal trig functions; identify asymptotes, domain, and key features of their graphs | **0.42** | Less tested than primary trig functions; appears occasionally in MC |
| 3.12 | Equivalent Representations of Trigonometric Functions | Apply Pythagorean identities and co-function identities to rewrite trig expressions; verify identities | **0.68** | Identities used in FRQ 4 (symbolic manipulations); moderate MC frequency |
| 3.13 | Trigonometry and Polar Coordinates | Convert between rectangular and polar coordinates; relate angle and radius to (x, y) | **0.58** | Prerequisite for 3.14–3.15; appears in MC with moderate frequency |
| 3.14 | Polar Function Graphs | Graph polar functions r = f(θ) including circles, limaçons, roses, lemniscates; identify key features | **0.55** | Tested in MC; less common in FRQ; identifiable graph shapes expected |
| 3.15 | Rates of Change in Polar Functions | Describe how r changes with respect to θ; interpret concavity and increasing/decreasing behavior in polar context | **0.48** | Least-tested Unit 3 topic; niche skill in MC |

---

### Unit 4 — Functions Involving Parameters, Vectors, and Matrices (NOT on AP Exam)

> **Unit 4 is NOT assessed on the AP Precalculus Exam.** It covers additional enrichment
> content for state or local curriculum requirements. Yields are listed as 0.00 for
> all topics since none appear on the end-of-course exam.

| # | Topic name | Brief description | Exam yield |
|---|---|---|---|
| 4.1 | Parametric Functions | Represent plane curves using separate x(t) and y(t) functions | 0.00 |
| 4.2 | Parametric Functions Modeling Planar Motion | Use parametric functions to describe position, direction, and speed | 0.00 |
| 4.3 | Parametric Functions and Rates of Change | Analyze average rate of change for parametric components | 0.00 |
| 4.4 | Parametrically Defined Circles and Lines | Write parametric equations for circles and lines | 0.00 |
| 4.5 | Implicitly Defined Functions | Analyze relations defined implicitly; find function restrictions | 0.00 |
| 4.6 | Conic Sections | Identify and analyze parabolas, ellipses, hyperbolas | 0.00 |
| 4.7 | Parametrization of Implicitly Defined Functions | Parametrize implicit relations including conics | 0.00 |
| 4.8 | Vectors | Define vectors; operations of addition, scalar multiplication; magnitude and direction | 0.00 |
| 4.9 | Vector-Valued Functions | Express motion using vector-valued functions | 0.00 |
| 4.10 | Matrices | Define matrices; perform addition, subtraction, multiplication | 0.00 |
| 4.11 | Inverse and Determinant of a Matrix | Compute 2×2 determinants and inverses; identify when a matrix is invertible | 0.00 |
| 4.12 | Linear Transformations and Matrices | Represent geometric transformations as matrix multiplication | 0.00 |
| 4.13 | Matrices as Functions | Interpret matrices as linear functions on vectors | 0.00 |
| 4.14 | Matrices Modeling Contexts | Apply matrices to model real-world scenarios (e.g., networks, transition matrices) | 0.00 |

---

## Part 3 — Prerequisite Edges

The table below maps each foundation category (F1–F7) to the AP Precalculus topics/units
it most directly feeds. Read each row as: "mastery of [foundation] unlocks [AP topic]."

| Foundation category | Feeds AP Precalc topics | Explanation |
|---|---|---|
| **F1 Number Systems and Properties** | 1.1–1.3 (rate-of-change arithmetic), 2.1–2.2 (arithmetic/geometric sequences), 3.3 (exact trig values) | Clean real-number arithmetic, signed numbers, and scientific notation underlie every numeric calculation in the course |
| **F2 Algebraic Expressions** | 1.11, 1.12 (equivalent polynomial/rational forms, transformations), 2.4 (exponential manipulation), 2.12 (log manipulation), 3.12 (trig identities), FRQ 4 | Distribution, equivalent expressions, and substitution are the mechanism for all symbolic manipulation tasks |
| **F3 Linear Equations and Inequalities** | 2.13, 3.10 (solving exponential/log/trig equations), 1.14, 2.14, 3.7 (model construction via parameter-solving), 1.13 (domain/range using interval notation) | Inverse-operation reasoning extends directly to solving non-linear equations; literal-equation fluency enables parameter extraction in function models |
| **F4 Systems of Equations** | 1.14, 2.5, 2.14 (model construction with two conditions), 3.7 (sinusoidal model with two known points) | Constructing function models from context often requires solving a 2×2 system for parameters |
| **F5 Polynomials** | 1.4–1.11 (entire polynomial/rational unit), 1.14, 2.7 (composition as polynomial-style reasoning) | Unit 1 is essentially applied polynomial algebra; factoring/division skills are direct prerequisites for zeros, asymptotes, holes, and equivalent forms |
| **F6 Exponents and Radicals** | 2.3–2.4, 2.9–2.13 (exponential and logarithm unit), 1.5 (complex zeros via √negative), 3.3 (radian/exact trig values with square roots), FRQ 4 | Exponent laws are the operational core of Unit 2; rational exponents connect to exponential function manipulation; radicals appear in exact trig values |
| **F7 Representations** | Cross-cutting: 1.1, 1.12, 1.13, 1.14, 2.5, 2.6, 2.14, 3.1, 3.4, 3.7, FRQ 1, 2, 3 | All three mathematical practices (fluency, multiple representations, communication) require switching among symbolic, graphical, tabular, verbal, and contextual forms |

---

## Part 4 — Foundation Yield Calibration

These yields govern how often each foundation category should be exercised
**inside AP Precalculus content** — i.e., how load-bearing the skill is for downstream
topics.

| Foundation category | Umbrella topic | Foundation yield | Rationale |
|---|---|---|---|
| F1 | Real Number Operation Properties | **0.55** | Foundational but rarely the direct test object once functions are introduced |
| F1 | Signed Number Structure | **0.80** | Sign errors in function evaluation, transformations, and trig persist throughout |
| F1 | Rational Number Arithmetic | **0.72** | Fraction arithmetic required in rate-of-change calculations and parameter extraction |
| F1 | Integer Divisibility and Factor Structure | **0.35** | GCF/LCM needed for radical simplification and polynomial GCF; not a focal AP skill |
| F1 | Percent and Proportional Number Structure | **0.50** | Growth/decay percent language appears in exponential context; moderate signal |
| F1 | Approximation, Estimation, and Bounds | **0.40** | Model validation (2.6) uses reasonableness; not a direct tested skill |
| F1 | Number Representations | **0.45** | Scientific notation overlaps with 2.15 (semi-log); otherwise background skill |
| F2 | Distribution and Expansion | **0.85** | Used in every unit to expand and simplify; prerequisite for trig identity work |
| F2 | Equivalent Expression Properties | **0.80** | Underpins 1.11, 2.12, 3.12 (all "equivalent representation" topics) |
| F2 | Substitution into Expressions | **0.75** | Function evaluation, composition (2.7), and model application all use substitution |
| F2 | Like Terms and Term Collection | **0.65** | Needed for polynomial arithmetic (Unit 1) and simplifying log/trig expressions |
| F2 | Verbal-to-Symbolic Expression Structure | **0.60** | FRQ modeling tasks require translating context to function notation |
| F2 | Algebraic Expression Structure | **0.50** | Background structural literacy; not directly tested |
| F3 | Multi-Step Linear Equations | **0.75** | Solving exponential/log/trig equations mirrors multi-step linear algebra |
| F3 | Literal Equations and Formula Rearrangement | **0.80** | Extracting sinusoidal parameters (A, B, C, D) from a fitted model is literal-equation work |
| F3 | Linear Inequality Foundations | **0.55** | Domain and range expressed as intervals; inequality solution notation throughout |
| F3 | One- and Two-Step Linear Equations | **0.65** | Base case for inverse-operation reasoning extended to non-linear equations |
| F4 | Substitution Method for Linear Systems | **0.50** | Two-point function model construction sometimes requires a 2-equation system |
| F4 | Systems of Linear Inequalities | **0.30** | Feasible regions not a direct AP Precalc concept |
| F5 | Polynomial Zeros and Graph Behavior | **0.90** | Direct prerequisite for 1.4–1.10 and end-behavior analysis |
| F5 | Quadratic and Special-Form Factoring | **0.88** | Required for rational function zeros, holes, asymptotes (1.8–1.10), and 1.11 |
| F5 | Polynomial Multiplication and Special Products | **0.82** | Difference-of-squares and square-of-binomial patterns used in 1.11 and FRQ 4 |
| F5 | GCF Factoring and Grouping | **0.75** | GCF extraction is the first step in most rational-function simplification tasks |
| F5 | Polynomial Division and Factor Theorems | **0.70** | Synthetic/long division and Remainder Theorem appear in 1.11 |
| F5 | Polynomial Structure and Classification | **0.55** | Vocabulary and standard form are background; not a direct exam question target |
| F6 | Integer Exponent Laws | **0.92** | Used in every topic involving exponential expressions; ubiquitous |
| F6 | Rational Exponent Structure | **0.88** | Rational exponents are explicitly part of 2.3, 2.4, and equivalent-forms questions |
| F6 | Zero and Negative Exponent Structure | **0.85** | Negative exponents appear constantly in rational function and exponential work |
| F6 | Radical Factor Structure and Rewriting | **0.78** | Simplifying radicals required for exact trig values and complex zero work |
| F6 | Radical Operations and Like Radicals | **0.72** | Rationalizing and combining radicals appear in trig identity/equation solving |
| F6 | Radical Equations and Rational-Exponent Equations | **0.60** | Occasional MC item; less central than exponent-law manipulation |
| F6 | Scientific Notation with Powers of Ten | **0.30** | Minimal direct overlap; powers of 10 appear in semi-log contexts (2.15) |
| F7 | Graphical | **0.90** | Every AP Precalc FRQ and most MC items use graphical representations |
| F7 | Contextual | **0.88** | FRQs 2 and 3 are entirely context-based; multiple MC items too |
| F7 | Symbolic | **0.85** | FRQ 4 and MC Part A are pure symbolic manipulation |
| F7 | Tabular | **0.75** | FRQ 2 often provides data in table form; rate-of-change calculations from tables |
| F7 | Verbal | **0.65** | Justification language in FRQ parts; communication practice (MP3) |
| F7 | Exact form | **0.70** | No-calculator sections require exact values (trig, log, exponential) |
| F7 | Approximate form | **0.55** | Calculator sections may ask for decimal approximations |
| F7 | Diagram | **0.20** | Geometric diagrams rare in APPC; unlike MCAT context |

---

## Part 5 — Unverified / Uncertain Facts

The following facts could not be independently confirmed and are flagged as uncertain:

1. **Topic-level learning objective text (verbatim CED language):** The official CED PDF
   could not be parsed by the fetch tooling (compressed binary). The learning objectives
   listed in Part 2 are CED-faithful paraphrases derived from Fiveable, FlippedMath, and
   Albert.io, which are themselves directly aligned to the CED. However, they may differ
   in exact wording from the official document. Recommend manual verification against
   the PDF at: `https://apcentral.collegeboard.org/media/pdf/ap-precalculus-course-and-exam-description.pdf`

2. **Per-topic MC frequency data:** There is no publicly available per-topic question
   frequency breakdown for released MC items. The yield values for individual topics
   within units are calibrated estimates based on (a) unit weighting ranges, (b) FRQ
   task-type anchors (which pin certain topics as guaranteed), and (c) prep-site
   commentary. They should be treated as informed estimates, not empirical measurements.

3. **2025 FRQ content specifics:** Confirmed that the four FRQ task types are identical
   every year (Function Concepts, Modeling Non-Periodic, Modeling Periodic, Symbolic
   Manipulations). The specific function families tested in FRQ 1 and FRQ 2 in 2025
   could not be verified from free sources.

4. **2026–27 exam format changes:** College Board announced changes to question counts
   and section timing for May 2027. The exact new format was not available at time of
   writing.

5. **Unit 2 lower bound (27%):** The lower bound of 27–40% for Unit 2 is slightly lower
   than the others. This is consistent across sources but could indicate that in some
   test years, Unit 1 or Unit 3 takes a larger share at Unit 2's expense.

---

*End of precalc-outline.md — file path: `/Users/alexvillagomez/Desktop/ap-calc-platform/docs/math-research/precalc-outline.md`*
