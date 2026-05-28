-- Migrate topic_metadata and problems to match updated CANONICAL_TOPICS_TEXT.
--
-- Changes:
--   • 3 new Unit 6 topics inserted between existing ones:
--       6_2 (Riemann from Table), 6_3 (Riemann from Graph), 6_10 (Definite Integrals from Function)
--   • Old 6_2–6_7 renumbered to 6_4–6_9 (shifted up by 2) to make room
--   • All topic names and descriptions updated to the expanded versions

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Rename shifted Unit 6 rows in topic_metadata (highest-first to avoid PK conflicts)
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE topic_metadata SET id = '6_9' WHERE id = '6_7';
UPDATE topic_metadata SET id = '6_8' WHERE id = '6_6';
UPDATE topic_metadata SET id = '6_7' WHERE id = '6_5';
UPDATE topic_metadata SET id = '6_6' WHERE id = '6_4';
UPDATE topic_metadata SET id = '6_5' WHERE id = '6_3';
UPDATE topic_metadata SET id = '6_4' WHERE id = '6_2';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Rename those same keys in problems.topic_weights (JSONB, highest-first)
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE problems
  SET topic_weights = (topic_weights - '6_7') || jsonb_build_object('6_9', topic_weights -> '6_7')
  WHERE topic_weights ? '6_7';

UPDATE problems
  SET topic_weights = (topic_weights - '6_6') || jsonb_build_object('6_8', topic_weights -> '6_6')
  WHERE topic_weights ? '6_6';

UPDATE problems
  SET topic_weights = (topic_weights - '6_5') || jsonb_build_object('6_7', topic_weights -> '6_5')
  WHERE topic_weights ? '6_5';

UPDATE problems
  SET topic_weights = (topic_weights - '6_4') || jsonb_build_object('6_6', topic_weights -> '6_4')
  WHERE topic_weights ? '6_4';

UPDATE problems
  SET topic_weights = (topic_weights - '6_3') || jsonb_build_object('6_5', topic_weights -> '6_3')
  WHERE topic_weights ? '6_3';

UPDATE problems
  SET topic_weights = (topic_weights - '6_2') || jsonb_build_object('6_4', topic_weights -> '6_2')
  WHERE topic_weights ? '6_2';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Same renames in problems.subtopic_relevance (highest-first)
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE problems
  SET subtopic_relevance = (subtopic_relevance - '6_7') || jsonb_build_object('6_9', subtopic_relevance -> '6_7')
  WHERE subtopic_relevance ? '6_7';

UPDATE problems
  SET subtopic_relevance = (subtopic_relevance - '6_6') || jsonb_build_object('6_8', subtopic_relevance -> '6_6')
  WHERE subtopic_relevance ? '6_6';

UPDATE problems
  SET subtopic_relevance = (subtopic_relevance - '6_5') || jsonb_build_object('6_7', subtopic_relevance -> '6_5')
  WHERE subtopic_relevance ? '6_5';

UPDATE problems
  SET subtopic_relevance = (subtopic_relevance - '6_4') || jsonb_build_object('6_6', subtopic_relevance -> '6_4')
  WHERE subtopic_relevance ? '6_4';

UPDATE problems
  SET subtopic_relevance = (subtopic_relevance - '6_3') || jsonb_build_object('6_5', subtopic_relevance -> '6_3')
  WHERE subtopic_relevance ? '6_3';

