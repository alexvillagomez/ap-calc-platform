export const TOPIC_TO_CATEGORY: Record<string, string> = {
  exponent_rules: "exponents_and_radicals",
  functions: "functions",
  function_transformations: "function_transformations",
  inverse_functions: "inverse_functions",
  piecewise_functions: "piecewise_functions",
  polynomials: "polynomials",
  rational_functions: "rational_functions",
  exponential_and_logarithmic_functions: "exponential_and_logarithmic_functions",
  trigonometry: "trigonometry",
};

export function topicToCategory(topicId: string): string {
  return TOPIC_TO_CATEGORY[topicId] ?? topicId;
}
