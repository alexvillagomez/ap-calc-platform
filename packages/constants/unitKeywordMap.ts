/** Maps unit number (as string key) to its keyword category name in keywords.json. */
export const UNIT_CATEGORY_MAP: Record<string, string> = {
  "1": "unit_1_limits_and_continuity",
  "2": "unit_2_derivative_definition_and_basic_rules",
  "3": "unit_3_composite_implicit_and_inverse_functions",
  "4": "unit_4_contextual_applications_of_differentiation",
  "5": "unit_5_analytical_applications_of_differentiation",
  "6": "unit_6_integration_and_accumulation",
  "7": "unit_7_differential_equations",
  "8": "unit_8_applications_of_integration",
};

/** Core (non-negotiable) keywords for each topic — always merged into keyword_weights at tagging time. */
export const TOPIC_CORE_KEYWORDS: Record<string, string[]> = {
  // Unit 1
  "1_1": ["limit_from_graph"],
  "1_2": ["limit_from_table"],
  "1_3": ["limit_from_equation"],
  "1_4": ["determine_continuity"],
  "1_6": ["infinite_limit"],
  "1_7": ["limit_at_infinity"],
  "1_8": ["intermediate_value_theorem"],
  "1_9": ["squeeze_theorem"],
  // Unit 2
  "2_1": ["difference_quotient", "secant_line"],
  "2_2": ["derivative_definition"],
  "2_3": ["differentiability"],
  "2_4": ["power_rule"],
  "2_5": ["sum_rule"],
  "2_6": ["select_derivative_rule"],
  "2_7": ["product_rule"],
  "2_8": ["quotient_rule"],
  // Unit 3
  "3_1": ["chain_rule"],
  "3_2": ["implicit_differentiation"],
  "3_3": ["derivative_of_inverse_function"],
  "3_4": ["derivative_of_arcsin"],
  "3_5": ["second_derivative"],
  // Unit 4
  "4_1": ["derivative_in_context"],
  "4_2": ["motion_along_a_line"],
  "4_3": ["related_rates"],
  "4_4": ["linearization"],
  "4_5": ["lhospital_rule"],
  // Unit 5
  "5_1": ["mean_value_theorem"],
  "5_2": ["optimization"],
  "5_3": ["extreme_value_theorem"],
  "5_4": ["first_derivative_sign_chart"],
  "5_5": ["first_derivative_test"],
  "5_6": ["candidates_test"],
  "5_7": ["concavity"],
  "5_8": ["second_derivative_test"],
  "5_9": ["graph_of_f_prime"],
  // Unit 6
  "6_1": ["riemann_sum"],
  "6_2": ["riemann_sum"],
  "6_3": ["riemann_sum"],
  "6_4": ["riemann_sum", "definite_integral"],
  "6_5": ["fundamental_theorem_part_1", "accumulation_function"],
  "6_6": ["accumulation_function"],
  "6_7": ["fundamental_theorem_part_2"],
  "6_8": ["antiderivative"],
  "6_9": ["u_substitution"],
  "6_10": ["properties_of_definite_integrals"],
  // Unit 7
  "7_1": ["differential_equation"],
  "7_2": ["slope_field"],
  "7_3": ["separable_differential_equation"],
  "7_4": ["initial_value_problem"],
  "7_5": ["exponential_growth_model"],
  // Unit 8
  "8_1": ["average_value_of_function"],
  "8_2": ["motion_from_integrals"],
  "8_3": ["accumulation_in_context"],
  "8_4": ["area_between_curves_x"],
  "8_5": ["area_between_curves_y"],
  "8_6": ["volume_with_known_cross_sections"],
  "8_7": ["disc_method"],
  "8_8": ["disc_method"],
  "8_9": ["washer_method"],
  "8_10": ["washer_method"],
};

/** Merges non-negotiable core keywords for the given topics into an existing keyword_weights object. */
export function mergeTopicCoreKeywords(
  keywords: Record<string, number>,
  topicIds: string[]
): Record<string, number> {
  const merged = { ...keywords };
  for (const id of topicIds) {
    for (const kw of TOPIC_CORE_KEYWORDS[id] ?? []) {
      merged[kw] = 1;
    }
  }
  return merged;
}

