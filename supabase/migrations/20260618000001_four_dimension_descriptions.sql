-- Four-dimension grounding for math_questions + mcat_questions.
--
-- Every question is grounded along FOUR dimensions, each with its own natural-
-- language description, its own embedding, and its own keyword tagging:
--   1. PROBLEM   — what the problem asks/tests   → tagged to CONTENT keywords
--                  (content tagging already lives in keyword_weights; this adds the
--                   problem_description text + its embedding)
--   2. WRONG ANSWER (per distractor)             → already in wrong_answer_data
--                  ({description, embedding, keyword_weights} per choice)
--   3. ACTION    — the cognitive action/skill    → tagged to ACTION keywords
--   4. REPRESENTATION — the format/representation → tagged to REPRESENTATION keywords
--
-- Mirrors the legacy rag_examples four-dimension model (topic/action/representation/
-- prerequisite descriptions + *_weights). Everything is additive + fail-soft.

-- ── Per-question description + embedding + dimension-weight columns ──────────────
ALTER TABLE math_questions
  ADD COLUMN IF NOT EXISTS problem_description text,
  ADD COLUMN IF NOT EXISTS problem_description_embedding jsonb,
  ADD COLUMN IF NOT EXISTS action_description text,
  ADD COLUMN IF NOT EXISTS action_description_embedding jsonb,
  ADD COLUMN IF NOT EXISTS action_weights jsonb,
  ADD COLUMN IF NOT EXISTS representation_description text,
  ADD COLUMN IF NOT EXISTS representation_description_embedding jsonb,
  ADD COLUMN IF NOT EXISTS representation_weights jsonb;

ALTER TABLE mcat_questions
  ADD COLUMN IF NOT EXISTS problem_description text,
  ADD COLUMN IF NOT EXISTS problem_description_embedding jsonb,
  ADD COLUMN IF NOT EXISTS action_description text,
  ADD COLUMN IF NOT EXISTS action_description_embedding jsonb,
  ADD COLUMN IF NOT EXISTS action_weights jsonb,
  ADD COLUMN IF NOT EXISTS representation_description text,
  ADD COLUMN IF NOT EXISTS representation_description_embedding jsonb,
  ADD COLUMN IF NOT EXISTS representation_weights jsonb;

-- ── Action & representation keyword DIMENSIONS (subject-wide, not per-category) ──
-- Content keywords already exist as math_keywords / mcat_keywords (tier
-- umbrella/in_depth). These small fixed vocabularies are the other two dimensions
-- that action_weights / representation_weights tag against.
CREATE TABLE IF NOT EXISTS math_action_keywords (
  id text PRIMARY KEY,
  label text NOT NULL,
  description text,
  embedding jsonb,
  created_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS math_representation_keywords (
  id text PRIMARY KEY,
  label text NOT NULL,
  description text,
  embedding jsonb,
  created_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS mcat_action_keywords (
  id text PRIMARY KEY,
  label text NOT NULL,
  description text,
  embedding jsonb,
  created_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS mcat_representation_keywords (
  id text PRIMARY KEY,
  label text NOT NULL,
  description text,
  embedding jsonb,
  created_at timestamptz DEFAULT now()
);

-- ── Seed the taxonomies (labels + descriptions; embeddings filled by a script) ──
INSERT INTO math_action_keywords (id, label, description) VALUES
  ('evaluate',     'Evaluate',     'Compute the numerical or symbolic value of an expression at given inputs.'),
  ('solve',        'Solve',        'Find the value(s) of an unknown that satisfy an equation or inequality.'),
  ('simplify',     'Simplify',     'Rewrite an expression in a simpler or canonical equivalent form.'),
  ('factor',       'Factor',       'Rewrite an expression as a product of factors.'),
  ('expand',       'Expand',       'Multiply out / distribute to write an expression as a sum of terms.'),
  ('graph',        'Graph',        'Produce or read a graph of a function or relation.'),
  ('interpret',    'Interpret',    'Explain the meaning of a quantity, expression, or result in context.'),
  ('justify',      'Justify',      'Give reasoning or a proof to support a claim or step.'),
  ('estimate',     'Estimate',     'Approximate a value, often from a table, graph, or bound.'),
  ('differentiate','Differentiate','Find a derivative or rate of change.'),
  ('integrate',    'Integrate',    'Find an integral, antiderivative, or accumulated quantity.'),
  ('apply_theorem','Apply a Theorem','Apply a named theorem/rule (e.g. IVT, MVT, limit laws) to reach a conclusion.'),
  ('analyze',      'Analyze',      'Break a situation into parts to determine behavior (intervals, signs, extrema).'),
  ('compare',      'Compare',      'Relate two or more quantities, rates, or representations.'),
  ('model',        'Model',        'Translate a real-world or verbal situation into a mathematical expression.'),
  ('identify',     'Identify',     'Recognize or name a feature, form, or applicable concept.'),
  ('rewrite',      'Rewrite',      'Transform an expression into an equivalent form needed for a next step.')
ON CONFLICT (id) DO NOTHING;

INSERT INTO math_representation_keywords (id, label, description) VALUES
  ('symbolic_analytic', 'Symbolic / Analytic', 'Algebraic symbols, equations, formulas, and analytic manipulation.'),
  ('graphical',         'Graphical',           'Graphs, curves, and visual/geometric representations.'),
  ('numerical_tabular', 'Numerical / Tabular', 'Tables of values, numeric data, and numerical approximation.'),
  ('verbal_contextual', 'Verbal / Contextual', 'Words, real-world context, and natural-language descriptions of relationships.')
ON CONFLICT (id) DO NOTHING;

INSERT INTO mcat_action_keywords (id, label, description) VALUES
  ('recall',            'Recall',            'Retrieve a fact, value, definition, or named entity from memory.'),
  ('identify',          'Identify',          'Recognize or name a structure, molecule, process, or concept.'),
  ('explain',           'Explain',           'Describe the mechanism or reason behind a phenomenon.'),
  ('apply',             'Apply',             'Use a concept or principle in a specific scenario.'),
  ('analyze',           'Analyze',           'Break a system or process into parts to determine relationships.'),
  ('evaluate',          'Evaluate',          'Judge validity, significance, or the best option among alternatives.'),
  ('interpret',         'Interpret',         'Draw meaning from text, a figure, a graph, or experimental data.'),
  ('calculate',         'Calculate',         'Perform a quantitative computation to reach a numeric answer.'),
  ('compare',           'Compare',           'Contrast two or more entities, processes, or conditions.'),
  ('predict',           'Predict',           'Determine the outcome of a change, perturbation, or experiment.'),
  ('reason_from_data',  'Reason from Data',  'Draw a conclusion supported by experimental results or a data set.'),
  ('integrate_concepts','Integrate Concepts','Combine ideas across topics/disciplines to reach a conclusion.')
ON CONFLICT (id) DO NOTHING;

INSERT INTO mcat_representation_keywords (id, label, description) VALUES
  ('prose_passage',       'Prose / Passage',       'Information conveyed in narrative text or an experimental passage.'),
  ('figure_diagram',      'Figure / Diagram',      'Anatomical/biological diagrams, pathways, or schematic figures.'),
  ('graph',               'Graph',                 'Plots and graphs (e.g. kinetics curves, dose-response).'),
  ('data_table',          'Data Table',            'Tabulated experimental or reference data.'),
  ('equation_expression', 'Equation / Expression', 'Equations, formulas, and quantitative expressions.'),
  ('experimental_setup',  'Experimental Setup',    'A described experiment, method, or procedure to reason about.')
ON CONFLICT (id) DO NOTHING;
