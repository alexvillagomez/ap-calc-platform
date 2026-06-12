# Database Inventory — Math Content (precalc / calc_ab)

Generated: 2026-06-11  
Project: `czjyvmpvxejsrctxgqke` → `https://nnkpvezsyumryhnulyvt.supabase.co`  
Branch context: `math-system`

---

## 1. `learn_categories` — 29 rows

| id | name | order_index |
|----|------|-------------|
| exponents_and_radicals | Exponents and Radicals | **0** (unset) |
| trigonometry | Trigonometry | **0** (unset) |
| rational_functions | Rational Functions | **0** (unset) |
| exponential_and_logarithmic_functions | Exponential and Logarithmic Functions | **0** (unset) |
| number_systems_and_properties | Number Systems and Properties | 1 |
| algebraic_expressions | Algebraic Expressions | 2 |
| linear_equations_and_inequalities | Linear Equations and Inequalities | 3 |
| systems_of_equations | Systems of Equations | 4 |
| polynomials | Polynomials | 13 |
| functions | Functions | 20 |
| function_transformations | Function Transformations | 22 |
| inverse_functions | Inverse Functions | 24 |
| piecewise_functions | Piecewise Functions | 25 |
| action_tags | Action Tags | 100 |
| action_items | Action Items | 100 |
| representations | Representations | 100 |
| representation_tags | Representation Tags | 101 |
| problem_style_tags | Problem Style Tags | 102 |
| mcat_biology_amino_acids_and_proteins | Amino Acids and Proteins | 100 |
| mcat_biology_enzymes_and_protein_function | Enzymes and Protein Function | 101 |
| mcat_biology_nucleic_acids_and_gene_expression | Nucleic Acids and Gene Expression | 102 |
| mcat_biology_genetics_evolution_and_inheritance | Genetics, Evolution, and Inheritance | 103 |
| mcat_biology_bioenergetics_and_metabolism | Bioenergetics and Metabolism | 104 |
| mcat_biology_cell_structure_membranes_and_transport | Cell Structure, Membranes, and Transport | 105 |
| mcat_biology_prokaryotes_viruses_and_biotechnology | Prokaryotes, Viruses, and Biotechnology | 106 |
| mcat_biology_cell_cycle_development_and_reproduction | Cell Cycle, Development, and Reproduction | 107 |
| mcat_biology_nervous_and_endocrine_systems | Nervous and Endocrine Systems | 108 |
| mcat_biology_organ_systems_and_homeostasis | Organ Systems and Homeostasis | 109 |

**Notes:**
- 13 categories are precalc/calc-math. 10 are MCAT biology. 4 are tag/meta categories. 2 are unused tag categories (`action_tags`, `representation_tags`).
- 7 math categories have **no learn_keywords yet**: `trigonometry`, `rational_functions`, `exponential_and_logarithmic_functions`, `functions`, `function_transformations`, `inverse_functions`, `piecewise_functions`.
- 4 categories have `order_index = 0` (likely unset): `trigonometry`, `rational_functions`, `exponents_and_radicals`, `exponential_and_logarithmic_functions`.

---

## 2. `learn_keywords` — 995 rows

### 2a. Tier distribution (all 995)

| tier | count |
|------|-------|
| umbrella | 169 |
| in_depth | 826 |

### 2b. Status distribution

All 995 rows have `status = "approved"`. No drafts or deprecated rows.

### 2c. keyword_type distribution

| keyword_type | count |
|-------------|-------|
| umbrella | 169 |
| topic | 783 |
| action | 43 |

### 2d. Domain breakdown

| domain | count |
|--------|-------|
| Precalc math (6 categories) | 777 |
| MCAT biology (10 categories) | 161 |
| Tag/meta (`representations`, `action_items`) | 57 |

### 2e. Yield / importance field

`learn_keywords` does **not** have a `yield_level`, `yield_rationale`, or `importance` column. No yield data is embedded in `description` text or `examples` JSONB either. Yield lives exclusively in **`mcat_keywords`** (in_depth tier only; umbrella rows have `yield_level = null`). There is no precalc yield signal in the current schema.

### 2f. Umbrella keywords per math category