/** Maps each topic ID to its specific keyword subset. Used for precise per-topic filtering. */
export const TOPIC_KEYWORD_MAP: Record<string, string[]> = {
  // ── Unit 1 ───────────────────────────────────────────────────────────────
  "1_1": ["limit_from_graph", "estimating_limit", "limit_notation", "limit_value", "limit_exists", "two_sided_limit", "left_hand_limit", "right_hand_limit"],
  "1_2": ["limit_from_table", "estimating_limit", "limit_notation", "limit_value", "limit_exists", "two_sided_limit", "left_hand_limit", "right_hand_limit"],
  "1_3": ["limit_from_equation", "algebraic_properties_of_limits", "direct_substitution", "factoring_for_limits", "rationalization_for_limits", "common_denominator_for_limits", "limit_notation", "limit_value", "limit_of_piecewise_function"],
  "1_4": ["continuity_definition", "continuity_at_a_point", "determine_continuity", "removable_discontinuity", "jump_discontinuity", "infinite_discontinuity", "oscillating_behavior", "limit_of_piecewise_function"],
  "1_6": ["infinite_limit", "vertical_asymptote", "limit_notation", "limit_value"],
  "1_7": ["limit_at_infinity", "end_behavior", "horizontal_asymptote", "limit_notation"],
  "1_8": ["intermediate_value_theorem", "guaranteed_root", "guaranteed_output_value", "continuity_on_an_interval"],
  "1_9": ["special_trig_limit", "squeeze_theorem", "limit_notation"],

  // ── Unit 2 ───────────────────────────────────────────────────────────────
  "2_1": ["difference_quotient", "secant_line", "slope_of_secant", "derivative_as_limit", "average_rate_of_change"],
  "2_2": ["derivative_definition", "derivative_as_limit", "derivative_at_a_point", "derivative_as_function", "derivative_notation_prime", "derivative_notation_leibniz", "derivative_notation_operator", "tangent_line", "slope_of_tangent"],
  "2_3": ["differentiability", "continuity_vs_differentiability", "nondifferentiable_point", "corner", "cusp", "vertical_tangent", "discontinuity_and_derivative", "derivative_from_graph", "derivative_from_table"],
  "2_4": ["power_rule", "constant_rule", "derivative_of_polynomial", "select_derivative_rule"],
  "2_5": ["constant_rule", "sum_rule", "difference_rule", "constant_multiple_rule", "select_derivative_rule"],
  "2_6": ["derivative_of_sin", "derivative_of_cos", "derivative_of_tan", "derivative_of_exponential", "derivative_of_e_to_x", "derivative_of_ln_x", "select_derivative_rule"],
  "2_7": ["product_rule", "select_derivative_rule"],
  "2_8": ["quotient_rule", "select_derivative_rule"],

  // ── Unit 3 ───────────────────────────────────────────────────────────────
  "3_1": ["chain_rule", "chain_rule_single_layer", "chain_rule_multiple_layers", "composite_derivative", "differentiate_trig_composite", "differentiate_exponential_composite", "differentiate_log_composite", "differentiate_rational_composite", "mixed_rules_differentiation"],
  "3_2": ["implicit_differentiation", "dy_dx_in_implicit_relation", "second_derivative_implicit", "mixed_rules_differentiation"],
  "3_3": ["inverse_function_relationship", "derivative_of_inverse_function"],
  "3_4": ["derivative_of_arcsin", "derivative_of_arccos", "derivative_of_arctan"],
  "3_5": ["higher_order_derivative", "second_derivative", "third_derivative", "mixed_rules_differentiation"],

  // ── Unit 4 ───────────────────────────────────────────────────────────────
  "4_1": ["derivative_in_context", "units_of_derivative", "interpret_units", "rate_in_context", "population_rate", "temperature_rate", "volume_rate", "area_rate"],
  "4_2": ["position", "velocity", "speed", "acceleration", "motion_along_a_line", "derivative_from_motion"],
  "4_3": ["related_rates", "related_rates_geometry", "related_rates_volume", "related_rates_area", "related_rates_distance", "related_rates_triangle", "related_rates_circle", "related_rates_cone"],
  "4_4": ["local_linearity", "linearization", "tangent_line_approximation", "differentials", "approximation_error"],
  "4_5": ["lhospital_rule", "indeterminate_form_zero_over_zero", "indeterminate_form_infinity_over_infinity"],

  // ── Unit 5 ───────────────────────────────────────────────────────────────
  "5_1": ["mean_value_theorem", "rolle_theorem"],
  "5_2": ["optimization", "optimization_objective", "optimization_constraint", "optimization_geometry", "optimization_area", "optimization_volume", "optimization_cost", "optimization_revenue", "optimization_distance", "optimization_rate"],
  "5_3": ["extreme_value_theorem", "critical_number", "critical_point", "find_critical_numbers", "absolute_maximum", "absolute_minimum"],
  "5_4": ["increasing_interval", "decreasing_interval", "first_derivative_sign_chart"],
  "5_5": ["first_derivative_test", "local_maximum", "local_minimum", "relative_extrema", "critical_point"],
  "5_6": ["candidates_test", "absolute_maximum", "absolute_minimum", "closed_interval_analysis"],
  "5_7": ["concavity", "concave_up", "concave_down", "inflection_point", "second_derivative"],
  "5_8": ["second_derivative_test", "local_maximum", "local_minimum", "concavity"],
  "5_9": ["graph_analysis", "graph_of_f", "graph_of_f_prime", "graph_of_f_double_prime", "matching_graphs", "sketch_from_derivatives"],

  // ── Unit 6 ───────────────────────────────────────────────────────────────
  "6_1": ["riemann_sum", "left_riemann_sum", "right_riemann_sum", "midpoint_riemann_sum", "trapezoidal_approximation_preview", "signed_area"],
  "6_2": ["riemann_sum", "left_riemann_sum", "right_riemann_sum", "midpoint_riemann_sum", "trapezoidal_approximation_preview"],
  "6_3": ["riemann_sum", "left_riemann_sum", "right_riemann_sum", "midpoint_riemann_sum", "signed_area"],
  "6_4": ["riemann_sum", "summation_notation", "definite_integral", "integral_notation", "integrand", "limits_of_integration", "differential_dx"],
  "6_5": ["fundamental_theorem_part_1", "accumulation_function", "derivative_of_accumulation_function", "evaluate_accumulation_function", "behavior_of_accumulation_function"],
  "6_6": ["accumulation_of_change", "accumulation_function", "evaluate_accumulation_function", "behavior_of_accumulation_function", "net_area", "signed_area", "area_under_curve"],
  "6_7": ["fundamental_theorem_part_2", "definite_integral", "antiderivative", "evaluate_accumulation_function", "net_change_theorem"],
  "6_8": ["antiderivative", "indefinite_integral", "constant_of_integration", "basic_antiderivative_rules", "reverse_power_rule", "antiderivative_of_exponential", "antiderivative_of_trig"],
  "6_9": ["u_substitution", "substitution_in_definite_integral", "recognize_u_substitution"],
  "6_10": ["properties_of_definite_integrals", "additivity_of_integrals", "reversing_bounds", "integral_over_zero_width_interval", "integral_of_constant_multiple", "long_division_integration", "integrate_rational_expression", "integrate_log_form"],

  // ── Unit 7 ───────────────────────────────────────────────────────────────
  "7_1": ["differential_equation", "solution_to_differential_equation", "verify_solution", "general_solution", "particular_solution"],
  "7_2": ["slope_field", "interpret_slope_field", "match_equation_to_slope_field", "estimate_solution_from_slope_field"],
  "7_3": ["separable_differential_equation", "separation_of_variables", "general_solution", "constant_of_integration"],
  "7_4": ["separable_differential_equation", "separation_of_variables", "initial_value_problem", "initial_condition", "particular_solution"],
  "7_5": ["exponential_growth_model", "exponential_decay_model", "growth_constant", "decay_constant", "contextual_differential_equation", "initial_condition"],

  // ── Unit 8 ───────────────────────────────────────────────────────────────
  "8_1": ["average_value_of_function"],
  "8_2": ["position_from_velocity", "velocity_from_acceleration", "displacement", "total_distance", "motion_from_integrals"],
  "8_3": ["accumulation_in_context", "total_change_from_rate"],
  "8_4": ["area_between_curves", "area_between_curves_x", "top_minus_bottom", "intersection_points", "split_integral_at_intersection"],
  "8_5": ["area_between_curves", "area_between_curves_y", "right_minus_left", "intersection_points"],
  "8_6": ["volume_with_known_cross_sections", "cross_section_area", "square_cross_section", "rectangle_cross_section", "triangle_cross_section", "semicircle_cross_section", "volume_integral_setup"],
  "8_7": ["disc_method", "revolution_about_x_axis", "revolution_about_y_axis", "radius_expression", "volume_integral_setup"],
  "8_8": ["disc_method", "revolution_about_horizontal_line", "revolution_about_vertical_line", "radius_expression", "volume_integral_setup"],
  "8_9": ["washer_method", "revolution_about_x_axis", "revolution_about_y_axis", "inner_radius", "outer_radius", "radius_expression", "volume_integral_setup"],
  "8_10": ["washer_method", "revolution_about_horizontal_line", "revolution_about_vertical_line", "inner_radius", "outer_radius", "radius_expression", "volume_integral_setup"],
};

