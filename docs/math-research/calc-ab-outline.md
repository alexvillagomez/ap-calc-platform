# AP Calculus AB — Official Content Outline
## Research-Grounded Platform Reference Document

**Purpose:** Ground LLM question/flashcard generation in the official College Board scope and sequence.
Mirrors the format of `apps/student/lib/mcatContentOutline.ts`. Used by the adaptive diagnostic
and content pipeline for AP Calculus AB.

**Primary Sources:**
- [AP Calculus AB & BC CED (Fall 2020)](https://apcentral.collegeboard.org/media/pdf/ap-calculus-ab-and-bc-course-and-exam-description.pdf)
- [AP Central Exam page](https://apcentral.collegeboard.org/courses/ap-calculus-ab/exam)
- [Flipped Math CED topic index](https://calculus.flippedmath.com/ced.html)
- [UWorld AP Calc AB topic guide](https://collegeprep.uworld.com/ap/ap-calculus-ab/units-topics-and-key-concepts/)
- [Albert.io AP Calc AB FAQ](https://www.albert.io/blog/ap-calculus-ab-faq/)
- [Nerd Notes FRQ frequency analysis](https://nerd-notes.com/every-ap-calculus-ab-frq-sorted-by-unit/)
- [Calculus Masters FRQ archetype guide](https://calculusmasterr.com/frq)
- Released FRQs (2019–2025) via College Board AP Central

---

## Section 1 — Exam Format and Structure

### Section I: Multiple Choice (50% of score)
| Part | Questions | Time | Calculator |
|------|-----------|------|------------|
| Part A | 30 | 60 min | No |
| Part B | 15 | 45 min | Yes (graphing) |
| **Total** | **45** | **105 min** | — |

### Section II: Free Response (50% of score)
| Part | Questions | Time | Calculator |
|------|-----------|------|------------|
| Part A | 2 | 30 min | Yes (graphing) |
| Part B | 4 | 60 min | No |
| **Total** | **6** | **90 min** | — |

**Note (2025+):** Exam is a hybrid digital format — multiple choice completed in Bluebook app;
free-response handwritten in paper booklets. At least 2 FRQ questions incorporate a real-world
context or scenario. Questions span analytical, graphical, tabular, and verbal representations.

### Unit Weighting (% of AP Exam score)
| Unit | Title | Exam Weight | Suggested Periods |
|------|-------|-------------|-------------------|
| 1 | Limits and Continuity | 10–12% | 22–23 |
| 2 | Differentiation: Definition and Fundamental Properties | 10–12% | 13–14 |
| 3 | Differentiation: Composite, Implicit, and Inverse Functions | 9–13% | 10–11 |
| 4 | Contextual Applications of Differentiation | 10–15% | 10–11 |
| 5 | Analytical Applications of Differentiation | 15–18% | 15–16 |
| 6 | Integration and Accumulation of Change | 17–20% | 18–20 |
| 7 | Differential Equations | 6–12% | 8–9 |
| 8 | Applications of Integration | 10–15% | 19–20 |

**Source:** College Board CED (Fall 2020); confirmed against UWorld and Albert.io guides.

---

## Section 2 — Mathematical Practices (MPACs)

The College Board defines 4 overarching Mathematical Practices (updated in 2019 CED from the
original 6 MPACs). All exam questions are coded to one or more of these practices.

| # | Practice | Description |
|---|----------|-------------|
| 1 | **Implementing Mathematical Processes** | Select and apply appropriate procedures, algorithms, and formulas; execute computations correctly; maintain precision; specify units. |
| 2 | **Connecting Representations** | Translate among analytical, graphical, tabular, and verbal forms (Rule of Four); select the most useful representation for a given task. |
| 3 | **Justification** | Provide reasoning for claims; use definitions and theorems to support conclusions; construct mathematical arguments; test conjectures. |
| 4 | **Communication and Notation** | Use correct mathematical notation, symbols, and language; explain reasoning in context; evaluate others' mathematical reasoning. |

**Note on the older 6-MPAC framework:** The 2016 CED listed 6 MPACs
(Reasoning with Definitions/Theorems; Connecting Concepts; Implementing Algebraic/Computational
Processes; Connecting Multiple Representations; Building Notational Fluency; Communicating).
The 2019/2020 CED consolidates these into 4. Both frameworks remain visible in legacy materials.

---

## Section 3 — Per-Unit Topic Tables

### Yield scoring rubric
`yield = f(unit_weight × topic_centrality × FRQ_appearance_frequency)`
- **0.9–1.0:** Must-know; appears nearly every exam year; high weighting unit
- **0.7–0.89:** Core topic; frequent exam appearance; heavily assessed
- **0.5–0.69:** Mid-tier; appears some years; important for conceptual chain
- **0.3–0.49:** Lower frequency; tested in multi-part sub-questions or conceptually supporting
- **0.1–0.29:** Rarely tested directly; foundational vocabulary or BC-adjacent formality

BC-only topics (6.11–6.13, 7.5, 7.9) are excluded from all yield scores — they do not appear on AB.

---

### Unit 1 — Limits and Continuity (10–12%)

**FRQ frequency (2012–2025):** ~7 direct FRQ appearances (lowest of all units); limits appear as
sub-parts in ~40% of all FRQs (L'Hopital, IVT invocations, asymptotic behavior).

| Topic | Name | Learning Objective (summary) | Yield | Rationale |
|-------|------|------------------------------|-------|-----------|
| 1.1 | Introducing Calculus: Can Change Occur at an Instant? | Motivate the limit concept by examining average vs instantaneous rate of change informally. | 0.15 | Conceptual framing only; never directly tested; unit weight 10-12% but this topic adds no exam points alone. |
| 1.2 | Defining Limits and Using Limit Notation | Express and interpret limits symbolically; distinguish one-sided from two-sided limits. | 0.55 | Limit notation fluency underpins every downstream unit; appears in MC as notation interpretation. |
| 1.3 | Estimating Limit Values from Graphs | Read or approximate limit values from a function graph, including one-sided cases. | 0.65 | Graph-reading limits appear frequently in MC Part A; visual limit problems test representation skills. |
| 1.4 | Estimating Limit Values from Tables | Approximate limits using a table of function values. | 0.60 | Table-based limit reading is standard MC format; often appears alongside numerical rate-of-change. |
| 1.5 | Determining Limits Using Algebraic Properties | Apply sum, product, quotient, and composition limit laws to evaluate limits of combined functions. | 0.70 | Algebraic limit manipulation is tested directly in MC; prerequisite for all derivative evaluation. |
| 1.6 | Determining Limits Using Algebraic Manipulation | Factor, rationalize, or rewrite expressions (e.g., difference quotient) to resolve 0/0 forms. | 0.75 | High-frequency MC topic; factoring/rationalizing limits appears every year; prerequisite for derivative definition. |
| 1.7 | Selecting Procedures for Determining Limits | Choose the appropriate technique (direct substitution, factoring, squeeze, L'Hopital) for a given limit. | 0.60 | Strategy-selection questions appear in MC; connects to L'Hopital in Unit 4. |
| 1.8 | Determining Limits Using the Squeeze Theorem | Apply the squeeze theorem to evaluate limits of functions bounded above and below. | 0.45 | Squeeze theorem (sin x / x) is a classic limit; appears as a MC sub-topic roughly every 2 years; FRQ appearance in 2019 Q6. |
| 1.9 | Connecting Multiple Representations of Limits | Reconcile graph, table, and analytic information to determine or verify a limit. | 0.55 | Multi-representation problems are a core exam skill (MP2); medium MC frequency. |
| 1.10 | Exploring Types of Discontinuities | Identify and classify removable, jump, and infinite (vertical asymptote) discontinuities. | 0.65 | Discontinuity classification appears in MC most years; connects to piecewise function analysis. |
| 1.11 | Defining Continuity at a Point | Apply the three-part definition of continuity (limit exists, f(c) defined, equal); identify failures. | 0.70 | Continuity at a point is tested directly; appears as FRQ sub-part asking to justify continuity or find k values. |
| 1.12 | Confirming Continuity Over an Interval | Determine intervals of continuity using function family properties (polynomials, rationals, trig). | 0.50 | Less directly tested; conceptually supports IVT and EVT applications. |
| 1.13 | Removing Discontinuities | Find values that make a piecewise or rational function continuous (algebraically remove a hole). | 0.65 | Classic MC problem type; "find c so that f is continuous" appears nearly every year. |
| 1.14 | Infinite Limits and Vertical Asymptotes | Evaluate one-sided limits that diverge to ±∞; connect to vertical asymptotes. | 0.60 | Infinite-limit MC problems appear regularly; connects to rational function behavior. |
| 1.15 | Limits at Infinity and Horizontal Asymptotes | Determine end behavior of rational, exponential, and composite functions using dominant-term analysis. | 0.65 | Horizontal asymptote via limits appears in MC every year; particle motion and DE questions use end behavior. |
| 1.16 | Intermediate Value Theorem (IVT) | Apply IVT to guarantee the existence of a value on an interval given continuity; justify existence claims. | 0.70 | IVT justification appears as an FRQ sub-part most years (2019 Q4, 2022 Q4, etc.); MC tests IVT conditions. |

---

### Unit 2 — Differentiation: Definition and Fundamental Properties (10–12%)

**FRQ frequency (2012–2025):** ~23 FRQ appearances; foundational to nearly every FRQ part.

| Topic | Name | Learning Objective (summary) | Yield | Rationale |
|-------|------|------------------------------|-------|-----------|
| 2.1 | Defining Average and Instantaneous Rates of Change at a Point | Compute the average rate of change over an interval and connect to the slope of a secant line; motivate the instantaneous rate as a limit. | 0.70 | Rate-of-change interpretation appears in contextual FRQs every year; tables of values require this skill. |
| 2.2 | Defining the Derivative of a Function and Using Derivative Notation | Express the derivative as a limit of a difference quotient; use f'(x), dy/dx, and d/dx notation interchangeably. | 0.75 | Limit definition of derivative appears in MC; notation fluency required on every derivative question. |
| 2.3 | Estimating Derivatives of a Function at a Point | Estimate f'(a) numerically from a table or graphically from a tangent line slope. | 0.70 | Table-based derivative estimation is a standard FRQ Part A sub-task (e.g., 2024 Q1, 2023 Q3). |
| 2.4 | Connecting Differentiability and Continuity | Understand that differentiability implies continuity but not vice versa; identify non-differentiable points (corners, cusps, vertical tangents). | 0.65 | Appears in MC and FRQ as a justification task; "explain why f is or is not differentiable at x = a." |
| 2.5 | Applying the Power Rule | Differentiate power functions using d/dx(x^n) = nx^(n-1); extend to negative and fractional exponents. | 0.85 | Power rule is used in nearly every differentiation problem on the exam; extremely high frequency. |
| 2.6 | Derivative Rules: Constant, Sum, Difference, and Constant Multiple | Apply linearity of differentiation to polynomial and combined functions. | 0.85 | Prerequisite for all computational derivative work; tested implicitly in every derivative question. |
| 2.7 | Derivatives of cos(x), sin(x), e^x, and ln(x) | Apply standard derivative formulas for trigonometric and transcendental functions. | 0.90 | These four formulas appear on virtually every AP exam in both MC and FRQ; essential fluency. |
| 2.8 | The Product Rule | Differentiate a product of two functions: (fg)' = f'g + fg'. | 0.85 | Product rule appears in ~60% of derivative-heavy FRQ parts; tested in MC explicitly. |
| 2.9 | The Quotient Rule | Differentiate a quotient: (f/g)' = (f'g − fg') / g². | 0.80 | Quotient rule is heavily tested in MC; appears in implicit differentiation and related rates setups. |
| 2.10 | Derivatives of tan(x), cot(x), sec(x), and csc(x) | Apply derived formulas for the remaining trig functions (derived from quotient rule + sin/cos). | 0.75 | All six trig derivatives appear in MC; sec²(x) formula is particularly common. |

---

### Unit 3 — Differentiation: Composite, Implicit, and Inverse Functions (9–13%)

**FRQ frequency (2012–2025):** ~15 FRQ appearances; chain rule embedded in nearly every complex FRQ.

| Topic | Name | Learning Objective (summary) | Yield | Rationale |
|-------|------|------------------------------|-------|-----------|
| 3.1 | The Chain Rule | Differentiate composite functions: d/dx[f(g(x))] = f'(g(x)) · g'(x). | 0.95 | Highest single-topic yield on the exam. Chain rule is embedded in every composite derivative, every implicit differentiation, every DE solution. Appears in nearly 100% of FRQs. |
| 3.2 | Implicit Differentiation | Differentiate an equation in x and y implicitly; solve for dy/dx using the chain rule on y terms. | 0.85 | Implicit differentiation appears as an FRQ question in most years (2021 Q5, 2023 Q6, 2024 Q5, 2025 Q6); also heavily tested in MC. |
| 3.3 | Differentiating Inverse Functions | Apply the inverse function derivative formula: (f⁻¹)'(a) = 1 / f'(f⁻¹(a)). | 0.65 | Appears in MC most years; occasionally appears as an FRQ sub-part. |
| 3.4 | Differentiating Inverse Trigonometric Functions | Apply derivatives of arcsin, arccos, arctan, etc.; combine with chain rule. | 0.70 | Inverse trig derivatives appear in MC regularly; arctan derivative appears frequently in u-sub setups. |
| 3.5 | Selecting Procedures for Calculating Derivatives | Identify which differentiation rule(s) to apply when multiple are needed; combine chain, product, quotient, implicit. | 0.75 | Strategy questions appear in MC; any "find dy/dx" problem on FRQ requires this skill. |
| 3.6 | Calculating Higher-Order Derivatives | Compute f''(x), f'''(x); interpret second derivative in terms of concavity and acceleration. | 0.80 | Second derivative is tested in every concavity/inflection FRQ question (Unit 5); acceleration problems require f'' in particle motion. |

---

### Unit 4 — Contextual Applications of Differentiation (10–15%)

**FRQ frequency (2012–2025):** ~37 FRQ appearances (second highest); contextual applications dominate FRQ Part A (calculator) section.

| Topic | Name | Learning Objective (summary) | Yield | Rationale |
|-------|------|------------------------------|-------|-----------|
| 4.1 | Interpreting the Meaning of the Derivative in Context | State what f'(x) represents in applied terms, including units; interpret sign and magnitude contextually. | 0.80 | Interpretation sub-parts appear in almost every applied FRQ; "what does f'(3) represent?" is a standard task. |
| 4.2 | Straight-Line Motion: Connecting Position, Velocity, and Acceleration | Use derivatives to relate s(t), v(t) = s'(t), and a(t) = v'(t); determine direction, speed, speeding up/slowing down. | 0.90 | Particle motion is the single most common FRQ archetype; appears in ~80% of exam years (2021 Q2, 2022 Q6, 2023 Q2, 2024 Q2, 2025 Q5). |
| 4.3 | Rates of Change in Applied Contexts Other Than Motion | Interpret and compute derivatives in population, temperature, volume, and flow-rate contexts. | 0.80 | Every table-based or contextual FRQ tests this; 2021 Q1 bacteria density, 2024 Q1 coffee temperature. |
| 4.4 | Introduction to Related Rates | Set up a related-rates problem from a geometric or physical relationship; differentiate implicitly with respect to t. | 0.75 | Related rates appear as FRQ or MC sub-parts most years (2022 Q2, 2023 Q6, 2024 Q5, 2025 Q6). |
| 4.5 | Solving Related Rates Problems | Execute the full related-rates procedure: draw, write equation, differentiate, substitute known values, solve. | 0.75 | Same as 4.4 — setup and solve are tested together; earn partial credit on multi-part FRQ. |
| 4.6 | Approximating Values of a Function Using Local Linearity and Linearization | Build a tangent-line approximation L(x) = f(a) + f'(a)(x−a); assess over/under-estimate using concavity. | 0.55 | Linearization appears in MC and occasionally as FRQ sub-part; over/under-estimate justification requires concavity knowledge. |
| 4.7 | Using L'Hôpital's Rule for Determining Limits of Indeterminate Forms | Apply L'Hôpital's Rule to 0/0 or ∞/∞ indeterminate forms; recognize eligible forms. | 0.75 | L'Hôpital appears in FRQ sub-parts (2019 Q6, 2021 Q4) and MC; tests both computational skill and form-recognition. |

---

### Unit 5 — Analytical Applications of Differentiation (15–18%)

**FRQ frequency (2012–2025):** ~38 FRQ appearances (highest of all units); every graph-analysis FRQ belongs here.

| Topic | Name | Learning Objective (summary) | Yield | Rationale |
|-------|------|------------------------------|-------|-----------|
| 5.1 | Using the Mean Value Theorem | Apply MVT to guarantee the existence of c where f'(c) = average rate; state required hypotheses (continuity, differentiability). | 0.80 | MVT justification appears in FRQ every 1–2 years (2023 Q1, 2019 Q2); MC tests MVT conditions frequently. |
| 5.2 | Extreme Value Theorem, Global vs Local Extrema, and Critical Points | Apply EVT on a closed interval; locate critical points (f'(c) = 0 or undefined). | 0.80 | Critical point identification is the entry step for every optimization and extrema FRQ. |
| 5.3 | Determining Intervals on Which a Function Is Increasing or Decreasing | Use the sign of f'(x) on a number line to classify intervals of increase/decrease. | 0.85 | Sign-chart analysis of f' appears on almost every FRQ graph-analysis question; tested in MC every year. |
| 5.4 | Using the First Derivative Test to Determine Relative (Local) Extrema | Classify relative max/min by sign change of f' at a critical point. | 0.85 | First derivative test is among the most-tested skills in AP Calc AB; appears in MC and FRQ justification tasks. |
| 5.5 | Using the Candidates Test to Determine Absolute (Global) Extrema | Find absolute extrema on a closed interval by evaluating f at all critical points and endpoints. | 0.80 | Candidates test appears whenever a closed interval is given; optimization FRQs rely on this. |
| 5.6 | Determining Concavity of Functions Over Their Domains | Use the sign of f''(x) to classify concavity; identify inflection points where f'' changes sign. | 0.85 | Concavity and inflection points appear in every graph-analysis FRQ; tested explicitly in MC. |
| 5.7 | Using the Second Derivative Test to Determine Extrema | Classify a critical point via the sign of f''(c). | 0.70 | Second derivative test is tested in MC; less common than first derivative test in FRQ justifications. |
| 5.8 | Sketching Graphs of Functions and Their Derivatives | Connect graph features of f, f', and f'' to each other; infer f from a graph of f'. | 0.85 | Graph-of-f'-analysis is a standard FRQ archetype (2023 Q4, 2022 Q3); appears in MC every year. |
| 5.9 | Connecting a Function, Its First Derivative, and Its Second Derivative | Synthesize increasing/decreasing, concavity, and extrema analysis across all three functions simultaneously. | 0.85 | Cross-graph analysis is the core of graph-analysis FRQs; requires simultaneous reasoning about f, f', f''. |
| 5.10 | Introduction to Optimization Problems | Translate a word problem into a function to optimize; identify the objective function and constraint. | 0.75 | Optimization setup is tested in MC and FRQ (2021 Q3, 2025 Q1 sub-part). |
| 5.11 | Solving Optimization Problems | Execute the full optimization: find domain, differentiate, find critical points, apply candidates test, verify. | 0.75 | Full optimization FRQ sub-parts appear roughly every 2 years; MC tests applied optimization. |
| 5.12 | Exploring Behaviors of Implicit Relations | Analyze implicit curves — find horizontal/vertical tangents, determine concavity, sketch local behavior. | 0.65 | Implicit curve behavior appears in FRQ (2023 Q6, 2024 Q5, 2025 Q6); connects implicit differentiation to curve analysis. |

---

### Unit 6 — Integration and Accumulation of Change (17–20%)

**FRQ frequency (2012–2025):** ~25 FRQ appearances; FTC and u-sub appear as sub-parts in nearly every accumulation/area/DE FRQ.

**Note:** Topics 6.11 (integration by parts), 6.12 (linear partial fractions), and 6.13 (improper integrals) are **BC-only** and excluded here.

| Topic | Name | Learning Objective (summary) | Yield | Rationale |
|-------|------|------------------------------|-------|-----------|
| 6.1 | Exploring Accumulation of Change | Interpret the definite integral as accumulated change; connect area under a rate curve to net change. | 0.70 | Conceptual foundation for all integration applications; tested in MC and accumulation FRQs. |
| 6.2 | Approximating Areas with Riemann Sums | Use left, right, midpoint, and trapezoidal Riemann sums to approximate definite integrals; assess over/under estimates. | 0.85 | Riemann sum approximation from a table appears in nearly every exam year as FRQ sub-part (2023 Q1, 2021 Q1). |
| 6.3 | Riemann Sums, Summation Notation, and Definite Integral Notation | Connect Riemann sum notation to integral notation; interpret ∫ₐᵇ f(x)dx as a limit of Riemann sums. | 0.75 | Integral notation and interpretation appear in MC every year; required to write correct integral expressions in FRQ. |
| 6.4 | The Fundamental Theorem of Calculus and Accumulation Functions | Differentiate F(x) = ∫ₐˣ f(t) dt (FTC Part 1); apply chain rule when upper limit is g(x). | 0.90 | FTC Part 1 is among the highest-frequency skills; appears in FRQ every year (2021 Q4, 2025 Q4); MC tests it constantly. |
| 6.5 | Interpreting the Behavior of Accumulation Functions Involving Area | Analyze F(x) = ∫f in terms of f's graph — where F is increasing, concave, has extrema. | 0.85 | Accumulation function analysis FRQ is a near-annual archetype; tests synthesis of FTC + graph analysis. |
| 6.6 | Applying Properties of Definite Integrals | Use linearity, interval reversal, and split-interval properties to evaluate or simplify integrals. | 0.75 | Properties of integrals appear in MC every year; used to evaluate integrals from a graph or table. |
| 6.7 | The Fundamental Theorem of Calculus and Definite Integrals | Evaluate ∫ₐᵇ f(x)dx = F(b) − F(a) using antiderivatives (FTC Part 2). | 0.90 | FTC Part 2 is the workhorse evaluation rule; used in virtually every definite integral computation. |
| 6.8 | Finding Antiderivatives and Indefinite Integrals: Basic Rules | Apply power rule in reverse, and standard formulas for trig, e^x, and 1/x antiderivatives; include +C. | 0.90 | Antiderivative computation appears in every integration FRQ and MC; foundational for all of Units 7–8. |
| 6.9 | Integrating Using Substitution | Apply u-substitution to transform and evaluate indefinite and definite integrals. | 0.90 | U-substitution is the primary integration technique on the AB exam; appears in MC and as an FRQ sub-step every year. |
| 6.10 | Integrating Using Long Division and Completing the Square | Rewrite an improper rational integrand using polynomial long division or complete the square to enable integration. | 0.45 | Less frequently tested directly; appears in MC roughly every 2–3 years. |
| 6.14 | Selecting Techniques for Antidifferentiation | Identify the appropriate technique (substitution, basic rules, algebraic manipulation) for a given integrand. | 0.65 | Strategy-selection MC questions test this; less commonly tested in isolation. |

---

### Unit 7 — Differential Equations (6–12%)

**FRQ frequency (2012–2025):** ~9 direct FRQ appearances (lowest among later units); however, the DE question
has been present on almost every exam as its own dedicated FRQ slot (Q3 or Q5/Q6 in the no-calc section).

**Note:** Topic 7.5 (Euler's Method) and 7.9 (Logistic Models) are **BC-only** and excluded here.

| Topic | Name | Learning Objective (summary) | Yield | Rationale |
|-------|------|------------------------------|-------|-----------|
| 7.1 | Modeling Situations with Differential Equations | Translate a verbal description or rate-of-change relationship into a differential equation; interpret solutions. | 0.70 | DE modeling appears in the dedicated FRQ slot (2023 Q3 milk cooling, 2024 Q3 seawater); also in MC. |
| 7.2 | Verifying Solutions to Differential Equations | Substitute a proposed solution function into the DE to confirm it satisfies the equation. | 0.60 | Verification appears as an FRQ sub-part and in MC; requires derivative computation and substitution. |
| 7.3 | Sketching Slope Fields | Draw a slope field for a given DE by plotting short tangent segments; interpret the slope field to describe solution behavior. | 0.75 | Slope field sketch or matching appears in almost every DE FRQ (2022 Q5, 2023 Q3, etc.); also in MC. |
| 7.4 | Reasoning Using Slope Fields | Use a slope field to identify solution behavior (long-term, equilibrium, direction); match DE to slope field. | 0.70 | Slope-field matching MC appears every year; FRQ asks about long-run behavior from a slope field. |
| 7.6 | General Solutions Using Separation of Variables | Separate variables (dy on one side, dx on the other) and integrate both sides; solve for y. | 0.85 | Separation of variables is the core AB differential equation technique; appears in FRQ every year (2022 Q5, 2023 Q3, 2024 Q3). |
| 7.7 | Finding Particular Solutions Using Initial Conditions and Separation of Variables | Apply an initial condition to determine the constant of integration; write the particular solution. | 0.85 | Particular solution determination is a standard FRQ sub-part; always accompanies separation of variables. |
| 7.8 | Exponential Models with Differential Equations | Solve dy/dt = ky to get y = Ce^(kt); interpret k (growth/decay constant) and C (initial value) in context. | 0.80 | Exponential growth/decay model appears in MC every year; FRQ sub-parts ask to set up or interpret this model. |

---

### Unit 8 — Applications of Integration (10–15%)

**FRQ frequency (2012–2025):** ~30 FRQ appearances (third highest); area/volume and accumulation/particle motion
are the two dominant FRQ archetypes for this unit.

| Topic | Name | Learning Objective (summary) | Yield | Rationale |
|-------|------|------------------------------|-------|-----------|
| 8.1 | Finding the Average Value of a Function on an Interval | Compute f_avg = (1/(b−a)) ∫ₐᵇ f(x) dx; interpret in context (e.g., average temperature). | 0.75 | Average value appears in MC every year and as an FRQ sub-part (2025 Q1 invasive species, 2024 Q1 coffee). |
| 8.2 | Connecting Position, Velocity, and Acceleration of Functions Using Integrals | Recover position from velocity by integrating; distinguish net displacement (signed) from total distance (unsigned, split at sign changes). | 0.90 | Total distance vs displacement is a perennial particle motion FRQ skill; tested every year in Part A. |
| 8.3 | Using Accumulation Functions and Definite Integrals in Applied Contexts | Compute net change via ∫ rate dt; interpret accumulated quantity in real-world scenarios (flow in/out). | 0.85 | Rate-accumulation FRQs appear every year; 2019 Q1 fish, 2021 Q1 bacteria, 2023 Q1 gasoline, 2025 Q3 reading rates. |
| 8.4 | Finding the Area Between Curves Expressed as Functions of x | Set up and evaluate ∫[f(x) − g(x)] dx for regions bounded by two curves; identify intersection points. | 0.90 | Area between curves is one of the most tested FRQ topics; appears as standalone or sub-part in ~70% of exam years (2025 Q2, 2024 Q6, 2022 Q2). |
| 8.5 | Finding the Area Between Curves Expressed as Functions of y | Integrate with respect to y for horizontally-oriented regions; set up integral as ∫[right − left] dy. | 0.60 | Integration with respect to y appears in MC and occasionally FRQ; less frequent than x-integration. |
| 8.6 | Finding the Area Between Curves That Intersect at More Than Two Points | Split the region at all intersection points; set up a sum of integrals to capture the full area. | 0.60 | Multi-intersection area problems appear in MC; occasionally appear in FRQ when curves intersect more than twice. |
| 8.7 | Volumes with Cross Sections: Squares and Rectangles | Set up V = ∫ A(x) dx where A(x) is the area of a square or rectangular cross section perpendicular to an axis. | 0.75 | Cross-section volume with squares appears in FRQ regularly (2024 Q6 cross-section with h = b/2). |
| 8.8 | Volumes with Cross Sections: Triangles and Semicircles | Set up V = ∫ A(x) dx where A(x) is the area of an equilateral triangle or semicircle. | 0.65 | Triangular/semicircular cross sections appear in MC and occasionally FRQ. |
| 8.9 | Volume with Disc Method: Revolving Around the x- or y-Axis | Compute V = π ∫[f(x)]² dx for a solid of revolution around the x-axis (or analogous for y-axis). | 0.85 | Disc method is a high-frequency topic; appears in FRQ and MC most years, often combined with area question. |
| 8.10 | Volume with Disc Method: Revolving Around Other Axes | Adjust the disc radius for a horizontal or vertical axis that is not x=0 or y=0 (e.g., y = k). | 0.65 | Non-standard axes appear in MC; occasionally FRQ (washer or disc around y = 2 style). |
| 8.11 | Volume with Washer Method: Revolving Around the x- or y-Axis | Compute V = π ∫([f(x)]² − [g(x)]²) dx for a solid with a hole; identify outer and inner radii. | 0.85 | Washer method is among the most-tested volume techniques; appears in FRQ most years (2022 Q2, 2025 Q2). |
| 8.12 | Volume with Washer Method: Revolving Around Other Axes | Adjust outer/inner radii when the axis of revolution is not x=0 or y=0. | 0.65 | Appears in MC; occasionally FRQ for axes like y = −1. |
| 8.13 | Arc Length and Distance Traveled Along a Smooth Curve | Compute arc length as ∫√(1 + [f'(x)]²) dx; interpret as total distance along a path. | 0.35 | Arc length is only tested via the general arc length integral formula; appears as an occasional MC or FRQ concept but is not a high-frequency standalone question. |

---

## Section 4 — FRQ Archetype Frequency Analysis

Based on released exams 2019–2025 and published frequency analyses (Nerd Notes, Calculus Masters).

### The 7 Core FRQ Archetypes

| Archetype | Freq | Calculator | Primary Units | Recent Appearances |
|-----------|------|-----------|---------------|--------------------|
| **1. Rate/Data from Tables** | Every year | Both | 2, 4, 6, 8 | 2019 Q2, 2021 Q1, 2023 Q1, 2024 Q1, 2025 Q3 |
| **2. Particle Motion** | Most years (4–5 of last 6) | Part A (calc) | 4, 8 | 2021 Q2, 2022 Q6, 2023 Q2, 2024 Q2, 2025 Q5 |
| **3. Area & Volume** | Most years | Part A (calc) | 8 | 2022 Q2, 2024 Q6, 2025 Q2 |
| **4. Accumulation / FTC Graph Analysis** | Most years | Both | 6, 8 | 2021 Q4, 2025 Q4 |
| **5. Graph Analysis (f and f')** | Most years | No-calc | 5 | 2022 Q3, 2023 Q4 |
| **6. Differential Equations / Slope Fields** | Most years | No-calc | 7 | 2022 Q5, 2023 Q3, 2024 Q3 |
| **7. Implicit Differentiation / Related Rates / Curve Analysis** | Some years | No-calc | 3, 4, 5 | 2021 Q5, 2023 Q6, 2024 Q5, 2025 Q6 |

### Detailed Archetype Descriptions

**Archetype 1: Rate/Data from Tables**
Context: A real-world rate (vehicles per hour, bacteria per cm², gallons per minute) is given as a table of
values at selected time points. Sub-tasks: (a) estimate a derivative using a difference quotient or MVT
justification; (b) compute or approximate a Riemann sum; (c) interpret the integral ∫rate dt as accumulated
quantity; (d) compute or compare average rate. Appears in the calculator section (Part A) and no-calculator
section (Part B) in different years. Requires: Units 2, 4, 6, 8.

**Archetype 2: Particle Motion**
Context: A particle moves along the x-axis with position s(t) or velocity v(t) given analytically or graphically.
Sub-tasks: (a) find velocity/acceleration at a given time; (b) determine direction of motion or when motion
changes direction; (c) find total distance traveled (integrate |v(t)|, split at sign changes); (d) find position at
time t given s(0). Calculator-active (Part A) — numerical integration of complicated v(t) is expected.
Requires: Units 4, 8.

**Archetype 3: Area and Volume**
Context: Two curves bound a region R; students find area and then set up or compute volume.
Sub-tasks: (a) find intersection points; (b) compute area between curves; (c) set up disc/washer or
cross-section integral for volume; (d) sometimes includes a related-rates or tangent-line sub-part.
Calculator-active version computes numerically; no-calculator version uses simple curves.
Requires: Unit 8 (8.4, 8.7–8.12).

**Archetype 4: Accumulation / FTC Graph Analysis**
Context: A function F(x) = ∫ₐˣ f(t) dt is defined via an area function (often with a graph of f given).
Sub-tasks: (a) find F'(x) or F''(x) using FTC Part 1 (± chain rule); (b) locate extrema and inflection points
of F using sign of f; (c) compute F(b) using FTC Part 2; (d) occasionally includes L'Hôpital or limit.
Requires: Units 5, 6.

**Archetype 5: Graph Analysis (f and f')**
Context: A graph of f' (or f'') is provided; students must analyze properties of f.
Sub-tasks: (a) find relative extrema of f using first derivative test; (b) find inflection points of f using sign
change of f'; (c) determine concavity; (d) find or compare values of f using area under the curve (FTC Part 2).
No calculator. Requires: Units 5, 6.

**Archetype 6: Differential Equations / Slope Fields**
Context: A differential equation dy/dx = g(x,y) is given.
Sub-tasks: (a) sketch or interpret slope field; (b) verify or identify long-run behavior from slope field;
(c) separate variables and integrate to find general solution; (d) apply initial condition to find particular
solution; (e) analyze or interpret solution in context. No calculator.
Requires: Unit 7.

**Archetype 7: Implicit Differentiation / Related Rates / Curve Analysis**
Context: An implicitly defined curve or a geometric relationship is given.
Sub-tasks: (a) find dy/dx via implicit differentiation; (b) find horizontal or vertical tangent lines;
(c) set up a related-rates equation with respect to t; (d) analyze concavity or behavior of the implicit curve.
Appears in no-calculator section.
Requires: Units 3, 4, 5.

### Unit-Level FRQ Frequency (2012–2025 cumulative, Nerd Notes data)
| Unit | FRQ Appearances |
|------|-----------------|
| 5 — Analytical Applications of Differentiation | ~38 |
| 4 — Contextual Applications of Differentiation | ~37 |
| 8 — Applications of Integration | ~30 |
| 6 — Integration and Accumulation | ~25 |
| 2 — Differentiation: Definition and Fundamental Properties | ~23 |
| 3 — Composite, Implicit, and Inverse | ~15 |
| 7 — Differential Equations | ~9 |
| 1 — Limits and Continuity | ~7 |

---

## Section 5 — Prerequisite Dependency Graph

### 5A: Precalculus Prerequisites by Calc Unit

Each entry lists the precalculus knowledge that, if absent, will block student understanding of that calc unit.

**Unit 1 — Limits and Continuity**
- Function families and their graphs (polynomial, rational, piecewise, absolute value, trig, exponential, log)
- Evaluating functions: function notation f(x), substitution, domain restrictions
- Rational functions: factoring numerator/denominator, identifying holes vs. vertical asymptotes
- Piecewise functions: reading and evaluating at boundary points
- Exact trig values at standard angles (0, π/6, π/4, π/3, π/2, π); unit circle
- One-sided behavior of functions (end behavior, asymptotic approach)
- Concept of equality vs. approach (precursor to limit intuition)

**Unit 2 — Differentiation: Definition and Fundamental Properties**
- Slope of a line (slope formula, slope as rate of change)
- Secant line construction from two points on a curve
- Average rate of change = Δy/Δx
- Polynomial algebra: expanding, factoring, simplifying rational expressions
- Limit algebra (Unit 1 prerequisite complete)
- Fractional and negative exponents: rewriting radicals and reciprocals as power functions

**Unit 3 — Composite, Implicit, and Inverse Functions**
- Composition of functions: f(g(x)), identifying inner and outer function
- Inverse functions: existence criteria, reflection across y = x, f(f⁻¹(x)) = x
- Solving equations implicitly for y (algebra prerequisite for implicit setup)
- Inverse trigonometric functions: definitions, domains, ranges, values at key inputs

**Unit 4 — Contextual Applications of Differentiation**
- Units and dimensional analysis (rate = quantity/time)
- Similar triangles, Pythagorean theorem, area and volume formulas (for related-rates setups)
- Setting up equations from geometric or physical diagrams (ladder, cone, sphere, cylinder formulas)
- Proportional reasoning and algebraic relationships between quantities

**Unit 5 — Analytical Applications of Differentiation**
- Polynomial analysis: factoring, identifying roots, sign analysis of expressions
- Interval notation for domains and solution sets
- Inequality solving (sign charts for rational and polynomial expressions)
- Interpreting graphs: reading maxima, minima, increasing/decreasing from a graph
- Understanding that zeros of the derivative correspond to horizontal tangents

**Unit 6 — Integration and Accumulation of Change**
- Summation (Σ) notation and arithmetic series (for Riemann sum setup)
- Area of rectangles and trapezoids (foundational for Riemann sum approximation)
- Algebraic manipulation to rewrite integrands (completing the square, long division, trig identities)
- Reverse power rule intuition: "what function has derivative x^n?"
- All of Units 2–3 (antiderivatives require fluent differentiation)

**Unit 7 — Differential Equations**
- Separation of variables requires: fraction algebra, rearranging equations, integral familiarity (Unit 6)
- Exponential functions: solving exponential equations, understanding e^(kt) growth/decay structure
- Logarithmic functions: ln(x) properties, solving for x in exponential/log equations
- Slope concept (slope field relies on slope interpretation at a point)

**Unit 8 — Applications of Integration**
- Area of planar regions (rectangles, combined shapes) for intuition behind definite integrals
- Distance = rate × time (foundational for accumulation and particle motion)
- Geometric volume formulas (sphere, cylinder, cone) — sometimes used in related-rates cross-reference
- Intersection of curves (solve f(x) = g(x) algebraically) for area-between-curves setup
- Disk/washer method requires: circle area formula (πr²), power rule integration, careful algebra for radii

### 5B: Within-Calculus Dependency Chain

The following DAG shows which calc units are **direct prerequisites** for understanding a later unit.
The adaptive diagnostic should infer: "if a student is weak in unit X, they are likely also weak in unit Y."

```
Unit 1 (Limits) ──────────────────────────────────────────────────┐
     │                                                              │
     ▼                                                              ▼
Unit 2 (Derivative Definition) ──────────────────────────────> Unit 5 (Analytical Apps)
     │                                                              │
     ▼                                                              │
Unit 3 (Chain/Implicit/Inverse) ──────────────────────────────────┘
     │                                                              │
     ├──────────────────────────────────────────────────────────────┘
     ▼                                                              │
Unit 4 (Contextual Apps) <────────────────────────────────────────┘
     │
     │  [Units 1-4 fully required for Unit 6]
     ▼
Unit 6 (Integration) ─────────────────────────────────────────────┐
     │                                                              │
     ▼                                                              ▼
Unit 7 (Differential Equations) ──────────────────────> Unit 8 (Applications of Integration)
```

**Detailed edges:**

| Later Unit | Requires | Dependency Reason |
|------------|----------|--------------------|
| Unit 2 | Unit 1 | Derivative definition uses limit; differentiability uses continuity |
| Unit 3 | Unit 2 | Chain rule builds on basic derivative rules; implicit uses all of Unit 2 |
| Unit 4 | Units 2, 3 | All contextual apps require derivative computation including chain/implicit |
| Unit 5 | Units 2, 3, 4 | MVT/EVT require continuity (Unit 1), derivatives (Unit 2), higher-order (Unit 3) |
| Unit 6 | Units 1, 2, 3 | Antiderivatives require fluent differentiation; FTC uses limits; u-sub uses chain rule |
| Unit 7 | Units 2, 3, 6 | DEs require: setting up derivatives, solving by integrating (Unit 6), chain rule in separation |
| Unit 8 | Units 4, 5, 6 | Particle motion needs Unit 4; area analysis needs Unit 5 sign charts; all use integration (Unit 6) |

**Precalculus → Calculus gateway rules for adaptive diagnostic:**
- Weak on `function_families` (piecewise, rational) → flag weak on Unit 1 (limits of piecewise/rational functions)
- Weak on `trig_and_precalc_prerequisites` (unit circle, trig values) → flag weak on Units 1, 2, 3 (trig limits, trig derivatives)
- Weak on `exponent_and_log_skills` → flag weak on Units 2, 3, 6, 7 (derivatives and integrals of e^x, ln x)
- Weak on `numerical_and_algebra_prerequisites` (factoring, rational expressions) → flag weak on Unit 1 (algebraic limit manipulation), Unit 6 (long division, partial fractions)
- Weak on Unit 1 → very likely weak on Unit 2 (derivative definition is a limit)
- Weak on Unit 2 → very likely weak on all downstream units (derivative fluency is a global prerequisite)
- Weak on Unit 6 → very likely weak on Units 7 and 8

---

## Section 6 — Unverified Items and Known Gaps

The following could not be independently verified without direct PDF access to the College Board CED:

1. **Exact LO codes per topic** (e.g., "LO 1.1A", "EK 2.3C"): The CED uses a detailed LO/EK system
   (Learning Objectives and Essential Knowledge statements). These are cited in the text above using
   narrative summaries but the exact College Board code labels could not be confirmed from available
   web sources. For code-level grounding, download the official CED PDF directly.

2. **Exact topic counts for BC vs AB in Unit 7:** The CED designates 7.5 (Euler's Method) and 7.9
   (Logistic Models) as BC-only. This is confirmed by multiple prep sources. However, the exact CED
   page designation was not accessible from the compressed PDF.

3. **FRQ frequency counts before 2012:** The Nerd Notes aggregate counts (~7–38 per unit) are based
   on released exams in the current CED framework era. Earlier exams may use different unit designations.

4. **2025 exam individual FRQ question details:** The 2025 FRQ were summarized from two prep-site
   sources (num8ers.com, onlinemathlearning.com) and the College Board PDF (binary, unreadable).
   The broad topics are consistent across sources but exact problem statements are not confirmed here.

5. **Mathematical Practices official count (4 vs 6):** The 2016 CED listed 6 MPACs; the 2019/2020
   CED consolidates to 4 practices. Both counts appear in prep materials. The current exam uses 4 practices.
   This document uses the 4-practice framework as authoritative.

6. **Yield scores** are editorial judgments grounded in unit weighting × topic centrality × FRQ frequency,
   not a College Board-published metric. They should be treated as calibration signals, not absolute values.

---

## Section 7 — Quick-Reference Summary

| Fact | Value |
|------|-------|
| Total units (AB) | 8 |
| Total topics (AB, excluding BC-only) | ~58 |
| MC questions | 45 (30 no-calc + 15 calc) |
| FRQ questions | 6 (2 calc + 4 no-calc) |
| Exam weight: MC vs FRQ | 50% / 50% |
| Highest-weighted unit | Unit 6 (17–20%) |
| Highest FRQ-frequency unit | Unit 5 (~38 appearances, 2012–2025) |
| Most complex single topic | 3.1 Chain Rule (yield 0.95) |
| Most complex FRQ archetype | Particle Motion (most calculator-required) |
| BC-only topics excluded from AB | 6.11, 6.12, 6.13, 7.5, 7.9 |
| Mathematical Practices (current) | 4 (implementing, connecting, justifying, communicating) |