| category | umbrella count |
|----------|---------------|
| number_systems_and_properties | 10 |
| algebraic_expressions | 7 |
| linear_equations_and_inequalities | 10 |
| systems_of_equations | 10 |
| exponents_and_radicals | 10 |
| polynomials | 10 |

Full umbrella list per math category:

**number_systems_and_properties (10):**
- number_representations, integer_divisibility_and_factor_structure, signed_number_structure, rational_number_arithmetic, percent_and_proportional_number_structure, real_number_order_and_comparison, real_number_operation_properties, numeric_expression_structure, approximation_estimation_and_bounds, real_number_classification

**algebraic_expressions (7):**
- substitution_into_expressions, like_terms_and_term_collection, algebraic_expression_order_and_grouping, distribution_and_expansion, equivalent_expression_properties, algebraic_expression_structure, verbal_to_symbolic_expression_structure

**linear_equations_and_inequalities (10):**
- linear_equation_foundations, one_step_linear_equations, two_step_linear_equations, multi_step_linear_equations, literal_equations_and_formula_rearrangement, linear_inequality_foundations, one_and_two_step_linear_inequalities, multi_step_linear_inequalities, compound_linear_inequalities, linear_equation_and_inequality_interpretation

**systems_of_equations (10):**
- systems_foundations_and_solution_sets, graphical_systems_of_linear_equations, substitution_method_linear_systems, elimination_method_linear_systems, linear_system_preparation_and_structure, special_case_and_parameter_linear_systems, three_variable_linear_systems_non_matrix, systems_of_linear_inequalities, nonlinear_systems_of_equations, structured_linear_system_relationships

**exponents_and_radicals (10):**
- exponent_notation_and_structure, integer_exponent_laws, zero_and_negative_exponent_structure, scientific_notation_with_powers_of_ten, rational_exponent_structure, radical_notation_and_root_structure, radical_factor_structure_and_rewriting, radical_operations_and_like_radicals, rationalizing_and_radical_denominators, radical_equations_and_rational_exponent_equations

**polynomials (10):**
- polynomial_structure_and_classification, polynomial_values_and_identities, polynomial_addition_and_subtraction, polynomial_multiplication_and_special_products, gcf_factoring_and_grouping, quadratic_and_special_form_factoring, polynomial_division_and_factor_theorems, polynomial_equations_and_roots, polynomial_zeros_and_graph_behavior, polynomial_tables_and_finite_differences

### 2g. in_depth counts per umbrella (math categories only)

| umbrella | category | in_depth count | 3 sample labels |
|---------|----------|---------------|-----------------|
| real_number_classification | number_systems | 13 | Whole numbers, Integers, Rational numbers |
| number_representations | number_systems | 12 | Decimal place value, Expanded notation, Equivalent fraction forms |
| integer_divisibility_and_factor_structure | number_systems | 13 | Even and odd integers, Parity of sums, Factors and multiples |
| signed_number_structure | number_systems | 11 | Opposite numbers, Absolute value as magnitude, Distance on number line |
| rational_number_arithmetic | number_systems | 11 | Fraction addition with common denominators, Fraction subtraction, LCD |
| real_number_operation_properties | number_systems | 18 | Commutative property addition, Commutative property multiplication, Noncommutativity |
| percent_and_proportional_number_structure | number_systems | 10 | Percent as rate per hundred, Percent of a number, Percent increase factors |
| algebraic_expression_structure | algebraic_expressions | 17 | Variables as quantities, Constants in expressions, Coefficients |
| substitution_into_expressions | algebraic_expressions | 13 | Single-variable substitution, Multiple occurrences same variable, Multi-variable substitution |
| like_terms_and_term_collection | algebraic_expressions | 14 | Like terms same variable part, Unlike terms diff variables, Unlike terms diff powers |
| distribution_and_expansion | algebraic_expressions | 15 | Distribution by negative integer, Distribution by decimal, Distribution by variable |
| verbal_to_symbolic_expression_structure | algebraic_expressions | 15 | Addition phrase expressions, Subtraction phrase expressions, Less-than phrase order |
| multi_step_linear_equations | linear_eq | 18 | Like-term collection one side, Distribution one side, Negative distribution |
| one_and_two_step_linear_inequalities | linear_eq | 16 | One-step addition, One-step subtraction, One-step positive multiplication |
| linear_inequality_foundations | linear_eq | 15 | Inequality statement structure, Strict inequality symbols, Inclusive inequality |
| integer_exponent_laws | exponents | 18 | Product rule same single-variable base, Product rule numeric base, Product rule multiple factors |
| radical_factor_structure_and_rewriting | exponents | 16 | Perfect-square factors in square roots, Perfect-cube factors, Perfect nth-power factors |
| polynomial_structure_and_classification | polynomials | 24 | Polynomial term structure, Polynomial constant term, Leading term |
| quadratic_and_special_form_factoring | polynomials | 16 | Factoring monic quadratic trinomials, Factoring non-monic, AC method |
| polynomial_zeros_and_graph_behavior | polynomials | 15 | Maximum turning points from degree, Zero-factor relationship, Zeros from factored form |