type KwTaxonomy = { keyword_taxonomy: Record<string, { keywords: string[] }> };

/** Returns keywords for the given topic IDs. Uses per-topic map when available,
 *  falls back to all unit-level keywords for unmapped topics. */
export function keywordsForTopics(topicIds: string[], kwJson: KwTaxonomy): string[] {
  const taxonomy = kwJson.keyword_taxonomy;
  const keywords: string[] = [];
  const seenUnits = new Set<string>();
  for (const id of topicIds) {
    if (TOPIC_KEYWORD_MAP[id]) {
      keywords.push(...TOPIC_KEYWORD_MAP[id]);
    } else {
      const unit = id.split("_")[0] ?? "";
      if (seenUnits.has(unit)) continue;
      seenUnits.add(unit);
      const catKey = UNIT_CATEGORY_MAP[unit];
      if (catKey && taxonomy[catKey]) {
        keywords.push(...taxonomy[catKey].keywords);
      }
    }
  }
  return keywords;
}

/** Returns the set of unit numbers (e.g. "1", "3") present in the given topic IDs. */
export function unitNumbersForTopics(topicIds: string[]): Set<string> {
  const units = new Set<string>();
  for (const id of topicIds) {
    const unit = id.split("_")[0] ?? "";
    if (unit && UNIT_CATEGORY_MAP[unit]) units.add(unit);
  }
  return units;
}
