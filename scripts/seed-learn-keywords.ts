/**
 * Seeds learn_keywords and learn_diagnostic_problems for the exponent_rules topic.
 * Run: tsx scripts/seed-learn-keywords.ts
 */
import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ─── Keyword taxonomy ────────────────────────────────────────────────────────

type Keyword = {
  id: string;
  topic_id: string;
  label: string;
  description: string;
  tier: "umbrella" | "in_depth";
  order_index: number;
};

const EXPONENT_KEYWORDS: Keyword[] = [
  // Umbrella
  {
    id: "exponent_rules",
    topic_id: "exponent_rules",
    label: "Exponent Rules",
    description: "Broad mastery of all exponent rules and properties",
    tier: "umbrella",
    order_index: 0,
  },
  // In-depth (23 MECE keywords)
  {
    id: "exponent_notation",
    topic_id: "exponent_rules",
    label: "Exponent Notation",
    description: "Understanding that x^n means x multiplied by itself n times",
    tier: "in_depth",
    order_index: 1,
  },
  {
    id: "evaluating_integer_exponents",
    topic_id: "exponent_rules",
    label: "Evaluating Integer Exponents",
    description: "Computing the numerical value of expressions like 2^5 or (-3)^4",
    tier: "in_depth",
    order_index: 2,
  },
  {
    id: "parentheses_with_exponents",
    topic_id: "exponent_rules",
    label: "Parentheses with Exponents",
    description: "Understanding that (-2)^2 = 4 but -2^2 = -4; the exponent applies only to what is inside parentheses",
    tier: "in_depth",
    order_index: 3,
  },
  {
    id: "product_of_powers",
    topic_id: "exponent_rules",
    label: "Product of Powers",
    description: "When multiplying powers with the same base, add the exponents: x^a * x^b = x^(a+b)",
    tier: "in_depth",
    order_index: 4,
  },
  {
    id: "quotient_of_powers",
    topic_id: "exponent_rules",
    label: "Quotient of Powers",
    description: "When dividing powers with the same base, subtract the exponents: x^a / x^b = x^(a-b)",
    tier: "in_depth",
    order_index: 5,
  },
  {
    id: "power_of_a_power",
    topic_id: "exponent_rules",
    label: "Power of a Power",
    description: "When raising a power to another power, multiply the exponents: (x^a)^b = x^(ab)",
    tier: "in_depth",
    order_index: 6,
  },
  {
    id: "power_of_a_product",
    topic_id: "exponent_rules",
    label: "Power of a Product",
    description: "When a product is raised to a power, apply the exponent to each factor: (ab)^n = a^n * b^n",
    tier: "in_depth",
    order_index: 7,
  },
  {
    id: "power_of_a_quotient",
    topic_id: "exponent_rules",
    label: "Power of a Quotient",
    description: "When a quotient is raised to a power, apply the exponent to numerator and denominator: (a/b)^n = a^n / b^n",
    tier: "in_depth",
    order_index: 8,
  },
  {
    id: "zero_exponents",
    topic_id: "exponent_rules",
    label: "Zero Exponents",
    description: "Any nonzero base raised to the power 0 equals 1: x^0 = 1 for x ≠ 0",
    tier: "in_depth",
    order_index: 9,
  },
  {
    id: "negative_exponents",
    topic_id: "exponent_rules",
    label: "Negative Exponents",
    description: "A negative exponent moves the factor to the other side of the fraction: x^(-n) = 1/x^n",
    tier: "in_depth",
    order_index: 10,
  },
  {
    id: "positive_exponent_form",
    topic_id: "exponent_rules",
    label: "Positive Exponent Form",
    description: "Rewriting expressions with negative exponents so that all exponents are positive",
    tier: "in_depth",
    order_index: 11,
  },
  {
    id: "rational_exponent_notation",
    topic_id: "exponent_rules",
    label: "Rational Exponent Notation",
    description: "Understanding the form x^(m/n) and what numerator and denominator represent",
    tier: "in_depth",
    order_index: 12,
  },
  {
    id: "fractional_exponents_as_roots",
    topic_id: "exponent_rules",
    label: "Fractional Exponents as Roots",
    description: "x^(1/n) = nth root of x; for example x^(1/2) = sqrt(x)",
    tier: "in_depth",
    order_index: 13,
  },
  {
    id: "rational_exponents_power_then_root",
    topic_id: "exponent_rules",
    label: "Rational Exponents: Power Then Root",
    description: "x^(m/n) = nth root of x^m — raise to power first, then take root",
    tier: "in_depth",
    order_index: 14,
  },
  {
    id: "rational_exponents_root_then_power",
    topic_id: "exponent_rules",
    label: "Rational Exponents: Root Then Power",
    description: "x^(m/n) = (nth root of x)^m — take root first, then raise to power",
    tier: "in_depth",
    order_index: 15,
  },
  {
    id: "evaluating_rational_exponents",
    topic_id: "exponent_rules",
    label: "Evaluating Rational Exponents",
    description: "Computing the numerical value of expressions like 8^(2/3) or 27^(1/3)",
    tier: "in_depth",
    order_index: 16,
  },
  {
    id: "negative_rational_exponents",
    topic_id: "exponent_rules",
    label: "Negative Rational Exponents",
    description: "Combining the negative exponent rule and fractional exponents: x^(-m/n) = 1 / x^(m/n)",
    tier: "in_depth",
    order_index: 17,
  },
  {
    id: "radical_to_exponent_form",
    topic_id: "exponent_rules",
    label: "Radical to Exponent Form",
    description: "Converting radical expressions (sqrt, cube root) into exponent notation",
    tier: "in_depth",
    order_index: 18,
  },
  {
    id: "exponent_to_radical_form",
    topic_id: "exponent_rules",
    label: "Exponent to Radical Form",
    description: "Converting rational exponent expressions back to radical notation",
    tier: "in_depth",
    order_index: 19,
  },
  {
    id: "simplifying_radicals_with_exponents",
    topic_id: "exponent_rules",
    label: "Simplifying Radicals with Exponents",
    description: "Using exponent rules to simplify radical expressions such as sqrt(x^6) = x^3",
    tier: "in_depth",
    order_index: 20,
  },
  {
    id: "combining_rational_exponents_same_base",
    topic_id: "exponent_rules",
    label: "Combining Rational Exponents (Same Base)",
    description: "Applying product/quotient/power rules when the exponents are fractions",
    tier: "in_depth",
    order_index: 21,
  },
  {
    id: "rewriting_numbers_as_powers",
    topic_id: "exponent_rules",
    label: "Rewriting Numbers as Powers",
    description: "Expressing numbers in exponential form to apply rules, e.g. 8 = 2^3",
    tier: "in_depth",
    order_index: 22,
  },
  {
    id: "multi_rule_exponent_simplification",
    topic_id: "exponent_rules",
    label: "Multi-Rule Exponent Simplification",
    description: "Simplifying complex expressions that require applying two or more exponent rules in sequence",
    tier: "in_depth",
    order_index: 23,
  },
];