### 2h. Examples population

- 826 / 995 keywords have non-empty `examples` arrays (all in_depth math + action keywords)
- 169 umbrella keywords and most MCAT keywords have empty `examples`

### 2i. Orphans

- 8 in_depth keywords in the `representations` category have `parent_keyword_id = null`:
  `diagram`, `graphical`, `tabular`, `exact_form`, `approximate_form` (plus 3 more).
  These are intentional tag-type keywords, not a structural defect.

---

## 3. Problem tables

### 3a. `learn_practice_problems` — 24 rows

| topic_id | count |
|----------|-------|
| polynomials | 24 |

**Difficulty distribution:**

| difficulty | count |
|-----------|-------|
| 1 | 6 |
| 2 | 3 |
| 3 | 15 |

**Unique keywords covered:** 7  
(`binomial_times_binomial`, `polynomial_term_structure`, `polynomial_constant_term`, `polynomial_coefficients`, `leading_term_polynomial`, `leading_coefficient_polynomial`, `polynomial_standard_form`)

**Schema columns:** id, keyword_id, topic_id, latex_content, solution_latex, choices (array), correct_index, difficulty, hint_latex, embedding, avg_rating, rating_count, report_count, description

**Sample row 1:**
- keyword_id: `binomial_times_binomial`, difficulty: 1
- latex_content: `\text{Expand and simplify: }(x+3)(x+5).`
- choices: `["$x^2+8x+15$","$x^2+15$","$x^2+5x+3$","$2x^2+8x+15$"]`
- correct_index: 0
- hint_latex: `\text{Use FOIL: multiply each term in the first binomial by each term in the second, then combine like terms.}`

**Sample row 2:**
- keyword_id: `binomial_times_binomial`, difficulty: 1
- latex_content: `\text{Expand and simplify: }(x-2)(x+7).`
- choices: `["$x^2+5x-14$","$x^2-9x-14$","$x^2+9x-14$","$x^2+5x+14$"]`
- correct_index: 0

### 3b. `learn_diagnostic_problems` — 0 rows (empty)

Table exists in the schema but contains no data.

### 3c. `learn_mastery_quiz_problems` — 8 rows

| difficulty | count |
|-----------|-------|
| 3 | 3 |
| 4 | 5 |

**Keywords covered:** `power_of_a_power` (4 rows), `quotient_of_powers` (4 rows)

**Schema columns:** id, keyword_id, latex_content, choices, correct_index, difficulty, solution_latex, avg_rating, rating_count, report_count (no hint_latex, no topic_id)

**Sample row 1:**
- keyword_id: `power_of_a_power`, difficulty: 3
- latex_content: `Simplify the expression: $(x^3)^4$`
- choices: `["$x^{12}$","$x^7$","$x^{81}$","$x^{34}$"]`
- correct_index: 0
- solution_latex: `$(x^3)^4 = x^{3\cdot 4} = x^{12}$`

**Sample row 2:**
- keyword_id: `power_of_a_power`, difficulty: 4
- latex_content: `Simplify the expression: $(2a^5)^3$`
- choices: `["$2a^{15}$","$8a^{15}$","$6a^{8}$","$2a^{8}$"]`
- correct_index: 1

---

## 4. `rag_examples` — 399 rows

