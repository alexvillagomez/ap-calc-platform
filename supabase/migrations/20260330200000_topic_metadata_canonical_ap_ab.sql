-- Canonical AP Calculus AB subtopic catalog (57 rows): id + description only.
-- Drops legacy unit_name if present, then upserts; removes unreferenced extras.

alter table public.topic_metadata drop column if exists unit_name;

insert into public.topic_metadata (id, description) values
  ('1_1', 'Estimating Limit Values from Graphs'),
  ('1_2', 'Estimating Limit Values from Tables'),
  ('1_3', 'Determining Limits Using Algebraic Properties of Limits'),
  ('1_4', 'Types of Discontinuities'),
  ('1_5', 'Defining Continuity at a Point and over an Interval'),
  ('1_6', 'Infinite Limits and Vertical Asymptotes'),
  ('1_7', 'Limits at Infinity and Horizontal Asymptotes'),
  ('1_8', 'Working with the Intermediate Value Theorem (IVT)'),
  ('2_1', 'Defining the Derivative of a Function and Using Derivative Notation'),
  ('2_2', 'Estimating Derivatives of a Function at a Point'),
  ('2_3', 'Differentiability'),
  ('2_4', 'Applying the Power Rule'),
  ('2_5', 'Derivative Rules: Constant Sum Difference and Constant Multiple'),
  ('2_6', 'Derivatives of cos x sin x e^x and ln x'),
  ('2_7', 'Product Rule'),
  ('2_8', 'Quotient Rule'),
  ('3_1', 'Chain Rule'),
  ('3_2', 'Implicit Differentiation'),
  ('3_3', 'Differentiating Inverse Functions'),
  ('3_4', 'Differentiating Inverse Trigonometric Functions'),
  ('3_5', 'Calculating Higher-Order Derivatives'),
  ('4_1', 'Interpreting the Meaning of the Derivative in Context'),
  ('4_2', 'Straight-Line Motion: Connecting Position Velocity and Acceleration'),
  ('4_3', 'Solving Related Rates Problems'),
  ('4_4', 'Approximating Values of a Function Using Local Linearity and Linearization'),
  ('4_5', 'L''hopital''s Rule'),
  ('5_1', 'Mean Value Theorem'),
  ('5_2', 'Solving Optimization Problems'),
  ('5_3', 'Extreme Value Theorem Global Versus Local Extrema and Critical Points'),
  ('5_4', 'Determining Intervals on Which a Function Is Increasing or Decreasing'),
  ('5_5', 'Using the First Derivative Test to Determine Relative (Local) Extrema'),
  ('5_6', 'Using the Candidates Test to Determine Absolute (Global) Extrema'),
  ('5_7', 'Determining Concavity of Functions over Their Domains'),
  ('5_8', 'Using the Second Derivative Test to Determine Extrema'),
  ('5_9', 'Sketching Graphs of Functions and Their Derivatives'),
  ('6_1', 'Approximating Areas with Riemann Sums'),
  ('6_2', 'Riemann Sums Summation Notation and Definite Integral Notation'),
  ('6_3', 'The Fundamental Theorem of Calculus and Accumulation Functions'),
  ('6_4', 'Interpreting the Behavior of Accumulation Functions Involving Area'),
  ('6_5', 'The Fundamental Theorem of Calculus and Definite Integrals'),
  ('6_6', 'Finding Antiderivatives and Indefinite Integrals'),
  ('6_7', 'Integrating Using Substitution'),
  ('7_1', 'Verifying Solutions for Differential Equations'),
  ('7_2', 'Slope Fields'),
  ('7_3', 'General Solutions Using Separation of Variables'),
  ('7_4', 'Particular Solutions Using Initial Conditions and Separation of Variables'),
  ('7_5', 'Exponential Models with Differential Equations'),
  ('8_1', 'Finding the Average Value of a Function on an Interval'),
  ('8_2', 'Connecting Position Velocity and Acceleration of Functions Using Integrals'),
  ('8_3', 'Using Accumulation Functions and Definite Integrals in Applied Contexts'),
  ('8_4', 'Finding the Area Between Curves Expressed as Functions of x'),
  ('8_5', 'Finding the Area Between Curves Expressed as Functions of y'),
  ('8_6', 'Volumes with cross-sections'),
  ('8_7', 'Volume with Disc Method: Revolving Around the x- or y-Axis'),
  ('8_8', 'Volume with Disc Method: Revolving Around Other Axes'),
  ('8_9', 'Volume with Washer Method: Revolving Around the x- or y-Axis'),
  ('8_10', 'Volume with Washer Method: Revolving Around Other Axes')
on conflict (id) do update set
  description = excluded.description;

delete from public.topic_metadata tm
where tm.id not in (
  '1_1','1_2','1_3','1_4','1_5','1_6','1_7','1_8',
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