UPDATE problems
  SET subtopic_relevance = (subtopic_relevance - '6_2') || jsonb_build_object('6_4', subtopic_relevance -> '6_2')
  WHERE subtopic_relevance ? '6_2';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Upsert all 61 topics (names + expanded descriptions)
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO topic_metadata (id, name, description) VALUES
  ('1_1', 'Estimating Limit Values from Graphs', 'estimate one-sided and two-sided limit values directly from a graph, including graphs with holes, jumps, or piecewise-defined behavior; all problems must require interpreting a graph, not a table or algebraic expression'),
  ('1_2', 'Estimating Limit Values from Tables', 'estimate one-sided and two-sided limit values from a numerical table by analyzing function values as x approaches a given input from the left and right; all problems must require interpreting a table, not a graph or algebraic simplification'),
  ('1_3', 'Determining Limits Using Algebraic Properties', 'evaluate limits algebraically using direct substitution when possible and, when necessary, simplify expressions using algebraic techniques such as factoring, expanding, combining fractions, or rationalizing; all problems must require algebraic manipulation rather than interpreting a graph or table'),
  ('1_4', 'Types of Discontinuities', 'identify and classify discontinuities as removable, jump, or infinite by analyzing the behavior of a function at a point; problems may use equations, graphs, or tables, but the focus must be on classifying the type of discontinuity rather than evaluating a limit or testing continuity'),
  ('1_5', 'Defining Continuity at a Point and over an Interval', 'determine whether a function is continuous at a given point or on a stated interval by applying the definition of continuity, including checking that the function value exists, the limit exists, and the limit equals the function value; focus on verifying continuity rather than classifying discontinuity types'),
  ('1_6', 'Infinite Limits and Vertical Asymptotes', 'evaluate one-sided or two-sided limits that grow without bound as x approaches a given value, and identify the corresponding vertical asymptote when appropriate; focus on unbounded behavior near a finite x-value rather than end behavior as x approaches infinity'),
  ('1_7', 'Limits at Infinity and Horizontal Asymptotes', 'evaluate limits as x approaches infinity or negative infinity by analyzing end behavior, including using dominant terms or comparing degrees in rational expressions, and determine horizontal asymptotes when they exist; focus on behavior for large positive or negative x rather than near a finite point'),
  ('1_8', 'Intermediate Value Theorem', 'apply the Intermediate Value Theorem to justify that a function must take on a given value within an interval, using the conditions of continuity on a closed interval and values at the endpoints; focus on guaranteeing existence of a solution or output value, not finding the exact point where it occurs'),
  ('1_9', 'Trig Limits from the Squeeze Theorem', 'evaluate trigonometric limits using the squeeze theorem, especially limits involving sin(x)/x and equivalent forms derived from it; focus on recognizing and applying the standard trig limit framework rather than using general algebraic limit techniques'),
  ('2_1', 'Average Rate of Change', 'compute the average rate of change of a function over an interval by finding the slope of the secant line using function values, an equation, a graph, or a table; focus on change over an interval rather than the instantaneous rate of change at a single point'),
  ('2_2', 'Defining the Derivative; Derivative Notation', 'interpret the derivative as the limit of a difference quotient and match limit expressions to the correct derivative notation, point, or function statement without evaluating the limit; focus on recognizing derivative structure and notation rather than computing derivative values'),
  ('2_3', 'Differentiability', 'determine whether a function is differentiable at a point or on an interval by analyzing whether the derivative exists, including cases involving corners, cusps, vertical tangents, and discontinuities; focus on the conditions for differentiability rather than computing derivatives'),
  ('2_4', 'Power Rule', 'differentiate power functions of the form x^n, where n is any constant for which the derivative rule applies; focus only on applying the basic power rule, not on combining it with product, quotient, or chain rule situations'),
  ('2_5', 'Constant, Sum, Difference, Constant Multiple Rules', 'differentiate expressions by applying the constant rule and combining derivatives linearly using the sum, difference, and constant multiple rules; focus on basic combinations of simpler functions without requiring product, quotient, or chain rule'),
  ('2_6', 'Derivatives of Trigonometric, Exponential, and Logarithmic Functions', 'differentiate functions using the standard derivative formulas for trigonometric functions, e^x, and ln(x); focus on applying these basic derivative rules directly, without requiring product, quotient, or chain rule'),
  ('2_7', 'Product Rule', 'differentiate products of two differentiable functions using the product rule; focus specifically on expressions that require multiplying two functions, rather than sums, quotients, or compositions alone'),
  ('2_8', 'Quotient Rule', 'differentiate ratios of two differentiable functions using the quotient rule; focus specifically on expressions that require dividing one function by another, rather than sums, products, or compositions alone'),
  ('3_1', 'Chain Rule', 'differentiate composite functions using the chain rule by identifying an outer function and an inner function; focus on expressions where one function is applied to another, rather than products, quotients, or implicit relationships alone'),
  ('3_2', 'Implicit Differentiation', 'differentiate equations involving both x and y implicitly to find dy/dx, without first solving explicitly for y; focus on applying derivative rules to both sides of an equation and treating y as a differentiable function of x'),
  ('3_3', 'Differentiating Inverse Functions', 'differentiate inverse functions by applying the derivative formula for an inverse function, using the relationship between a function and its inverse; focus on using the inverse-function derivative formula rather than implicit differentiation or inverse trig derivative rules'),
  ('3_4', 'Differentiating Inverse Trigonometric Functions', 'differentiate inverse trigonometric functions such as arcsin, arccos, arctan, and others using their standard derivative formulas; focus specifically on inverse trig derivatives rather than general inverse-function rules or implicit differentiation'),
  ('3_5', 'Higher-Order Derivatives', 'compute second, third, or higher-order derivatives by differentiating a function repeatedly; focus on successive differentiation after the first derivative, rather than using derivatives only to analyze graphs or apply rates in context'),
  ('4_1', 'Interpreting the Derivative in Context', 'interpret the meaning of a derivative in a real-world context, including describing what a rate of change represents, identifying appropriate units, and explaining the practical meaning of f''(x) at a given value; focus on interpretation in context rather than computing the derivative itself'),
  ('4_2', 'Straight-Line Motion Differentiation', 'analyze motion along a line by relating position, velocity, and acceleration through derivatives, including finding velocity as the derivative of position and acceleration as the derivative of velocity; focus on calculus relationships among motion quantities rather than interpreting derivative meaning in a general applied context'),
  ('4_3', 'Related Rates', 'differentiate an equation involving two or more variables that change with time in order to relate their rates of change, and solve for an unknown rate using given information at a specific moment; focus on connecting multiple changing quantities rather than analyzing motion along a line or interpreting a derivative in general context'),
  ('4_4', 'Local Linearity and Linearization', 'use the tangent line at a given point to approximate the value of a function near that point, including constructing and applying the linearization L(x); focus on local approximation near a known x-value rather than finding exact function values or modeling related rates'),
  ('4_5', 'L''Hôpital''s Rule', 'evaluate limits that produce indeterminate forms such as 0/0 or infinity/infinity by applying L''Hopital''s Rule and differentiating the numerator and denominator; focus on resolving indeterminate limit forms using derivatives rather than using algebraic simplification or analyzing graphs, tables, or continuity'),
  ('5_1', 'Mean Value Theorem', 'apply the Mean Value Theorem to justify that there exists at least one value c in an interval where the derivative equals the average rate of change over that interval, using the required conditions of continuity and differentiability; focus on guaranteeing existence of such a point rather than finding absolute extrema or using endpoint comparisons'),
  ('5_2', 'Optimization', 'find an absolute maximum or minimum value in an applied context by defining a quantity to optimize, expressing it as a function of one variable, and using derivatives to identify and justify the optimal value; focus on real-world maximization or minimization problems rather than simply classifying critical points or comparing values on a closed interval'),
  ('5_3', 'EVT, Critical Points', 'identify critical points of a function and apply the Extreme Value Theorem on a closed interval to justify that absolute extrema must exist when the required conditions are met; focus on locating critical points and recognizing when extrema are guaranteed to occur, rather than testing intervals of increase/decrease or comparing candidate values'),
  ('5_4', 'Increasing/Decreasing Intervals', 'determine the intervals on which a function is increasing or decreasing by analyzing the sign of its first derivative; focus on identifying where the function rises or falls over intervals, rather than classifying individual critical points as extrema'),
  ('5_5', 'First Derivative Test and Local Min/Max', 'use the First Derivative Test to classify a critical point as a local maximum, local minimum, or neither by analyzing sign changes in f'' around that point; focus on local behavior near individual critical points rather than identifying entire intervals of increase and decrease'),
  ('5_6', 'Candidates Test', 'find the absolute maximum and absolute minimum values of a function on a closed interval by evaluating the function at all critical points and endpoints and comparing those values; focus on selecting and testing candidates for absolute extrema, rather than only guaranteeing their existence or classifying local extrema'),
  ('5_7', 'Concavity', 'determine where a function is concave up or concave down by analyzing the sign of its second derivative, and identify possible inflection points where concavity changes; focus on changes in curvature over intervals rather than classifying critical points as maxima or minima'),
  ('5_8', 'Second Derivative Test', 'use the Second Derivative Test to classify a critical point as a local maximum, local minimum, or inconclusive by evaluating the sign of f'''' at that point; focus on using second-derivative information at individual critical points rather than analyzing sign changes in f'' over intervals'),
  ('5_9', 'Graphs of f and f''', 'analyze the relationship between the graph of a function and the graph of its derivative by connecting features such as increasing and decreasing behavior, critical points, and relative extrema; all problems must require interpreting given graphs rather than computing derivatives from formulas'),
  ('6_1', 'Riemann Sum Approximations', 'estimate the value of a definite integral using left, right, midpoint, or trapezoidal sums when a function rule and the partition or subinterval widths are given explicitly; all problems must specify the interval and partition information and must focus on setting up or computing the approximation from function values, not from a table or graph'),
  ('6_2', 'Riemann Sum Approximations from a Table', 'estimate the value of a definite integral using left, right, midpoint, or trapezoidal sums from a table of function values; all problems must require extracting the needed values from tabular data rather than from a graph or an explicit function formula'),
  ('6_3', 'Riemann Sum Approximations from a Graph', 'estimate the value of a definite integral using left, right, midpoint, or trapezoidal sums from a graph of a function; all problems must require interpreting function values visually from the graph rather than from a table or an explicit function formula'),
  ('6_4', 'Riemann Sums, Summation Notation, Definite Integral Notation', 'match a definite integral to its corresponding Riemann sum or limit written in summation notation, including identifying the interval, partition width, sample points, and integrand; focus on translating between representations rather than approximating numerical values'),
  ('6_5', 'FTC Part 1 Accumulation Functions', 'differentiate accumulation functions defined by an integral with a variable upper bound, including cases that require the chain rule when the upper bound is not simply x; focus on finding the derivative of the accumulation function rather than interpreting its meaning or evaluating the integral itself'),
  ('6_6', 'Interpreting Accumulation Functions', 'analyze accumulation functions defined by integrals in terms of net change, signed area, and rate behavior, including describing when the function is increasing, decreasing, positive, or negative based on the integrand; focus on interpreting the meaning and behavior of the accumulation function rather than differentiating it mechanically'),
  ('6_7', 'FTC Part 2 Evaluating Definite Integrals', 'evaluate a definite integral exactly by applying the Fundamental Theorem of Calculus using an antiderivative, computing F(b) minus F(a); focus on using antiderivatives to evaluate definite integrals rather than approximating area from data or interpreting accumulation functions'),
  ('6_8', 'Antiderivatives and Indefinite Integrals', 'find general antiderivatives of functions using basic antiderivative rules and express answers with an arbitrary constant +C; focus on indefinite integrals and families of functions rather than evaluating over an interval'),
  ('6_9', 'U-Substitution', 'evaluate integrals by using substitution to rewrite the integrand in a simpler form, including choosing an appropriate u, changing variables, and adjusting bounds when the integral is definite; focus on integrals that specifically require substitution rather than basic antiderivative rules alone'),
  ('6_10', 'Finding Definite Integrals from a Function', 'evaluate a definite integral by interpreting it as signed area using the graph or geometric features of a function, including cases with regions above and below the x-axis; focus on geometric area-based evaluation rather than applying antiderivative formulas or numerical approximation methods'),
  ('7_1', 'Verifying Solutions to Differential Equations', 'verify whether a given function is a solution to a differential equation by substituting the function and its derivative into the equation and checking that the statement is satisfied; focus on confirmation by substitution rather than solving the differential equation'),
  ('7_2', 'Slope Fields', 'analyze or interpret a slope field by connecting its local slopes to the behavior of solution curves, or match a slope field to the differential equation that could generate it; focus on visual understanding of differential equations rather than algebraically solving them'),
  ('7_3', 'Separation of Variables General Solution', 'solve a separable differential equation by rewriting it so all y-terms and dy are on one side and all x-terms and dx are on the other, then integrating to find the general solution; focus on the full separation and integration process without applying an initial condition'),
  ('7_4', 'Separation of Variables Particular Solution', 'solve a separable differential equation and then apply a given initial condition to determine the particular solution; focus on using the initial condition after separation and integration to find a specific solution rather than the general family'),
  ('7_5', 'Exponential Growth/Decay Models', 'analyze and solve differential equations of the form dy/dt = ky to model exponential growth or decay, including finding the explicit solution, interpreting the meaning of the constant k, and applying the model in context; focus specifically on exponential change governed by proportional rate rather than general separable equations'),
  ('8_1', 'Average Value of a Function', 'compute the average value of a function over a closed interval using the formula 1/(b-a) times the definite integral from a to b of f(x) dx; focus on finding the average output of a function over an interval rather than interpreting rates or total accumulation in context'),
  ('8_2', 'Position, Velocity, and Acceleration via Integrals', 'recover displacement or position by integrating velocity, and recover velocity by integrating acceleration, including using initial conditions when needed; focus on reversing derivative relationships among motion quantities through integration rather than differentiating motion functions'),
  ('8_3', 'Accumulation in Applied Contexts', 'compute net change or total accumulated amount in a real-world context using a definite integral of a rate function over an interval; focus on interpreting the integral as accumulation in context rather than on motion-specific relationships or the average value formula'),
  ('8_4', 'Area Between Curves, Functions of x', 'find the area between two curves by integrating the difference between the top function and the bottom function with respect to x over the given interval; focus on area found using vertical slices and expressions in terms of x, rather than integrating with respect to y or finding volume'),
  ('8_5', 'Area Between Curves, Functions of y', 'find the area between two curves by integrating the difference between the rightmost function and the leftmost function with respect to y over the given interval; focus on area found using horizontal slices and expressions in terms of y, rather than integrating with respect to x or finding volume'),
  ('8_6', 'Volumes with Cross-Sections', 'find the volume of a solid with known cross-sectional areas by integrating the cross-sectional area function A(x) or A(y) over the given interval; focus on solids built from specified cross-sectional shapes rather than solids formed by rotation'),
  ('8_7', 'Disk Method Around the x- or y-Axis', 'find the volume of a solid of revolution using the disk method when rotating a region around the x-axis or y-axis, where each cross section is a solid disk with no inner radius; focus on volumes formed by rotation with a single radius, not cases requiring inner and outer radii'),
  ('8_8', 'Disk Method Around Other Axes', 'find the volume of a solid of revolution using the disk method when rotating a region around a horizontal or vertical line other than the x-axis or y-axis, adjusting the radius to account for the shifted axis of rotation; focus on solid disks with no hole, but with a non-coordinate axis of rotation'),
  ('8_9', 'Washer Method Around the x- or y-Axis', 'find the volume of a solid of revolution using the washer method when rotating a region around the x-axis or y-axis, where each cross section has both an outer radius and an inner radius; focus on volumes formed by rotation with a hole in the middle, not solid disks'),
  ('8_10', 'Washer Method Around Other Axes', 'find the volume of a solid of revolution using the washer method when rotating a region around a horizontal or vertical line other than the x-axis or y-axis, adjusting both the outer and inner radii to account for the shifted axis of rotation; focus on rotational volumes with a hole and a non-coordinate axis of rotation')
ON CONFLICT (id) DO UPDATE SET
  name        = excluded.name,
  description = excluded.description;

COMMIT;