### 4a. By course

| course | count |
|--------|-------|
| precalc | 399 |
| ap_calc | 0 |

All 399 rows are precalc. No calc_ab content yet.

### 4b. By difficulty

| difficulty (int) | estimated_difficulty (float) | count |
|-----------------|------------------------------|-------|
| 1 | 0.20 | 133 |
| 2 | 0.35 | 133 |
| 3 | 0.50 | 133 |

Perfectly balanced across three difficulty tiers.

### 4c. Topic distribution (via keyword_weights)

Top 20 keywords referenced (by problem count):

| keyword | appearances |
|---------|-------------|
| polynomial_expression_definition | 31 |
| leading_term_polynomial | 30 |
| missing_terms_zero_coefficients | 30 |
| zeros_from_factored_form | 30 |
| polynomial_coefficients | 24 |
| cancellation_creating_missing_terms | 24 |
| solving_factored_polynomial_equations | 23 |
| zero_product_property_polynomial_equations | 22 |
| adding_polynomials_like_terms | 21 |
| polynomial_standard_form | 21 |
| polynomial_term_structure | 21 |
| binomial_times_binomial | 21 |
| factoring_difference_of_squares | 21 |
| factoring_nonmonic_quadratic_trinomials | 20 |
| polynomial_gcf_monomial | 20 |
| polynomial_degree_univariate | 19 |
| polynomial_zero_factor_relationship | 19 |
| polynomial_constant_term | 18 |
| leading_coefficient_polynomial | 18 |
| end_behavior_from_leading_term | 18 |

All 399 precalc rag_examples are focused on the **polynomials** topic. Other precalc categories (number_systems, algebraic_expressions, linear_equations, systems_of_equations, exponents_and_radicals) have **zero** rag_examples.

### 4d. Schema columns (no embedding)

id, keyword_weights (JSONB), latex_content, solution_latex, choices (array), correct_index, notes, difficulty, estimated_difficulty, course, problem_description, wrong_answer_data (JSONB array), calculator_allowed, distractor_pool, avg_rating, rating_count, report_count, description, topic_description, action_weights (JSONB), action_description, representation_weights (JSONB), representation_description, prerequisite_weights (JSONB), prerequisite_description, promoted_problem_id

### 4e. wrong_answer_data shape

Array of 4 objects (one per wrong choice + the null placeholder for correct):
```json
[
  {
    "description": "Used only first matching coefficient",
    "keyword_weights": {
      "elimination_with_matching_coefficients": 0.2153,
      "coefficient_comparison_in_polynomial_identities": 0.251,
      ...
    }
  },
  { "description": null, "keyword_weights": {} }
]
```
Each wrong answer has a `description` (text explanation of the misconception) and `keyword_weights` (JSONB mapping misconception-related keyword IDs to weights). The correct answer slot has `description: null` and empty weights.

### 4f. Full sample rows (3 precalc examples)

**Sample 1** (difficulty 3 / estimated_difficulty 0.50):
- id: `a247395d-774e-4c5f-9985-0d9a01bc4a43`
- keyword_weights: `{polynomial_coefficients:0.1655, additive_inverse_like_terms:0.1264, adding_polynomials_like_terms:0.2184, cancellation_creating_missing_terms:0.0805, coefficient_combination_integer_coefficients:0.2069, coefficient_combination_negative_coefficients:0.2023}`
- latex_content: `After combining like terms, what is the coefficient of $y^3$ in $(4y^3-2y+5)+(-9y^3+7y^2-y)$?`
- correct_index: 3, choices end with `"$-5$"`
- action_weights: `{combine:0.65, identify:0.35}`
- representation_weights: `{verbal:0.7167, symbolic:0.2833}`
- prerequisite_weights: `{term_signs_in_expressions:0.2315, like_terms_same_variable_part:0.3055, ...}`

**Sample 2** (difficulty 3 / estimated_difficulty 0.50):
- id: `9acab903-0514-45cf-a887-109da80c4050`
- keyword_weights: `{polynomial_coefficient_domain:0.25, polynomial_expression_definition:0.5833, polynomial_expression_domain_all_real:0.1667}`
- latex_content: `Over the real numbers, which expression is not a polynomial?`
- correct_index: 3 ($5x^3+x^{2/3}-9$)
- action_weights: `{identify:0.4257, distinguish:0.2079, error_analysis:0.3663}`

