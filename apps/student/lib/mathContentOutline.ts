/**
 * Math content outline for precalc + calc_ab, keyed by math category id.
 *
 * Sources: docs/math-research/precalc-outline.md (AP Precalculus CED topics,
 * foundations layer, FRQ archetypes) and docs/math-research/calc-ab-outline.md
 * (AP Calc AB CED topics, unit weightings, FRQ archetypes 2019–2025).
 *
 * Used to GROUND question/flashcard/lesson generation so generated content
 * matches the scope, depth, and canonical topics the real exams test.
 * Mirrors the shape and usage of mcatContentOutline.ts.
 *
 * All 19 category IDs from design-spec.md are covered:
 * Foundations F1–F7, AP Precalc P1–P4, Calc AB C1–C8.
 */

export interface MathOutlineEntry {
  /** Internal category code, e.g. "F1", "P1", "C3". */
  code: string;
  /** Category title. */
  title: string;
  /** One-paragraph scope statement. */
  focus: string;
  /** Canonical topics the exam/course tests for this area. */
  topics: string[];
  /** Exam weighting note (empty for foundations — they don't have direct exam weighting). */
  exam_weight?: string;
  /** FRQ archetypes relevant to this category (calc_ab only). */
  frq_archetypes?: string[];
}

export const MATH_CONTENT_OUTLINE: Record<string, MathOutlineEntry> = {
  // ─── Foundations F1–F7 ────────────────────────────────────────────────────

  number_systems: {
    code: "F1",
    title: "Number Systems and Properties",
    focus:
      "Real-number classification, arithmetic operations, and fundamental properties. " +
      "Provides the numeric fluency prerequisite for every downstream AP unit: signed-number " +
      "evaluation in function work, fraction arithmetic in rate-of-change calculations, " +
      "and order-of-magnitude reasoning in exponential contexts.",
    topics: [
      "Real Number Classification — membership in ℕ, ℤ, ℚ, irrational, ℝ; containment chain; decimal forms",
      "Number Representations — fractions, decimals, percents, place value, expanded form, scientific notation",
      "Integer Divisibility and Factor Structure — divisibility rules, factors, multiples, primes, prime factorization, GCF, LCM",
      "Signed Number Structure — opposites, absolute value, magnitude, number-line distance, sign of products/quotients",
      "Rational Number Arithmetic — fraction operations (unlike denominators), fraction multiplication/division, complex fractions",
      "Percent and Proportional Number Structure — percent as rate per hundred, percent of a number, percent increase/decrease, ratios, unit rates",
      "Real Number Order and Comparison — number-line location, ordering rational and irrational numbers, inequality symbols",
      "Real Number Operation Properties — commutative, associative, distributive, identity, inverse, zero, closure",
      "Numeric Expression Structure — order of operations, grouping symbols, exponent precedence, negative-base parentheses",
      "Approximation, Estimation, and Bounds — rounding, truncation, compatible numbers, bounds from rounded values",
    ],
    exam_weight: "Foundation — supports all AP units; signed-number and fraction fluency are load-bearing throughout",
  },

  algebraic_expressions: {
    code: "F2",
    title: "Algebraic Expressions",
    focus:
      "Algebraic expression structure, evaluation, manipulation, and equivalence. " +
      "Distribution and equivalent-expression skills are exercised in every symbolic-manipulation " +
      "task: polynomial manipulation (Unit 1), exponential rewriting (Unit 2), log manipulation (2.12), " +
      "trig identity work (3.12), and FRQ 4 (symbolic manipulations) on both exams.",
    topics: [
      "Algebraic Expression Structure — variables, constants, coefficients, terms, factors, monomials; expression vs. equation boundary",
      "Substitution into Expressions — single/multi-variable numeric substitution; negative/zero/fraction values; formula evaluation",
      "Like Terms and Term Collection — identifying like/unlike terms; combining integer/fraction/decimal coefficients",
      "Distribution and Expansion — distribution by positive/negative/fraction/variable factors; monomial over binomial/trinomial; nested distribution",
      "Equivalent Expression Properties — equivalence via collection/distribution; testing by substitution; coefficient matching",
      "Verbal-to-Symbolic Expression Structure — addition/subtraction/multiplication/division phrases; power phrases; consecutive-integer expressions",
      "Algebraic Expression Order and Grouping — precedence with variables; nested grouping; fraction-bar structure; power-vs-coefficient scope",
    ],
    exam_weight: "Foundation — distribution and equivalent expressions exercised in every unit; verbal-to-symbolic feeds modeling tasks",
  },

  linear_equations_and_inequalities: {
    code: "F3",
    title: "Linear Equations and Inequalities",
    focus:
      "Solving linear equations and inequalities, rearranging formulas, and interval notation. " +
      "Inverse-operation reasoning extends directly to solving exponential/log equations (2.13), " +
      "trig equations (3.10), and differential equations (Calc AB Unit 7). " +
      "Literal-equation fluency enables parameter extraction from function models in every modeling FRQ.",
    topics: [
      "Linear Equation Foundations — equation structure, solution meaning/verification, balance principle, properties of equality",
      "One-Step and Two-Step Linear Equations — signed, fraction, decimal coefficients; reverse operation order",
      "Multi-Step Linear Equations — like-term collection, distribution, variables on both sides, clearing fractions/decimals",
      "Literal Equations and Formula Rearrangement — isolating one variable, factoring out the target variable; standard formula rearrangement",
      "Linear Inequality Foundations — inequality symbols, properties of inequality (positive/negative multiplication), boundary values, interval notation",
      "One- and Two-Step Linear Inequalities — single inverse-operation inequalities; sign-flip requirement",
      "Multi-Step Linear Inequalities — distribution, like-term collection, no-solution/all-real cases",
      "Compound Linear Inequalities — AND/OR intervals, bounded solutions, contradictions, unions",
      "Linear Equation and Inequality Interpretation — identifying valid solution types, recognising special cases",
    ],
    exam_weight: "Foundation — solving equations feeds AP Precalc 2.13, 3.10; interval notation is the language of domain/range in all units",
  },

  systems_of_equations: {
    code: "F4",
    title: "Systems of Equations",
    focus:
      "Simultaneous equations and inequalities, graphical and algebraic solution methods. " +
      "Constructing function models from context (AP Precalc 1.14, 2.5, 2.14, 3.7) often requires " +
      "solving a 2×2 system to find model parameters; also used in rational-function work (1.9) " +
      "and sinusoidal model construction (3.7).",
    topics: [
      "Systems Foundations and Solution Sets — simultaneous solutions, ordered pairs, consistent/inconsistent, independent/dependent",
      "Graphical Systems of Linear Equations — intersection reading, slope-intercept/standard-form graphing, parallel/coincident cases",
      "Substitution Method — explicit variable, isolating before substituting, special cases",
      "Elimination Method — opposite/matching coefficients, scaling one/both equations, special cases",
      "Special-Case and Parameter Linear Systems — proportional coefficients, parameter values for 0/1/∞ solutions",
      "Three-Variable Linear Systems — elimination to two-variable system, back substitution, ordered triples",
      "Systems of Linear Inequalities — boundary lines, shading, overlap/feasible regions",
      "Nonlinear Systems of Equations — at least one nonlinear equation; intersection interpretation",
    ],
    exam_weight: "Foundation — medium-low direct AP signal; critical for model construction with two known conditions",
  },

  polynomials: {
    code: "F5",
    title: "Polynomials",
    focus:
      "Polynomial structure, operations, factoring, and root analysis. " +
      "AP Precalculus Unit 1 is built almost entirely on polynomial algebra: factoring for zeros, " +
      "division for equivalent forms, end behavior from degree. Quadratic factoring and special products " +
      "underlie rational-function analysis (1.8–1.10, 1.11) and appear in FRQ 4. " +
      "For Calc AB, polynomial fluency is prerequisite for all derivative and integral computation.",
    topics: [
      "Polynomial Structure and Classification — expression definition, term structure, degree, standard form, mono/bi/trinomial",
      "Polynomial Values and Identities — evaluation at numeric inputs (including negative/fraction), function notation, equivalent expressions",
      "Polynomial Addition and Subtraction — like-term alignment, sign negation, cancellation, closure",
      "Polynomial Multiplication and Special Products — monomial×polynomial, FOIL, general multiplication; squares, difference-of-squares, cube patterns",
      "GCF Factoring and Grouping — numeric/variable GCF, factoring from binomials/trinomials, grouping with 4 terms",
      "Quadratic and Special-Form Factoring — monic/non-monic trinomials, AC method, perfect-square trinomials, difference of squares, sum/difference of cubes",
      "Polynomial Division and Factor Theorems — monomial divisors, long division, synthetic division, Remainder Theorem, Factor Theorem",
      "Polynomial Equations and Roots — factoring to solve, zero-product property, real vs. complex roots",
      "Polynomial Zeros and Graph Behavior — zeros from factored form, multiplicity, end behavior, intercepts",
      "Polynomial Tables and Finite Differences — degree recognition from equally spaced tables",
    ],
    exam_weight: "Foundation — very high: polynomial zeros/end behavior are direct prerequisites for AP Precalc topics 1.4–1.10 and all of Calc AB",
  },

  exponents_and_radicals: {
    code: "F6",
    title: "Exponents and Radicals",
    focus:
      "Exponent laws (integer, zero, negative, rational), radical notation, and radical equations. " +
      "Exponent laws are the operational core of AP Precalc Unit 2 (exponential functions, log manipulation, 2.4, 2.9, 2.12). " +
      "Rational exponents link directly to 2.3–2.4. Radicals appear in exact trig values (Unit 3) " +
      "and complex zeros (1.5). In Calc AB, the power rule and chain rule for fractional/negative exponents " +
      "require this fluency throughout Units 2–3.",
    topics: [
      "Exponent Notation and Structure — base/exponent identification, repeated multiplication, parenthesized vs. unparenthesized bases, precedence",
      "Integer Exponent Laws — product rule, quotient rule, power-of-power, power-of-product, power-of-quotient",
      "Zero and Negative Exponent Structure — zero-exponent rule, negative exponent as reciprocal, movement across fraction bar",
      "Scientific Notation with Powers of Ten — multiplication/division in scientific notation, coefficient adjustment",
      "Rational Exponent Structure — unit-fraction exponents as roots, m/n form, equivalence with radical notation, exponent laws extended",
      "Radical Notation and Root Structure — radicand/index identification, principal square root, even/odd root structure, domain conditions",
      "Radical Factor Structure and Rewriting — perfect-square/cube/nth-power factors, product rule for radicals, simplest radical form",
      "Radical Operations and Like Radicals — adding/subtracting like radicals, multiplying/dividing radicals, FOIL with radicals",
      "Rationalizing and Radical Denominators — monomial radical denominators, conjugate rationalization",
      "Radical Equations and Rational-Exponent Equations — isolation of radical, powering to remove radical, extraneous solutions",
    ],
    exam_weight: "Foundation — very high: integer exponent laws yield 0.92; rational exponents yield 0.88; both ubiquitous in AP Precalc Units 1–2 and Calc AB",
  },

  functions_and_graphs: {
    code: "F7",
    title: "Functions and Graphs",
    focus:
      "Function notation, domain/range, evaluation, graph reading, and piecewise definitions. " +
      "Cross-cutting prerequisite for all three AP Precalculus mathematical practices: " +
      "symbolic fluency (FRQ 4), multiple representations (FRQ 1, 2, 3), and communication/reasoning. " +
      "Every AP Precalc FRQ and most MC items use at least one representation: graphical, symbolic, tabular, or contextual. " +
      "For Calc AB, function families (polynomial, rational, piecewise, trig, exp, log) are prerequisite for Unit 1 limits.",
    topics: [
      "Function Notation and Evaluation — f(x) notation, evaluating at numeric/variable inputs, interpreting f(a) = b",
      "Domain and Range — natural domain from algebraic restrictions, range from graph or formula, interval notation",
      "Graph Reading — identifying intercepts, maxima/minima, increasing/decreasing, asymptotes from a graph",
      "Piecewise Function Definitions — reading piecewise notation, evaluating at boundary points, graphing piecewise functions",
      "Representations — symbolic, verbal, contextual, graphical, tabular; translating among representations",
      "Graphical — coordinate plane, curves, number lines, shaded regions; sketching from key features",
      "Tabular — input-output tables, reading function values, finite-difference recognition",
      "Exact and Approximate Forms — fractions, radicals, π, logarithms as exact answers; decimal approximations in calculator sections",
    ],
    exam_weight: "Foundation — cross-cutting: AP Precalc Mathematical Practices (MP1–MP3) map directly onto representation skills; graphical yield 0.90",
  },

  // ─── AP Precalculus P1–P4 ─────────────────────────────────────────────────

  polynomial_and_rational_functions: {
    code: "P1",
    title: "Polynomial and Rational Functions",
    focus:
      "AP Precalculus Unit 1 (30–40% of exam). Function behavior including covariation, " +
      "average rate of change, polynomial zeros and end behavior, rational-function asymptotes and holes, " +
      "equivalent representations, transformations, and model construction. " +
      "FRQ 1 (Function Concepts) and FRQ 2 (Modeling Non-Periodic Context) draw heavily from this unit.",
    topics: [
      "1.1 Change in Tandem — describe co-variation of input/output across representations; compare function values",
      "1.2 Rates of Change — calculate and interpret average rate of change over an interval; sign indicates direction",
      "1.3 Rates of Change in Linear and Quadratic Functions — constant rate (linear) vs. changing rate (quadratic); concavity connection",
      "1.4 Polynomial Functions and Rates of Change — rate-of-change behavior for polynomials; connect interval behavior to degree",
      "1.5 Polynomial Functions and Complex Zeros — real and complex zeros; Fundamental Theorem; irreducible quadratic factors",
      "1.6 Polynomial Functions and End Behavior — end behavior from degree and leading coefficient; connect to limits at ±∞",
      "1.7 Rational Functions and End Behavior — horizontal asymptotes from degree comparison of numerator and denominator",
      "1.8 Rational Functions and Zeros — zeros from zeros of numerator not cancelled by denominator",
      "1.9 Rational Functions and Vertical Asymptotes — vertical asymptotes where denominator = 0 and factor does not cancel",
      "1.10 Rational Functions and Holes — removable discontinuities where common factors cancel",
      "1.11 Equivalent Representations — rewrite polynomial/rational expressions via factoring, long division, partial fractions",
      "1.12 Transformations of Functions — additive/multiplicative transformations: vertical/horizontal translation, dilation, reflection (yield 0.85)",
      "1.13 Function Model Selection — select appropriate function type for a context; state assumptions and limitations",
      "1.14 Function Model Construction and Application — construct polynomial/rational models from context or data; apply to answer questions",
    ],
    exam_weight: "30–40% of AP Precalc exam (largest possible share). FRQ 1 (Function Concepts, calc) and FRQ 2 (Modeling Non-Periodic, calc) draw heavily from this unit.",
    frq_archetypes: [
      "FRQ 1 (Function Concepts): end behavior, zeros, transformations, composition/inverse (topics 1.6, 1.7, 1.12)",
      "FRQ 2 (Modeling Non-Periodic Context): select and construct polynomial or rational model from data; interpret rate of change (1.2, 1.13, 1.14)",
    ],
  },

  exponential_and_logarithmic_functions: {
    code: "P2",
    title: "Exponential and Logarithmic Functions",
    focus:
      "AP Precalculus Unit 2 (27–40% of exam). Exponential and logarithmic functions, their properties, " +
      "composition and inverses, log manipulation rules, solving exponential/log equations, " +
      "data modeling, and semi-log plots. " +
      "FRQ 2 (Modeling Non-Periodic) and FRQ 4 (Symbolic Manipulations) both draw from this unit.",
    topics: [
      "2.1 Change in Arithmetic and Geometric Sequences — constant additive change (arithmetic) vs. constant multiplicative change (geometric)",
      "2.2 Change in Linear and Exponential Functions — constant additive vs. constant proportional (multiplicative) change",
      "2.3 Exponential Functions — f(x) = ab^x; identify base, initial value, growth/decay; domain and range",
      "2.4 Exponential Function Manipulation — rewrite using exponent laws; connect to equivalent forms including rational exponents",
      "2.5 Exponential Function Context and Data Modeling — construct exponential models from real-world data; interpret parameters (yield 0.82)",
      "2.6 Competing Function Model Validation — residual plots, comparison criteria to validate/critique model choices",
      "2.7 Composition of Functions — evaluate, construct, and decompose compositions; correct function notation",
      "2.8 Inverse Functions — input-output pairs of an inverse; invertible domains; f and f⁻¹ graphically and algebraically",
      "2.9 Logarithmic Expressions — evaluate and interpret log expressions; log as 'what exponent?'",
      "2.10 Inverses of Exponential Functions — logarithm as inverse of exponential; use log to 'undo' an exponential",
      "2.11 Logarithmic Functions — graph and analyze; domain, range, intercepts, asymptotic behavior",
      "2.12 Logarithmic Function Manipulation — product, quotient, power rules for logs; rewrite in equivalent forms (yield 0.85)",
      "2.13 Exponential and Logarithmic Equations and Inequalities — solve using inverse relationships and log properties (yield 0.88)",
      "2.14 Logarithmic Function Context and Data Modeling — construct log models from data; interpret parameters",
      "2.15 Semi-log Plots — linearize exponential data; interpret slope and intercept of linearized data",
    ],
    exam_weight: "27–40% of AP Precalc exam. FRQ 2 (Modeling Non-Periodic, calc) and FRQ 4 Part 2 (Symbolic Manipulations, no-calc) draw heavily from this unit.",
    frq_archetypes: [
      "FRQ 2 (Modeling Non-Periodic Context): construct exponential or log model; interpret parameters in context (2.5, 2.14)",
      "FRQ 4 Part 2 (Symbolic Manipulations, no-calc): apply log rules; solve exponential/log equations (2.12, 2.13)",
    ],
  },

  trigonometric_and_polar_functions: {
    code: "P3",
    title: "Trigonometric and Polar Functions",
    focus:
      "AP Precalculus Unit 3 (30–35% of exam). Sine, cosine, and tangent via unit circle, " +
      "sinusoidal function modeling (the single highest-yield topic cluster), " +
      "trig equations, identities, inverse trig, and polar coordinates/graphs. " +
      "FRQ 3 is exclusively sinusoidal modeling; FRQ 4 Part 1 often involves trig equations.",
    topics: [
      "3.1 Periodic Phenomena — period, amplitude, midline in context; periodic vs. non-periodic",
      "3.2 Sine, Cosine, and Tangent — definitions via right-triangle ratios and unit-circle coordinates; degree and radian measure",
      "3.3 Sine and Cosine Function Values — evaluate at special angles (0, π/6, π/4, π/3, π/2 and reflections); unit circle (yield 0.80)",
      "3.4 Sine and Cosine Function Graphs — amplitude, period, intercepts, max/min from graphs; sketch from features",
      "3.5 Sinusoidal Functions — y = A sin(B(x – C)) + D; amplitude, period, phase shift, midline, frequency (yield 0.90)",
      "3.6 Sinusoidal Function Transformations — construct transformed sinusoidals; connect parameters to graph features (yield 0.88)",
      "3.7 Sinusoidal Function Context and Data Modeling — construct sinusoidal models from real-world periodic data; validate (yield 0.90)",
      "3.8 The Tangent Function — period π, vertical asymptotes, zeros, undefined values; compare to sine/cosine",
      "3.9 Inverse Trigonometric Functions — arcsin, arccos, arctan with restricted domains; evaluate at special values",
      "3.10 Trigonometric Equations and Inequalities — solve trig equations using inverse functions and unit circle; general solutions (yield 0.82)",
      "3.11 Secant, Cosecant, and Cotangent — reciprocal trig functions; asymptotes, domain, key graph features",
      "3.12 Equivalent Representations of Trig Functions — Pythagorean identities and co-function identities; verify identities",
      "3.13 Trigonometry and Polar Coordinates — convert between rectangular and polar; relate angle and radius to (x, y)",
      "3.14 Polar Function Graphs — graph r = f(θ); circles, limaçons, roses, lemniscates; key features",
      "3.15 Rates of Change in Polar Functions — how r changes with respect to θ; increasing/decreasing in polar context",
    ],
    exam_weight: "30–35% of AP Precalc exam (narrowest band; consistently heavy). FRQ 3 (Sinusoidal Modeling, no-calc) entirely from this unit.",
    frq_archetypes: [
      "FRQ 3 (Modeling Periodic Context, no-calc): construct and analyze a sinusoidal model from a real-world context; identify A, B, C, D (3.5–3.7)",
      "FRQ 4 Part 1 (Symbolic Manipulations, no-calc): solve trig equations; apply Pythagorean/co-function identities (3.10, 3.12)",
    ],
  },

  parameters_vectors_and_matrices: {
    code: "P4",
    title: "Functions Involving Parameters, Vectors, and Matrices",
    focus:
      "AP Precalculus Unit 4 — NOT assessed on the AP exam (0% exam weight). " +
      "Covers parametric functions, implicit curves, conic sections, vectors, vector-valued functions, " +
      "matrix operations, and matrix applications. " +
      "All topics have yield_score ≤ 0.15 as required by the design spec.",
    topics: [
      "4.1 Parametric Functions — represent plane curves using separate x(t) and y(t) functions",
      "4.2 Parametric Functions Modeling Planar Motion — position, direction, and speed via parametric functions",
      "4.3 Parametric Functions and Rates of Change — average rate of change for parametric components",
      "4.4 Parametrically Defined Circles and Lines — write parametric equations for circles and lines",
      "4.5 Implicitly Defined Functions — analyze relations defined implicitly; find function restrictions",
      "4.6 Conic Sections — identify and analyze parabolas, ellipses, hyperbolas",
      "4.7 Parametrization of Implicitly Defined Functions — parametrize implicit relations including conics",
      "4.8 Vectors — definition; addition, scalar multiplication; magnitude and direction",
      "4.9 Vector-Valued Functions — express motion using vector-valued functions",
      "4.10 Matrices — addition, subtraction, multiplication of matrices",
      "4.11 Inverse and Determinant of a Matrix — 2×2 determinants and inverses; when a matrix is invertible",
      "4.12 Linear Transformations and Matrices — represent geometric transformations as matrix multiplication",
      "4.13 Matrices as Functions — interpret matrices as linear functions on vectors",
      "4.14 Matrices Modeling Contexts — apply matrices to model real-world scenarios",
    ],
    exam_weight: "0% — Unit 4 is NOT assessed on the AP Precalculus exam. All topic yields ≤ 0.15 per spec.",
  },

  // ─── AP Calc AB C1–C8 ─────────────────────────────────────────────────────

  limits_and_continuity: {
    code: "C1",
    title: "Limits and Continuity",
    focus:
      "AP Calc AB Unit 1 (10–12% of exam). Limit notation, one-sided and two-sided limits, " +
      "graphical/table/algebraic evaluation, continuity at a point and over an interval, " +
      "types of discontinuities, IVT, infinite limits, and limits at infinity. " +
      "Foundational for all downstream units — every derivative definition is a limit.",
    topics: [
      "1.1 Introducing Calculus — motivate the limit concept; average vs. instantaneous rate of change (conceptual, yield 0.15)",
      "1.2 Defining Limits and Using Limit Notation — express and interpret limits symbolically; one-sided vs. two-sided (yield 0.55)",
      "1.3 Estimating Limit Values from Graphs — read/approximate limits from a function graph including one-sided cases (yield 0.65)",
      "1.4 Estimating Limit Values from Tables — approximate limits using a table of function values (yield 0.60)",
      "1.5 Determining Limits Using Algebraic Properties — sum, product, quotient, and composition limit laws (yield 0.70)",
      "1.6 Determining Limits Using Algebraic Manipulation — factor, rationalize, rewrite to resolve 0/0 forms (yield 0.75)",
      "1.7 Selecting Procedures for Determining Limits — choose technique (substitution, factoring, squeeze, L'Hôpital) (yield 0.60)",
      "1.8 Determining Limits Using the Squeeze Theorem — squeeze theorem including classic sin(x)/x limit (yield 0.45)",
      "1.9 Connecting Multiple Representations of Limits — reconcile graph, table, and analytic information (yield 0.55)",
      "1.10 Exploring Types of Discontinuities — classify removable, jump, and infinite (vertical asymptote) discontinuities (yield 0.65)",
      "1.11 Defining Continuity at a Point — three-part continuity definition; justify continuity or find k values (yield 0.70)",
      "1.12 Confirming Continuity Over an Interval — intervals of continuity using function family properties (yield 0.50)",
      "1.13 Removing Discontinuities — find values making a piecewise/rational function continuous (yield 0.65)",
      "1.14 Infinite Limits and Vertical Asymptotes — one-sided limits that diverge to ±∞; vertical asymptotes (yield 0.60)",
      "1.15 Limits at Infinity and Horizontal Asymptotes — end behavior via dominant-term analysis (yield 0.65)",
      "1.16 Intermediate Value Theorem (IVT) — apply IVT to guarantee existence; justify existence claims (yield 0.70)",
    ],
    exam_weight: "10–12% of AP Calc AB. ~7 direct FRQ appearances (2012–2025); limits appear as sub-parts in ~40% of all FRQs.",
    frq_archetypes: [
      "IVT justification sub-part: cite continuity on closed interval, then apply IVT (topic 1.16)",
      "Continuity analysis: find k so a piecewise function is continuous; justify (topics 1.11, 1.13)",
    ],
  },

  differentiation_definition_and_fundamental_properties: {
    code: "C2",
    title: "Differentiation: Definition and Fundamental Properties",
    focus:
      "AP Calc AB Unit 2 (10–12% of exam). Limit definition of the derivative, derivative notation, " +
      "estimating derivatives, differentiability vs. continuity, power rule, basic derivative rules, " +
      "and derivatives of trig/transcendental functions. " +
      "Foundational for all downstream units — ~23 FRQ appearances (2012–2025).",
    topics: [
      "2.1 Defining Average and Instantaneous Rates of Change — secant slope → instantaneous rate as limit (yield 0.70)",
      "2.2 Defining the Derivative and Using Notation — limit of difference quotient; f'(x), dy/dx, d/dx interchangeably (yield 0.75)",
      "2.3 Estimating Derivatives at a Point — estimate f'(a) numerically from table or graphically from tangent slope (yield 0.70)",
      "2.4 Differentiability and Continuity — differentiability implies continuity; non-differentiable points (corners, cusps, vertical tangents) (yield 0.65)",
      "2.5 Power Rule — d/dx(x^n) = nx^(n-1); extend to negative and fractional exponents (yield 0.85)",
      "2.6 Constant, Sum, Difference, and Constant-Multiple Rules — linearity of differentiation (yield 0.85)",
      "2.7 Derivatives of cos(x), sin(x), e^x, ln(x) — standard formulas; appear on virtually every AP exam (yield 0.90)",
      "2.8 Product Rule — (fg)' = f'g + fg'; appears in ~60% of derivative-heavy FRQ parts (yield 0.85)",
      "2.9 Quotient Rule — (f/g)' = (f'g − fg') / g² (yield 0.80)",
      "2.10 Derivatives of tan(x), cot(x), sec(x), csc(x) — derived from quotient rule + sin/cos (yield 0.75)",
    ],
    exam_weight: "10–12% of AP Calc AB. ~23 FRQ appearances; foundational to nearly every FRQ part.",
    frq_archetypes: [
      "Rate/Data from Tables FRQ: estimate derivative using difference quotient from a table (topic 2.3)",
      "Interpretation sub-part: state what f'(x) represents in applied terms with units (topic 2.1, 4.1)",
    ],
  },

  differentiation_composite_implicit_and_inverse: {
    code: "C3",
    title: "Differentiation: Composite, Implicit, and Inverse Functions",
    focus:
      "AP Calc AB Unit 3 (9–13% of exam). Chain rule, implicit differentiation, " +
      "differentiating inverse functions and inverse trig functions, higher-order derivatives. " +
      "Chain rule (yield 0.95) is the single highest-yield topic on the exam; " +
      "implicit differentiation appears as its own FRQ question in most years.",
    topics: [
      "3.1 The Chain Rule — d/dx[f(g(x))] = f'(g(x))·g'(x); highest yield topic on exam (yield 0.95)",
      "3.2 Implicit Differentiation — differentiate equation in x and y implicitly; solve for dy/dx using chain rule on y terms (yield 0.85)",
      "3.3 Differentiating Inverse Functions — (f⁻¹)'(a) = 1 / f'(f⁻¹(a)) (yield 0.65)",
      "3.4 Differentiating Inverse Trig Functions — derivatives of arcsin, arccos, arctan; combine with chain rule (yield 0.70)",
      "3.5 Selecting Procedures for Calculating Derivatives — identify which rule(s) to apply; combine chain, product, quotient, implicit (yield 0.75)",
      "3.6 Calculating Higher-Order Derivatives — f''(x), f'''(x); second derivative as concavity/acceleration (yield 0.80)",
    ],
    exam_weight: "9–13% of AP Calc AB. ~15 FRQ appearances; chain rule embedded in nearly every complex FRQ.",
    frq_archetypes: [
      "Implicit Differentiation / Curve Analysis FRQ: find dy/dx; locate horizontal/vertical tangents; analyze concavity (topics 3.2, 3.6, 5.12)",
      "Related Rates setup: differentiate geometric/physical relationship implicitly with respect to t (topic 4.4)",
    ],
  },

  contextual_applications_of_differentiation: {
    code: "C4",
    title: "Contextual Applications of Differentiation",
    focus:
      "AP Calc AB Unit 4 (10–15% of exam). Interpreting derivative meaning in context, " +
      "particle motion (position/velocity/acceleration), rates of change in applied contexts, " +
      "related rates, linearization, and L'Hôpital's Rule. " +
      "~37 FRQ appearances (2012–2025) — second highest; contextual applications dominate FRQ Part A.",
    topics: [
      "4.1 Interpreting Derivative Meaning in Context — state what f'(x) represents including units; interpret sign and magnitude (yield 0.80)",
      "4.2 Straight-Line Motion: Position, Velocity, and Acceleration — v(t) = s'(t), a(t) = v'(t); direction, speed, speeding up/slowing down (yield 0.90)",
      "4.3 Rates of Change in Applied Contexts — derivatives in population, temperature, volume, flow-rate contexts (yield 0.80)",
      "4.4 Introduction to Related Rates — set up from geometric/physical relationship; differentiate implicitly with respect to t (yield 0.75)",
      "4.5 Solving Related Rates Problems — full procedure: draw, write equation, differentiate, substitute, solve (yield 0.75)",
      "4.6 Linearization — tangent-line approximation L(x) = f(a) + f'(a)(x−a); over/under-estimate via concavity (yield 0.55)",
      "4.7 L'Hôpital's Rule — apply to 0/0 or ∞/∞ indeterminate forms; recognize eligible forms (yield 0.75)",
    ],
    exam_weight: "10–15% of AP Calc AB. ~37 FRQ appearances; particle motion is most common FRQ archetype.",
    frq_archetypes: [
      "Particle Motion FRQ (Part A, calc): find velocity/acceleration; determine direction, total distance, position (topics 4.2, 8.2)",
      "Rate/Data from Tables FRQ: interpret derivative value in context with units; use MVT (topics 4.1, 4.3, 5.1)",
      "Related Rates FRQ sub-part: set up and solve a rate relationship; cite geometry formula (topics 4.4, 4.5)",
    ],
  },

  analytical_applications_of_differentiation: {
    code: "C5",
    title: "Analytical Applications of Differentiation",
    focus:
      "AP Calc AB Unit 5 (15–18% of exam). MVT, EVT, critical points, " +
      "increasing/decreasing intervals, first and second derivative tests, " +
      "concavity/inflection, absolute extrema, optimization, and implicit curve analysis. " +
      "~38 FRQ appearances (2012–2025) — highest of all units; every graph-analysis FRQ lives here.",
    topics: [
      "5.1 Mean Value Theorem (MVT) — apply MVT to guarantee existence of c; state hypotheses (yield 0.80)",
      "5.2 Extreme Value Theorem, Global vs. Local Extrema, Critical Points — apply EVT; locate critical points (yield 0.80)",
      "5.3 Determining Intervals of Increase/Decrease — sign of f'(x) on number line (yield 0.85)",
      "5.4 First Derivative Test — classify relative max/min by sign change of f' at a critical point (yield 0.85)",
      "5.5 Candidates Test for Absolute Extrema — evaluate f at critical points and endpoints on closed interval (yield 0.80)",
      "5.6 Determining Concavity — sign of f''(x) to classify concavity; inflection points where f'' changes sign (yield 0.85)",
      "5.7 Second Derivative Test for Extrema — classify a critical point via sign of f''(c) (yield 0.70)",
      "5.8 Sketching Graphs of f and f' — connect graph features of f, f', f''; infer f from graph of f' (yield 0.85)",
      "5.9 Connecting f, f', and f'' — synthesize increase/decrease, concavity, and extrema simultaneously (yield 0.85)",
      "5.10 Introduction to Optimization — translate word problem to objective function + constraint (yield 0.75)",
      "5.11 Solving Optimization Problems — find domain, differentiate, find critical points, apply candidates test (yield 0.75)",
      "5.12 Behaviors of Implicit Relations — horizontal/vertical tangents, concavity, local behavior of implicit curves (yield 0.65)",
    ],
    exam_weight: "15–18% of AP Calc AB (highest-weighted unit). ~38 FRQ appearances — graph-analysis FRQ is a near-annual archetype.",
    frq_archetypes: [
      "Graph Analysis FRQ (f and f'): given graph of f', find relative extrema, inflection points, concavity of f (topics 5.3–5.9)",
      "Optimization FRQ: set up objective function from geometric context; apply candidates test on closed interval (topics 5.5, 5.10, 5.11)",
      "MVT justification sub-part: cite hypotheses; conclude existence of c with f'(c) = average rate (topic 5.1)",
    ],
  },

  integration_and_accumulation_of_change: {
    code: "C6",
    title: "Integration and Accumulation of Change",
    focus:
      "AP Calc AB Unit 6 (17–20% of exam — highest unit weight). " +
      "Riemann sums, definite and indefinite integrals, FTC Parts 1 and 2, " +
      "basic antiderivative rules, and u-substitution. " +
      "FTC (yield 0.90) and u-substitution (yield 0.90) are among the highest-frequency skills on the exam.",
    topics: [
      "6.1 Accumulation of Change — definite integral as accumulated change; area under rate curve = net change (yield 0.70)",
      "6.2 Approximating Areas with Riemann Sums — left, right, midpoint, trapezoidal sums; over/under estimates (yield 0.85)",
      "6.3 Riemann Sums and Definite Integral Notation — connect Riemann sum to ∫ₐᵇ f(x)dx as limit (yield 0.75)",
      "6.4 FTC Part 1 and Accumulation Functions — differentiate F(x) = ∫ₐˣ f(t)dt; apply chain rule when upper limit is g(x) (yield 0.90)",
      "6.5 Behavior of Accumulation Functions — analyze F(x) = ∫f in terms of f's graph; extrema, concavity (yield 0.85)",
      "6.6 Properties of Definite Integrals — linearity, interval reversal, split-interval properties (yield 0.75)",
      "6.7 FTC Part 2 — evaluate ∫ₐᵇ f(x)dx = F(b) − F(a) using antiderivatives (yield 0.90)",
      "6.8 Finding Antiderivatives: Basic Rules — reverse power rule; standard formulas for trig, e^x, 1/x; include +C (yield 0.90)",
      "6.9 Integrating Using Substitution — u-substitution; transform and evaluate indefinite and definite integrals (yield 0.90)",
      "6.10 Integrating Using Long Division and Completing the Square — rewrite improper rational or quadratic integrands (yield 0.45)",
      "6.14 Selecting Techniques for Antidifferentiation — identify substitution vs. basic rules vs. algebraic manipulation (yield 0.65)",
    ],
    exam_weight: "17–20% of AP Calc AB (highest unit weight). ~25 FRQ appearances; FTC and u-sub in nearly every accumulation/area/DE FRQ.",
    frq_archetypes: [
      "Accumulation / FTC Graph Analysis FRQ: given graph of f, find F'(x), F''(x), extrema/inflection of F, F(b) via FTC Part 2 (topics 6.4, 6.5, 6.7)",
      "Riemann Sum FRQ sub-part: compute left/right/trapezoidal approximation from a table; state over/under-estimate (topic 6.2)",
      "Rate/Data from Tables FRQ: interpret ∫rate dt as accumulated quantity in context (topics 6.1, 6.3, 8.3)",
    ],
  },

  differential_equations: {
    code: "C7",
    title: "Differential Equations",
    focus:
      "AP Calc AB Unit 7 (6–12% of exam). Modeling with DEs, verifying solutions, " +
      "slope fields, separation of variables (general and particular solutions), and exponential models. " +
      "The DE question has appeared on almost every AP exam as its own dedicated FRQ slot.",
    topics: [
      "7.1 Modeling Situations with Differential Equations — translate verbal rate-of-change relationship into a DE (yield 0.70)",
      "7.2 Verifying Solutions to DEs — substitute a proposed function into the DE; confirm satisfaction (yield 0.60)",
      "7.3 Sketching Slope Fields — draw slope field for a given DE; interpret to describe solution behavior (yield 0.75)",
      "7.4 Reasoning Using Slope Fields — long-term behavior, equilibrium, direction from slope field; match DE to slope field (yield 0.70)",
      "7.6 General Solutions Using Separation of Variables — separate variables; integrate both sides; solve for y (yield 0.85)",
      "7.7 Particular Solutions Using Initial Conditions — apply initial condition to determine constant of integration (yield 0.85)",
      "7.8 Exponential Models — solve dy/dt = ky to get y = Ce^(kt); interpret k and C in context (yield 0.80)",
    ],
    exam_weight: "6–12% of AP Calc AB. ~9 direct FRQ appearances; DE FRQ is present on almost every exam.",
    frq_archetypes: [
      "Differential Equations / Slope Fields FRQ (no-calc): sketch/interpret slope field; separate variables; find particular solution with initial condition (topics 7.3, 7.6, 7.7)",
      "Exponential Model FRQ sub-part: set up dy/dt = ky; solve; interpret growth/decay constant in context (topic 7.8)",
    ],
  },

  applications_of_integration: {
    code: "C8",
    title: "Applications of Integration",
    focus:
      "AP Calc AB Unit 8 (10–15% of exam). Average value, connecting position/velocity/acceleration via integrals, " +
      "accumulation in applied contexts, area between curves, volume with disc/washer methods and cross sections, " +
      "and arc length. " +
      "~30 FRQ appearances (2012–2025) — third highest; area/volume and particle motion are the two dominant archetypes.",
    topics: [
      "8.1 Average Value of a Function — f_avg = (1/(b−a)) ∫ₐᵇ f(x)dx; interpret in context (yield 0.75)",
      "8.2 Position, Velocity, Acceleration via Integrals — recover position from velocity; net displacement vs. total distance (yield 0.90)",
      "8.3 Accumulation Functions and Definite Integrals in Applied Contexts — compute net change via ∫ rate dt (yield 0.85)",
      "8.4 Area Between Curves (functions of x) — set up ∫[f(x) − g(x)] dx; identify intersection points (yield 0.90)",
      "8.5 Area Between Curves (functions of y) — integrate with respect to y for horizontally-oriented regions (yield 0.60)",
      "8.6 Area Between Curves Intersecting at More Than Two Points — split at all intersection points; sum of integrals (yield 0.60)",
      "8.7 Volumes with Cross Sections: Squares and Rectangles — V = ∫ A(x) dx; square or rectangular cross sections (yield 0.75)",
      "8.8 Volumes with Cross Sections: Triangles and Semicircles — equilateral triangle or semicircle cross sections (yield 0.65)",
      "8.9 Volume with Disc Method: x-axis or y-axis — V = π ∫[f(x)]² dx for solid of revolution (yield 0.85)",
      "8.10 Volume with Disc Method: Other Axes — adjust disc radius for axis not through origin (yield 0.65)",
      "8.11 Volume with Washer Method: x-axis or y-axis — V = π ∫([f(x)]² − [g(x)]²) dx; outer and inner radii (yield 0.85)",
      "8.12 Volume with Washer Method: Other Axes — adjust outer/inner radii when axis is not x=0 or y=0 (yield 0.65)",
      "8.13 Arc Length — ∫√(1 + [f'(x)]²) dx; interpret as total distance along a path (yield 0.35)",
    ],
    exam_weight: "10–15% of AP Calc AB. ~30 FRQ appearances; area/volume and particle motion are dominant FRQ archetypes.",
    frq_archetypes: [
      "Area & Volume FRQ (Part A, calc): find intersection points; compute area between curves; set up disc/washer/cross-section volume (topics 8.4, 8.7–8.12)",
      "Particle Motion FRQ: integrate v(t) for net displacement and total distance; find position at time t (topics 8.2, 8.3)",
      "Rate Accumulation FRQ: interpret ∫ rate dt as net change in quantity; compute average value (topics 8.1, 8.3)",
    ],
  },
};

/**
 * Build a compact grounding block for the generation prompt for a given
 * math category. Returns "" when the category is unknown (generation still works).
 */
export function outlineContextForCategory(categoryId: string): string {
  const e = MATH_CONTENT_OUTLINE[categoryId];
  if (!e) return "";

  const lines: string[] = [
    `OFFICIAL MATH CONTENT OUTLINE — ${e.code}: ${e.title}`,
    `Scope: ${e.focus}`,
  ];

  if (e.exam_weight) {
    lines.push(`Exam weight: ${e.exam_weight}`);
  }

  lines.push(`Canonical topics the exam tests for this area:`);
  for (const t of e.topics) {
    lines.push(`  • ${t}`);
  }

  if (e.frq_archetypes && e.frq_archetypes.length > 0) {
    lines.push(`FRQ archetypes:`);
    for (const a of e.frq_archetypes) {
      lines.push(`  • ${a}`);
    }
  }

  return lines.join("\n");
}
