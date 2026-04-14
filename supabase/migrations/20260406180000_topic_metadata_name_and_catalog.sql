-- Add topic name (short title); description holds skill/elaboration. Replaces catalog with 58 AP Calc AB topics (adds 1_9).

alter table public.topic_metadata add column if not exists name text;

update public.topic_metadata set name = coalesce(nullif(trim(name), ''), description) where name is null or trim(name) = '';

insert into public.topic_metadata (id, name, description) values
  ('1_1', 'Estimating Limit Values from Graphs', 'read a limit value directly from a graph'),
  ('1_2', 'Estimating Limit Values from Tables', 'read a limit value from a numeric table'),
  ('1_3', 'Determining Limits Using Algebraic Properties', 'factor, rationalize, or substitute to evaluate a limit algebraically'),
  ('1_4', 'Types of Discontinuities', 'classify or identify removable, jump, or infinite discontinuities'),
  ('1_5', 'Defining Continuity at a Point and over an Interval', 'apply the continuity definition'),
  ('1_6', 'Infinite Limits and Vertical Asymptotes', 'evaluate a limit that goes to +/-inf as x approaches a'),
  ('1_7', 'Limits at Infinity and Horizontal Asymptotes', 'find end behavior by comparing degrees or using dominant terms'),
  ('1_8', 'Intermediate Value Theorem', 'invoke IVT to guarantee existence of a value on an interval'),
  ('1_9', 'Trig Limits from Squeeze Theorem', 'Applying sinx/x'),
  ('2_1', 'Average Rate of Change', 'compute the slope of a secant line or estimate a derivative numerically'),
  ('2_2', 'Defining the Derivative; Derivative Notation', 'use the limit definition of the derivative'),
  ('2_3', 'Differentiability', 'applying differentiability definition'),
  ('2_4', 'Power Rule', 'differentiate x^n'),
  ('2_5', 'Constant, Sum, Difference, Constant Multiple Rules', 'combine basic derivative rules linearly'),
  ('2_6', 'Derivatives of trig functions, e^x, lnx', 'apply standard transcendental derivative formulas'),
  ('2_7', 'Product Rule', 'differentiate a product of two functions'),
  ('2_8', 'Quotient Rule', 'differentiate a ratio of two functions'),
  ('3_1', 'Chain Rule', 'differentiate a composite function'),
  ('3_2', 'Implicit Differentiation', 'differentiate an equation in x and y implicitly to find dy/dx'),
  ('3_3', 'Differentiating Inverse Functions', 'apply the (f inverse) prime formula'),
  ('3_4', 'Differentiating Inverse Trig Functions', 'differentiate arcsin, arccos, arctan, etc.'),
  ('3_5', 'Higher-Order Derivatives', 'compute f double prime, f triple prime, or higher'),
  ('4_1', 'Interpreting the Derivative in Context', 'state units or real-world meaning of f prime in an applied scenario'),
  ('4_2', 'Straight-Line Motion Differentiation', 'relate position, velocity, and acceleration using derivatives'),
  ('4_3', 'Related Rates', 'differentiate an equation relating two changing quantities'),
  ('4_4', 'Local Linearity and Linearization', 'build or use a tangent-line approximation L(x)'),
  ('4_5', 'L Hopital Rule', 'resolve a 0/0 or inf/inf indeterminate form by differentiating numerator and denominator'),
  ('5_1', 'Mean Value Theorem', 'invoke MVT to guarantee existence of c where f prime(c) equals the average rate'),
  ('5_2', 'Optimization', 'find an absolute max or min in an applied context using calculus'),
  ('5_3', 'EVT, Critical Points', 'identify critical points; apply EVT on a closed interval'),
  ('5_4', 'Increasing/Decreasing Intervals', 'use the sign of f prime to determine where f rises or falls'),
  ('5_5', 'First Derivative Test and Local Min/Max', 'classify relative extrema by the sign change of f prime at a critical point'),
  ('5_6', 'Candidates Test', 'find absolute extrema on a closed interval by comparing critical point and endpoint values'),
  ('5_7', 'Concavity', 'use the sign of f double prime to determine concave up/down; locate inflection points'),
  ('5_8', 'Second Derivative Test', 'classify a critical point as relative max/min using the sign of f double prime'),
  ('5_9', 'Sketching Graphs of f and f prime', 'connect graph features to derivative behavior'),
  ('6_1', 'Riemann Sum Approximations', 'estimate area using left, right, midpoint, or trapezoidal sums'),
  ('6_2', 'Riemann Sums, Summation Notation, Definite Integral Notation', 'set up or interpret sigma or integral notation'),
  ('6_3', 'FTC Part 1 Accumulation Functions', 'differentiate g(x) = integral from a to x of f(t) dt, using chain rule if needed'),
  ('6_4', 'Interpreting Accumulation Functions', 'describe behavior of F(x) = integral of f in terms of net area or rate'),
  ('6_5', 'FTC Part 2 Evaluating Definite Integrals', 'compute integral from a to b of f dx = F(b) minus F(a)'),
  ('6_6', 'Antiderivatives and Indefinite Integrals', 'apply basic antiderivative rules; include +C'),
  ('6_7', 'U-Substitution', 'use u-substitution to evaluate an integral'),
  ('7_1', 'Verifying Solutions to Differential Equations', 'substitute a function into a DE to confirm it satisfies the equation'),
  ('7_2', 'Slope Fields', 'read or match a slope field to a differential equation'),
  ('7_3', 'Separation of Variables General Solution', 'separate dy and dx; integrate both sides; solve for y'),
  ('7_4', 'Separation of Variables Particular Solution', 'apply an initial condition after separating variables'),
  ('7_5', 'Exponential Growth/Decay Models', 'solve dy/dt = ky; interpret k and the model in context'),
  ('8_1', 'Average Value of a Function', 'compute (1/(b-a)) times integral from a to b of f dx'),
  ('8_2', 'Position/Velocity/Acceleration via Integrals', 'recover position or displacement by integrating velocity'),
  ('8_3', 'Accumulation in Applied Contexts', 'compute net change or total amount as a definite integral in a real scenario'),
  ('8_4', 'Area Between Curves Functions of x', 'integrate |f(x) - g(x)| with respect to x'),
  ('8_5', 'Area Between Curves Functions of y', 'integrate with respect to y'),
  ('8_6', 'Volumes with Cross-Sections', 'integrate A(x) or A(y) for a known cross-sectional shape'),
  ('8_7', 'Disk Method Around x or y Axis', 'integrate pi times [f(x)] squared'),
  ('8_8', 'Disk Method Around Other Axes', 'shift the radius when revolving around a non-coordinate axis'),
  ('8_9', 'Washer Method Around x or y Axis', 'integrate pi times ([f(x)] squared minus [g(x)] squared)'),
  ('8_10', 'Washer Method Around Other Axes', 'adjust inner and outer radii for a non-coordinate axis')
on conflict (id) do update set
  name = excluded.name,
  description = excluded.description;

alter table public.topic_metadata alter column name set not null;

delete from public.topic_metadata tm
where tm.id not in (
  '1_1','1_2','1_3','1_4','1_5','1_6','1_7','1_8','1_9',
  '2_1','2_2','2_3','2_4','2_5','2_6','2_7','2_8',
  '3_1','3_2','3_3','3_4','3_5',
  '4_1','4_2','4_3','4_4','4_5',
  '5_1','5_2','5_3','5_4','5_5','5_6','5_7','5_8','5_9',
  '6_1','6_2','6_3','6_4','6_5','6_6','6_7',
  '7_1','7_2','7_3','7_4','7_5',
  '8_1','8_2','8_3','8_4','8_5','8_6','8_7','8_8','8_9','8_10'
)
and not exists (
  select 1
  from public.problems p
  where coalesce(p.topic_weights, '{}'::jsonb) ? tm.id
);