**Sample 3** (difficulty 2 / estimated_difficulty 0.35):
- id: `c6d603db-293e-4acc-b0b7-6b9c57cddb27`
- keyword_weights: `{descending_power_order:0.19, polynomial_standard_form:0.1741, polynomial_term_structure:0.2507, term_signs_in_expressions:0.2322, term_reordering_for_collection:0.153}`
- latex_content: `Which list correctly gives the terms of $5-3m^4+8m^2-2m$?`
- correct_index: 0

---

## 5. `problems` table — 0 rows

Table exists (confirmed via schema introspection and content-range header returning `*/0`). No rows. This table was likely used for a previous diagnostic system and is now empty.

---

## 6. Lesson / refresher / tip tables

### 6a. `learn_lessons` — 5 rows

Keywords covered: `binomial_times_binomial`, `leading_term_polynomial`, `polynomial_coefficients`, `polynomial_constant_term`, `polynomial_term_structure`

**Schema:** id, keyword_id, micro_steps (JSONB array), model, generated_at, helpful_count, not_helpful_count, avg_rating, rating_count, report_count

**micro_steps shape** (each step is an object):
```json
{
  "step_index": 1,
  "has_check": true,
  "hint_latex": "",
  "explanation_latex": "The constant term is the part of a polynomial with no variable...",
  "example_latex": "In $3x+5$, the constant term is $5$ because it has no $x$.",
  "check_question": {
    "latex_content": "Which term is the constant term in $2x+9$?",
    "choices": ["$2x$", "$9$", "$2$", "$x$"],
    "correct_index": 1,
    "hint_latex": "Look for the term without $x$.",
    "solution_latex": "The constant term has no variable..."
  }
}
```
Each lesson has 3 micro_steps. Step 3 typically connects the concept to a broader application (e.g., y-intercept relationship for constant term). Model: `gpt-5.4-mini`.

### 6b. `learn_refreshers` — 0 rows (empty)

Table exists but contains no data.

### 6c. `learn_tips` — 1 row

- keyword_id: `leading_term_polynomial`
- tip_latex: `Remember: in standard form, the leading term is the highest-degree nonzero term, and it controls end behavior.`
- Schema: id, keyword_id, tip_latex, model, generated_at, helpful_count, not_helpful_count (no rating_count)

---

## 7. `mcat_keywords` — 847 rows

### 7a. Tier distribution

| tier | count |
|------|-------|
| umbrella | 106 |
| in_depth | 741 |

### 7b. yield_level distribution (in_depth only; umbrella = null)

| yield_level | count |
|-------------|-------|
| high | 267 |
| medium | 415 |
| low | 59 |
| null (umbrella) | 106 |

### 7c. concept_blueprint population

- 741 / 847 have `concept_blueprint` (all in_depth; all umbrella are null)
- Also 741 have `yield_level` and `yield_rationale` populated

### 7d. Category distribution

| category | umbrella | in_depth |
|----------|----------|---------|
| mcat_biology_amino_acids_and_proteins | 8 | 55 |
| mcat_biology_enzymes_and_protein_function | 7 | 49 |
| mcat_biology_nucleic_acids_and_gene_expression | 10 | 69 |
| mcat_biology_genetics_evolution_and_inheritance | 10 | 71 |
| mcat_biology_bioenergetics_and_metabolism | 11 | 79 |
| mcat_biology_cell_structure_membranes_and_transport | 11 | 75 |
| mcat_biology_prokaryotes_viruses_and_biotechnology | 10 | 70 |
| mcat_biology_cell_cycle_development_and_reproduction | 9 | 63 |
| mcat_biology_nervous_and_endocrine_systems | 10 | 70 |
| mcat_biology_organ_systems_and_homeostasis | 20 | 140 |

### 7e. Sample concept_blueprint values