// ─── Diagnostic problems (from existing exponentRules.ts) ────────────────────

type DiagnosticProblem = {
  topic_id: string;
  latex_content: string;
  choices: string[];
  correct_index: number;
  difficulty: number;
  umbrella_keywords: Record<string, number>;
  in_depth_keywords: Record<string, number>;
  diagnostic_purpose: string;
  order_index: number;
};

const DIAGNOSTIC_PROBLEMS: DiagnosticProblem[] = [
  {
    topic_id: "exponent_rules",
    latex_content: "\\text{Simplify: } x^3 \\cdot x^5",
    choices: ["$x^8$", "$x^{15}$", "$2x^8$", "$x^2$"],
    correct_index: 0,
    difficulty: 1,
    umbrella_keywords: { exponent_rules: 1.0 },
    in_depth_keywords: { product_of_powers: 0.8, exponent_notation: 0.2 },
    diagnostic_purpose: "Tests product of powers rule",
    order_index: 0,
  },
  {
    topic_id: "exponent_rules",
    latex_content: "\\text{Simplify: } \\dfrac{a^9}{a^4}",
    choices: ["$a^{13}$", "$a^5$", "$a^{36}$", "$\\dfrac{1}{a^5}$"],
    correct_index: 1,
    difficulty: 1,
    umbrella_keywords: { exponent_rules: 1.0 },
    in_depth_keywords: { quotient_of_powers: 0.85, exponent_notation: 0.15 },
    diagnostic_purpose: "Tests quotient of powers rule",
    order_index: 1,
  },
  {
    topic_id: "exponent_rules",
    latex_content: "\\text{Simplify: } (y^4)^3",
    choices: ["$y^7$", "$3y^4$", "$y^{12}$", "$y^{64}$"],
    correct_index: 2,
    difficulty: 1,
    umbrella_keywords: { exponent_rules: 1.0 },
    in_depth_keywords: { power_of_a_power: 0.9, parentheses_with_exponents: 0.1 },
    diagnostic_purpose: "Tests power of a power rule",
    order_index: 2,
  },
  {
    topic_id: "exponent_rules",
    latex_content: "\\text{Simplify: } 5x^{-3}",
    choices: ["$-15x$", "$\\dfrac{1}{5x^3}$", "$\\dfrac{5}{x^3}$", "$5x^3$"],
    correct_index: 2,
    difficulty: 2,
    umbrella_keywords: { exponent_rules: 0.85, algebraic_simplification: 0.15 },
    in_depth_keywords: { negative_exponents: 0.75, positive_exponent_form: 0.15, evaluating_integer_exponents: 0.1 },
    diagnostic_purpose: "Tests negative exponents with a coefficient",
    order_index: 3,
  },
  {
    topic_id: "exponent_rules",
    latex_content: "\\text{Simplify: } \\dfrac{(2x^3y^{-2})^2}{4x^2}",
    choices: [
      "$\\dfrac{x^4}{y^4}$",
      "$\\dfrac{x}{y^4}$",
      "$\\dfrac{x^8}{y^4}$",
      "$x^4y^4$",
    ],
    correct_index: 0,
    difficulty: 4,
    umbrella_keywords: { exponent_rules: 0.75, algebraic_simplification: 0.25 },
    in_depth_keywords: {
      power_of_a_power: 0.3,
      negative_exponents: 0.25,
      quotient_of_powers: 0.2,
      power_of_a_product: 0.15,
      positive_exponent_form: 0.1,
    },
    diagnostic_purpose: "Multi-rule: combines power of product, power of power, quotient, and negative exponents",
    order_index: 4,
  },
];

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("Seeding learn_keywords...");
  const { error: kwError } = await supabase
    .from("learn_keywords")
    .upsert(EXPONENT_KEYWORDS, { onConflict: "id" });
  if (kwError) {
    console.error("learn_keywords error:", kwError.message);
    process.exit(1);
  }
  console.log(`✓ Upserted ${EXPONENT_KEYWORDS.length} keywords`);

  console.log("Seeding learn_diagnostic_problems...");
  const { error: dpError } = await supabase
    .from("learn_diagnostic_problems")
    .insert(DIAGNOSTIC_PROBLEMS);
  if (dpError) {
    // Ignore duplicate errors (idempotency guard)
    if (!dpError.message.includes("duplicate")) {
      console.error("learn_diagnostic_problems error:", dpError.message);
      process.exit(1);
    }
    console.log("  (diagnostic problems already seeded, skipping)");
  } else {
    console.log(`✓ Inserted ${DIAGNOSTIC_PROBLEMS.length} diagnostic problems`);
  }

  console.log("\nDone. Now call POST /api/learn/seed with { topic_id: 'exponent_rules' } from the admin app to generate all AI content.");
}

main().catch(console.error);
