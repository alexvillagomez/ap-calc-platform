import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const CATEGORIES = [
  { id: "number_sense", name: "Number Sense", description: "Core understanding of numbers, magnitude, comparison, estimation, and numerical relationships needed before algebra.", order_index: 1 },
  { id: "arithmetic_operations", name: "Arithmetic Operations", description: "Adding, subtracting, multiplying, dividing, and evaluating numerical expressions accurately.", order_index: 2 },
  { id: "fractions_decimals_percents", name: "Fractions, Decimals, and Percents", description: "Working with fractional, decimal, percent, ratio, and proportional representations of quantities.", order_index: 3 },
  { id: "integer_operations", name: "Integer Operations", description: "Working with positive and negative numbers, signs, absolute value, and operations involving integers.", order_index: 4 },
  { id: "order_of_operations", name: "Order of Operations", description: "Evaluating expressions using the correct order of operations, including parentheses and exponents.", order_index: 5 },
  { id: "algebraic_expressions", name: "Algebraic Expressions", description: "Simplifying, expanding, combining like terms, substituting values, and interpreting algebraic expressions.", order_index: 6 },
  { id: "linear_equations", name: "Linear Equations", description: "Solving and interpreting one-variable and multi-step linear equations.", order_index: 7 },
  { id: "linear_inequalities", name: "Linear Inequalities", description: "Solving and interpreting one-variable linear inequalities and inequality notation.", order_index: 8 },
  { id: "systems_of_equations", name: "Systems of Equations", description: "Solving systems of equations using graphing, substitution, elimination, and interpreting intersections.", order_index: 9 },
  { id: "systems_of_inequalities", name: "Systems of Inequalities", description: "Solving and graphing systems of inequalities and identifying feasible regions.", order_index: 10 },
  { id: "exponents", name: "Exponents", description: "Using exponent notation and exponent rules, including integer, zero, negative, and rational exponents.", order_index: 11 },
  { id: "radicals", name: "Radicals", description: "Simplifying, rewriting, evaluating, and operating with square roots, higher roots, and radical expressions.", order_index: 12 },
  { id: "polynomials", name: "Polynomials", description: "Adding, subtracting, multiplying, dividing, evaluating, and analyzing polynomial expressions and functions.", order_index: 13 },
  { id: "factoring", name: "Factoring", description: "Rewriting expressions as products using common factors, grouping, trinomials, difference of squares, and other factoring patterns.", order_index: 14 },
  { id: "rational_expressions", name: "Rational Expressions", description: "Simplifying, operating with, and analyzing expressions involving ratios of polynomials.", order_index: 15 },
  { id: "quadratics", name: "Quadratics", description: "Solving, graphing, factoring, completing the square, and interpreting quadratic equations and functions.", order_index: 16 },
  { id: "complex_numbers", name: "Complex Numbers", description: "Working with imaginary numbers, complex arithmetic, conjugates, and complex solutions to equations.", order_index: 17 },
  { id: "absolute_value", name: "Absolute Value", description: "Solving, graphing, and interpreting absolute value expressions, equations, inequalities, and functions.", order_index: 18 },
  { id: "coordinate_geometry", name: "Coordinate Geometry", description: "Using the coordinate plane, distance, midpoint, slope, equations of lines, and geometric relationships.", order_index: 19 },
  { id: "functions", name: "Functions", description: "Understanding function notation, inputs, outputs, domain, range, evaluation, and function behavior.", order_index: 20 },
  { id: "function_graphs", name: "Function Graphs", description: "Interpreting and analyzing graphs of functions, including intercepts, intervals, extrema, and graphical features.", order_index: 21 },
  { id: "function_transformations", name: "Function Transformations", description: "Shifting, reflecting, stretching, compressing, and combining transformations of parent functions.", order_index: 22 },
  { id: "function_composition", name: "Function Composition", description: "Combining functions through composition and evaluating expressions such as f(g(x)).", order_index: 23 },
  { id: "inverse_functions", name: "Inverse Functions", description: "Finding, verifying, graphing, and interpreting inverse functions and inverse relationships.", order_index: 24 },
  { id: "piecewise_functions", name: "Piecewise Functions", description: "Evaluating, graphing, and interpreting functions defined by different rules on different intervals.", order_index: 25 },
  { id: "exponential_functions", name: "Exponential Functions", description: "Working with exponential growth, decay, transformations, equations, and models.", order_index: 26 },
  { id: "logarithmic_functions", name: "Logarithmic Functions", description: "Understanding logarithms, log rules, log equations, transformations, and inverse relationships with exponentials.", order_index: 27 },
  { id: "trigonometric_ratios", name: "Trigonometric Ratios", description: "Using sine, cosine, tangent, and reciprocal ratios in right triangle and geometric contexts.", order_index: 28 },
  { id: "unit_circle", name: "Unit Circle", description: "Understanding radians, special angles, coordinates, and exact trigonometric values on the unit circle.", order_index: 29 },
  { id: "trigonometric_functions", name: "Trigonometric Functions", description: "Graphing, transforming, evaluating, and interpreting sine, cosine, tangent, and reciprocal trigonometric functions.", order_index: 30 },
  { id: "trigonometric_identities", name: "Trigonometric Identities", description: "Using and proving trigonometric identities, including reciprocal, quotient, Pythagorean, sum, difference, and double-angle identities.", order_index: 31 },
  { id: "trigonometric_equations", name: "Trigonometric Equations", description: "Solving equations involving trigonometric functions over specified intervals or general solution sets.", order_index: 32 },
  { id: "sequences_and_series", name: "Sequences and Series", description: "Working with arithmetic and geometric sequences and finite or infinite series in precalculus contexts.", order_index: 33 },
  { id: "conic_sections", name: "Conic Sections", description: "Analyzing circles, parabolas, ellipses, and hyperbolas through equations, graphs, and geometric features.", order_index: 34 },
  { id: "parametric_equations", name: "Parametric Equations", description: "Representing and analyzing curves using separate equations for x and y in terms of a parameter.", order_index: 35 },
  { id: "polar_coordinates", name: "Polar Coordinates", description: "Using polar coordinates, polar equations, and relationships between polar and rectangular forms.", order_index: 36 },
  { id: "vectors", name: "Vectors", description: "Representing, adding, scaling, decomposing, and interpreting vectors in geometric and algebraic contexts.", order_index: 37 },
  { id: "mathematical_modeling", name: "Mathematical Modeling", description: "Building, interpreting, and using equations or functions to represent real-world relationships.", order_index: 38 },
  { id: "limits", name: "Limits", description: "Understanding and evaluating limits numerically, graphically, algebraically, and conceptually.", order_index: 39 },
  { id: "continuity", name: "Continuity", description: "Determining, interpreting, and classifying continuity and discontinuities of functions.", order_index: 40 },
  { id: "asymptotes_and_end_behavior", name: "Asymptotes and End Behavior", description: "Analyzing vertical asymptotes, horizontal asymptotes, slant asymptotes, infinite limits, and long-run behavior.", order_index: 41 },
  { id: "derivative_definition", name: "Derivative Definition", description: "Understanding derivatives through limits, difference quotients, instantaneous rate of change, and tangent slopes.", order_index: 42 },
  { id: "derivative_rules", name: "Derivative Rules", description: "Computing derivatives using power, constant, sum, difference, product, quotient, and chain rules.", order_index: 43 },
  { id: "transcendental_derivatives", name: "Transcendental Derivatives", description: "Differentiating exponential, logarithmic, trigonometric, and inverse trigonometric functions.", order_index: 44 },
  { id: "implicit_differentiation", name: "Implicit Differentiation", description: "Finding derivatives when variables are related implicitly rather than solved explicitly as functions.", order_index: 45 },
  { id: "inverse_function_derivatives", name: "Inverse Function Derivatives", description: "Finding and interpreting derivatives of inverse functions using inverse relationships.", order_index: 46 },
  { id: "higher_order_derivatives", name: "Higher-Order Derivatives", description: "Computing and interpreting second and higher derivatives.", order_index: 47 },
  { id: "tangent_lines_and_linearization", name: "Tangent Lines and Linearization", description: "Using derivatives to write tangent line equations and approximate function values.", order_index: 48 },
  { id: "motion_with_derivatives", name: "Motion with Derivatives", description: "Using position, velocity, acceleration, speed, and direction in derivative-based motion problems.", order_index: 49 },
  { id: "related_rates", name: "Related Rates", description: "Using derivatives to relate changing quantities in applied situations.", order_index: 50 },
  { id: "extrema_and_critical_points", name: "Extrema and Critical Points", description: "Finding and classifying local and absolute extrema using critical points and endpoints.", order_index: 51 },
  { id: "first_derivative_analysis", name: "First Derivative Analysis", description: "Using the first derivative to analyze increasing, decreasing, relative extrema, and function behavior.", order_index: 52 },
  { id: "second_derivative_analysis", name: "Second Derivative Analysis", description: "Using the second derivative to analyze concavity, inflection points, and curvature.", order_index: 53 },
  { id: "optimization", name: "Optimization", description: "Using derivatives to maximize or minimize quantities in mathematical and applied contexts.", order_index: 54 },
  { id: "derivative_theorems", name: "Derivative Theorems", description: "Using major derivative-related theorems such as the Mean Value Theorem, Rolle's Theorem, and related existence results.", order_index: 55 },
  { id: "antiderivatives", name: "Antiderivatives", description: "Finding functions from their derivatives and understanding indefinite integration.", order_index: 56 },
  { id: "riemann_sums", name: "Riemann Sums", description: "Approximating accumulation and area using left, right, midpoint, and general Riemann sums.", order_index: 57 },
  { id: "definite_integrals", name: "Definite Integrals", description: "Understanding and evaluating definite integrals as accumulation, signed area, and net change.", order_index: 58 },
  { id: "fundamental_theorem_of_calculus", name: "Fundamental Theorem of Calculus", description: "Connecting derivatives and integrals through accumulation functions and evaluation of definite integrals.", order_index: 59 },
  { id: "accumulation_functions", name: "Accumulation Functions", description: "Analyzing functions defined by integrals and interpreting accumulated change.", order_index: 60 },
  { id: "integration_techniques", name: "Integration Techniques", description: "Evaluating integrals using algebraic simplification, substitution, and other standard methods appropriate to the course.", order_index: 61 },
  { id: "area_between_curves", name: "Area Between Curves", description: "Finding areas of regions bounded by two or more curves.", order_index: 62 },
  { id: "volumes_with_cross_sections", name: "Volumes with Cross Sections", description: "Finding volumes of solids with known cross-sectional shapes.", order_index: 63 },
  { id: "volumes_of_revolution", name: "Volumes of Revolution", description: "Finding volumes created by revolving regions around axes or other lines.", order_index: 64 },
  { id: "motion_with_integrals", name: "Motion with Integrals", description: "Using integrals to analyze displacement, total distance, velocity, acceleration, and accumulated motion.", order_index: 65 },
  { id: "average_value", name: "Average Value", description: "Finding and interpreting the average value of a function over an interval.", order_index: 66 },
  { id: "differential_equations", name: "Differential Equations", description: "Solving and interpreting equations involving functions and their derivatives.", order_index: 67 },
  { id: "slope_fields", name: "Slope Fields", description: "Interpreting and sketching slope fields for differential equations.", order_index: 68 },
  { id: "separable_differential_equations", name: "Separable Differential Equations", description: "Solving differential equations by separating variables and integrating.", order_index: 69 },
  { id: "growth_and_decay", name: "Growth and Decay", description: "Modeling exponential and logistic change using functions, derivatives, integrals, or differential equations.", order_index: 70 },
  { id: "mixed_calculus_applications", name: "Mixed Calculus Applications", description: "Solving multi-step problems that combine several calculus concepts in applied or exam-style settings.", order_index: 71 },
];

export async function POST() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) return Response.json({ error: "Supabase not configured" }, { status: 500 });

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const { error } = await supabase.from("learn_categories").upsert(CATEGORIES, { onConflict: "id" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ seeded: CATEGORIES.length });
}