**Example 1** (prokaryotic flagella rotation):
```json
{
  "key_terms": ["flagellum","flagella","rotation","propeller","motility","prokaryote"],
  "in_scope_concepts": ["prokaryotic flagella rotate like propellers","rotation produces cell propulsion/motility","distinguishing prokaryotic flagellar motion from eukaryotic 9+2 beating/bending"],
  "out_of_scope": ["cell wall composition","absence of membrane-bound organelles","70S ribosome size"],
  "in_scope_formulas": [],
  "boundary_statement": "Test only the rotational propeller mechanism of prokaryotic flagella and must not require any other prokaryotic structure, classification, or growth concept."
}
```

**Example 2** (sulfur-containing amino acids):
```json
{
  "key_terms": ["cysteine","methionine","thiol","thioether","disulfide bond","cystine"],
  "in_scope_concepts": ["cysteine: reactive thiol side chain","methionine: thioether side chain","cysteine can form disulfide bonds under oxidizing conditions"],
  "out_of_scope": ["general amino acid classification","protein-environment prediction","peptide bond formation"],
  "in_scope_formulas": [],
  "boundary_statement": "Test only recognition of cysteine and methionine as sulfur-containing residues and cysteine's disulfide-forming thiol."
}
```

---

## 8. `anki_cards` — 2,887 rows

Confirmed via `content-range: 0-0/2887`. Schema not queried; counts only as requested.

---

## 9. `packages/constants/keywords.json` — Analysis

### Structure

Top-level keys: `design_note`, `tracking_tiers`, `keyword_taxonomy`

**design_note:** "Keyword vocabulary for database tagging and RAG retrieval. Problems should be multi-tagged across categories. Categories are marked as either `strength_tracked` (drive student keyword_strengths updates) or `tag_only` (used for retrieval/variety only)."

### Tracking tiers

**strength_tracked (17 categories):**
function_families, numerical_and_algebra_prerequisites, exponent_and_log_skills, geometry_and_measurement_prerequisites, trig_and_precalc_prerequisites, unit_1_limits_and_continuity, unit_2_derivative_definition_and_basic_rules, unit_3_composite_implicit_and_inverse_functions, unit_4_contextual_applications_of_differentiation, unit_5_analytical_applications_of_differentiation, unit_6_integration_and_accumulation, unit_7_differential_equations, unit_8_applications_of_integration, cognitive_tasks, derivative_structure_keywords, limit_structure_keywords, table_and_graph_interpretation

**tag_only (4 categories):**
representations, problem_formats, answer_types, common_contexts

### Category / keyword counts

| category | keywords | domain |
|----------|----------|--------|
| function_families | 18 | precalc |
| numerical_and_algebra_prerequisites | 49 | precalc |
| exponent_and_log_skills | 23 | precalc |
| geometry_and_measurement_prerequisites | 18 | precalc |
| trig_and_precalc_prerequisites | 22 | precalc |
| unit_1_limits_and_continuity | 38 | calc_ab |
| unit_2_derivative_definition_and_basic_rules | 37 | calc_ab |
| unit_3_composite_implicit_and_inverse_functions | 20 | calc_ab |
| unit_4_contextual_applications_of_differentiation | 30 | calc_ab |
| unit_5_analytical_applications_of_differentiation | 38 | calc_ab |
| unit_6_integration_and_accumulation | 41 | calc_ab |
| unit_7_differential_equations | 18 | calc_ab |
| unit_8_applications_of_integration | 32 | calc_ab |
| cognitive_tasks | 31 | tag |
| derivative_structure_keywords | 9 | calc_ab |
| limit_structure_keywords | 9 | calc_ab |
| table_and_graph_interpretation | 10 | calc_ab |
| representations | 11 | tag |
| problem_formats | 9 | tag |
| answer_types | 10 | tag |
| common_contexts | 15 | tag |

**Total keywords in file: 488** (unique).  
Precalc prerequisite keywords: 130 (across 5 categories).  
Calc AB keywords (units 1-8 + structure): 254.  
Tag-only: ~104.

### Overlap vs divergence with `learn_keywords`

**Critical divergence — nearly zero overlap.** The file uses coarse, flat IDs like `product_of_powers`, `fraction_arithmetic`, `combine_like_terms`, `linear_equation`, `factoring_trinomial`. The DB uses fine-grained, hierarchical IDs like `rational_exponent_structure`, `fraction_addition_common_denominators`, `like_terms_and_term_collection`, `multi_step_linear_equations`.

Spot-checked 21 keywords from the file against the DB: only `polynomial_standard_form` and `polynomial_coefficients` matched (both happen to appear in the DB's polynomials content). All other 19 — including `exponent_rules`, `power_of_a_power`, `integer_arithmetic`, `unit_circle`, `polynomial_function` — are **not** in `learn_keywords`.

**Conclusion:** `keywords.json` represents the **old calc_ab RAG tagging vocabulary** (flat, coarse-grained). `learn_keywords` is the **new precalc-first hierarchical vocabulary** (fine-grained, 3-tier: umbrella → in_depth → action). These two systems are parallel and non-overlapping. The new math_* schema should use the `learn_keywords` vocabulary, not `keywords.json`.

---

## 10. Import Mapping Recommendations

### 10a. Proposed 3-tier, course-aware taxonomy

```
math_courses: precalc | calc_ab
math_categories: (replaces learn_categories, filtered to math only)
math_keywords: (replaces learn_keywords math rows, adds course + yield_level fields)
  - tier: umbrella | in_depth | action
  - course: precalc | calc_ab | both
  - yield_level: high | medium | low | null (null for umbrella)
```

### 10b. What is reusable as-is

| Asset | Status | Notes |
|-------|--------|-------|
| `learn_categories` (6 math cats) | Reuse directly | Rename/re-order; fix `order_index=0` for 4 cats |
| `learn_keywords` (777 math keywords) | Reuse with enrichment | Add `course=precalc` + `yield_level` column |
| `learn_keywords` action keywords (43) | Reuse as action tier | Shared across courses |
| `rag_examples` (399 precalc) | Reuse directly | Already have `course`, `keyword_weights`, `wrong_answer_data` with misconception tagging; fully annotated |
| `learn_practice_problems` (24) | Reuse | Need `course` column added |
| `learn_mastery_quiz_problems` (8) | Reuse | Need `course` column added |
| `learn_lessons` micro_steps (5) | Reuse | High-quality 3-step format with embedded check questions |
| `learn_tips` (1) | Reuse | Trivial count |
| `mcat_keywords` concept_blueprint + yield schema | **Reference schema** | Copy `concept_blueprint + yield_level + yield_rationale` column design directly to `math_keywords` |

### 10c. What needs enrichment

| Gap | Priority | Detail |
|-----|----------|--------|
| **yield_level missing for all precalc keywords** | HIGH | 777 math keywords have no yield signal. Must add `yield_level` (high/medium/low) modeled after mcat_keywords. No existing data to migrate — needs bulk labeling. |
| **concept_blueprint missing for all precalc keywords** | HIGH | The MCAT schema proves the pattern. Precalc in_depth keywords need the same `{key_terms, in_scope_concepts, out_of_scope, in_scope_formulas, boundary_statement}` structure. Currently null. |
| **7 math categories have zero keywords** | HIGH | `trigonometry`, `rational_functions`, `exponential_and_logarithmic_functions`, `functions`, `function_transformations`, `inverse_functions`, `piecewise_functions` — all empty. Likely planned but not yet authored. |
| **rag_examples: only polynomials covered** | HIGH | 399/399 precalc examples are in the polynomials topic. Number_systems, algebraic_expressions, linear_equations, systems_of_equations, and exponents_and_radicals need rag_examples authored. |
| **learn_diagnostic_problems: empty** | MEDIUM | The diagnostic table is scaffolded but empty. If diagnostics are part of the new flow, problems need to be authored. |
| **learn_refreshers: empty** | LOW | Refreshers table exists but has no content. |
| **`course` column missing from practice/mastery tables** | MEDIUM | `learn_practice_problems` and `learn_mastery_quiz_problems` have no `course` column. Required for course-aware taxonomy. Add via migration. |
| **calc_ab keywords: not in DB at all** | HIGH | All 254 calc_ab keywords from `keywords.json` (Units 1-8) are absent from `learn_keywords`. The new schema must create a calc_ab keyword hierarchy from scratch or import/transform from `keywords.json`. |
| **order_index collisions** | LOW | Multiple categories share `order_index=0` and `order_index=100`. Should be assigned unique sequential values before import. |

### 10d. Data quality findings

1. **No precalc yield data exists anywhere** — `learn_keywords` has no yield column, no yield text in descriptions, no yield in examples. The user-described "low/medium/high" precalc yield likely refers to a planned addition modeled after `mcat_keywords.yield_level`, which does not yet exist.

2. **Massive vocabulary mismatch** — `keywords.json` (the old calc_ab tagging vocabulary, 488 keywords) and `learn_keywords` (the new precalc vocabulary, 777 math keywords) share virtually no IDs. These are two independent systems. Any import pipeline that joins on keyword_id will produce empty results unless it targets only the new vocabulary.

3. **Polynomials is the only fully-developed precalc topic** — It has: umbrella + in_depth keywords (146), rag_examples (399 all-polynomials), practice_problems (24), mastery_quiz_problems (8), learn_lessons (5), and learn_tips (1). Every other math category is partially to entirely empty of problem and lesson content.

4. **8 orphaned representation keywords** — `diagram`, `graphical`, `tabular`, `exact_form`, `approximate_form` and 3 others are `in_depth` tier with `parent_keyword_id = null`. Likely intentional tag-type items but should be reviewed for inclusion in the new taxonomy.

5. **`action_tags` and `representation_tags` categories exist but hold no keywords** — Likely legacy or renamed to `action_items` and `representations`. Can be excluded from import.

6. **`problems` table is empty** — Previously-used diagnostic table. Schema is still referenced in code but holds no data.

7. **MCAT keywords leaked into `learn_categories` and `learn_keywords`** — 10 MCAT biology categories are in `learn_categories`, and 161 MCAT biology keywords are in `learn_keywords` (not in dedicated `mcat_*` tables). The `mcat_keywords` table also exists separately (847 rows). This creates a dual representation. The new math schema should **not** import MCAT keywords from `learn_keywords` — use `mcat_keywords` as the canonical MCAT source.

### 10e. Recommended import sequence for `math_*` schema

1. **Create `math_categories`** — Copy 6 math + tag categories from `learn_categories`. Assign correct `order_index`. Add `course` column (precalc, calc_ab, or both). Leave 7 stub categories as planned entries.

2. **Create `math_keywords`** — Copy 777 precalc math keywords from `learn_keywords` (where `category_id` in the 6 math cats). Add columns: `course = 'precalc'`, `yield_level = null`, `yield_rationale = null`, `concept_blueprint = null`. Copy 43 action keywords as `course = 'both'`. Do NOT import MCAT or tag keywords.

3. **Bulk-label `yield_level`** — Using the MCAT pattern (high/medium/low), label all 826 in_depth precalc keywords. No current data to seed from — needs a labeling pass.

4. **Create `math_rag_examples`** — Copy all 399 precalc rag_examples directly. The `wrong_answer_data`, `keyword_weights`, `action_weights`, `representation_weights`, and `prerequisite_weights` fields are fully compatible. Add `course = 'precalc'` (already present). Add a `category_id` denormalization column for faster filtering.

5. **Create `math_problems` (practice + mastery)** — Copy 24 practice + 8 mastery quiz rows, adding `course = 'precalc'`. Unify or keep separate tables depending on whether the new schema distinguishes problem types.

6. **Create `math_lessons` / `math_tips`** — Copy 5 lessons and 1 tip. The micro_steps schema is high-quality and should be reused as-is.

7. **Author new content for calc_ab** — Import/transform calc_ab keywords from `keywords.json` into the new hierarchical format, or author fresh. The 254 calc_ab keywords from `keywords.json` are coarse-grained (e.g., `product_of_powers`) vs the fine-grained precalc model (e.g., `product_rule_with_same_single_variable_base`). Recommend authoring a new fine-grained calc_ab keyword tree at the same granularity as precalc.

8. **Author content for empty precalc categories** — `trigonometry`, `rational_functions`, `exponential_and_logarithmic_functions`, `functions`, `function_transformations`, `inverse_functions`, `piecewise_functions` each need umbrella + in_depth keywords, rag_examples, and lesson content.
