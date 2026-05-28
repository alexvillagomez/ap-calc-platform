export type DiagnosticQuestion = {
  id: string;
  latex_content: string;
  solution_latex: string;
  choices: string[];
  correct_index: number;
  umbrella_keywords: Record<string, number>;
  in_depth_keywords: Record<string, number>;
  diagnostic_purpose: string;
};

export type LessonContent = {
  title: string;
  latex_content: string;
  umbrella_keywords: Record<string, number>;
  in_depth_keywords: Record<string, number>;
};

export const DIAGNOSTIC_QUESTIONS: DiagnosticQuestion[] = [
  {
    id: "exp_q1",
    latex_content: "\\text{Simplify: } x^3 \\cdot x^5",
    solution_latex:
      "\\text{Use the product rule for exponents. } x^a \\cdot x^b=x^{a+b}.\\\\" +
      "\\text{ So } x^3 \\cdot x^5=x^{3+5}=x^8.",
    choices: ["$x^8$", "$x^{15}$", "$2x^8$", "$x^2$"],
    correct_index: 0,
    umbrella_keywords: { exponent_rules: 1.0 },
    in_depth_keywords: { product_rule_exponents: 0.8, same_base_expressions: 0.2 },
    diagnostic_purpose:
      "\\text{Tests whether the student understands the most basic exponent rule: multiplying powers with the same base.}",
  },
  {
    id: "exp_q2",
    latex_content: "\\text{Simplify: } \\dfrac{a^9}{a^4}",
    solution_latex:
      "\\text{Use the quotient rule for exponents. } \\dfrac{a^m}{a^n}=a^{m-n}.\\\\" +
      "\\text{ So } \\dfrac{a^9}{a^4}=a^{9-4}=a^5.",
    choices: ["$a^{13}$", "$a^5$", "$a^{36}$", "$\\dfrac{1}{a^5}$"],
    correct_index: 1,
    umbrella_keywords: { exponent_rules: 1.0 },
    in_depth_keywords: { quotient_rule_exponents: 0.85, same_base_expressions: 0.15 },
    diagnostic_purpose:
      "\\text{Tests whether the student can simplify a quotient of powers with the same base by subtracting exponents.}",
  },
  {
    id: "exp_q3",
    latex_content: "\\text{Simplify: } (y^4)^3",
    solution_latex:
      "\\text{Use the power-to-power rule. } (y^a)^b=y^{ab}.\\\\" +
      "\\text{ So } (y^4)^3=y^{4\\cdot 3}=y^{12}.",
    choices: ["$y^7$", "$3y^4$", "$y^{12}$", "$y^{64}$"],
    correct_index: 2,
    umbrella_keywords: { exponent_rules: 1.0 },
    in_depth_keywords: { power_to_power: 0.9, exponent_multiplication: 0.1 },
    diagnostic_purpose:
      "\\text{Tests whether the student understands that raising a power to another power means multiplying the exponents, not adding them.}",
  },
  {
    id: "exp_q4",
    latex_content: "\\text{Simplify: } 5x^{-3}",
    solution_latex:
      "\\text{Use the negative exponent rule. } x^{-n}=\\dfrac{1}{x^n}.\\\\" +
      "\\text{ The coefficient } 5 \\text{ stays in the numerator, so } 5x^{-3}=\\dfrac{5}{x^3}.",
    choices: ["$-15x$", "$\\dfrac{1}{5x^3}$", "$\\dfrac{5}{x^3}$", "$5x^3$"],
    correct_index: 2,
    umbrella_keywords: { exponent_rules: 0.85, algebraic_simplification: 0.15 },
    in_depth_keywords: {
      negative_exponents: 0.75,
      coefficient_handling: 0.15,
      rewriting_expressions: 0.1,
    },
    diagnostic_purpose:
      "\\text{Tests whether the student understands that the negative exponent moves only the powered factor to the denominator, not necessarily the entire expression.}",
  },
  {
    id: "exp_q5",
    latex_content: "\\text{Simplify: } \\dfrac{(2x^3y^{-2})^2}{4x^2}",
    solution_latex:
      "\\text{First apply the power to each factor in the numerator.}\\\\" +
      "(2x^3y^{-2})^2=2^2(x^3)^2(y^{-2})^2=4x^6y^{-4}\\\\" +
      "\\text{ Now divide by } 4x^2.\\\\" +
      "\\dfrac{4x^6y^{-4}}{4x^2}=x^{6-2}y^{-4}=x^4y^{-4}\\\\" +
      "\\text{ Finally rewrite the negative exponent.}\\\\" +
      "x^4y^{-4}=\\dfrac{x^4}{y^4}",
    choices: [
      "$\\dfrac{x^4}{y^4}$",
      "$\\dfrac{x}{y^4}$",
      "$\\dfrac{x^8}{y^4}$",
      "$x^4y^4$",
    ],
    correct_index: 0,
    umbrella_keywords: { exponent_rules: 0.75, algebraic_simplification: 0.25 },
    in_depth_keywords: {
      power_to_power: 0.3,
      negative_exponents: 0.25,
      quotient_rule_exponents: 0.2,
      power_of_a_product: 0.15,
      coefficient_handling: 0.1,
    },
    diagnostic_purpose:
      "\\text{Tests whether the student can combine multiple exponent rules in one expression.}",
  },
];

const LESSON_KEYWORDS = {
  umbrella_keywords: { exponent_rules: 1.0 },
  in_depth_keywords: {
    product_rule_exponents: 0.14,
    quotient_rule_exponents: 0.14,
    power_to_power: 0.14,
    power_of_a_product: 0.12,
    negative_exponents: 0.14,
    zero_exponent: 0.1,
    fractional_exponents: 0.1,
    same_base_expressions: 0.04,
    coefficient_handling: 0.04,
    rewriting_expressions: 0.04,
  },
};

const FULL_LESSON_LATEX =
  "\\text{Exponent Rules}\\\\\\\\" +
  "\\text{An exponent tells us how many times to multiply a base by itself.}\\\\" +
  "x^4=x\\cdot x\\cdot x\\cdot x\\\\\\\\" +
  "\\text{Most exponent rules come from repeated multiplication.}\\\\\\\\" +
  "\\text{Product Rule: When multiplying powers with the same base, add the exponents.}\\\\" +
  "x^a\\cdot x^b=x^{a+b}\\\\" +
  "x^3\\cdot x^5=x^{3+5}=x^8\\\\\\\\" +
  "\\text{Quotient Rule: When dividing powers with the same base, subtract the exponents.}\\\\" +
  "\\dfrac{x^a}{x^b}=x^{a-b}\\\\" +
  "\\dfrac{x^7}{x^3}=x^{7-3}=x^4\\\\\\\\" +
  "\\text{Power-to-Power Rule: When raising a power to another power, multiply the exponents.}\\\\" +
  "(x^a)^b=x^{ab}\\\\" +
  "(x^3)^4=x^{3\\cdot 4}=x^{12}\\\\\\\\" +
  "\\text{Power of a Product: When a product is raised to a power, apply the exponent to every factor inside the parentheses.}\\\\" +
  "(ab)^n=a^nb^n\\\\" +
  "(2x^3)^2=2^2(x^3)^2=4x^6\\\\\\\\" +
  "\\text{Negative Exponents: A negative exponent moves the factor to the other side of the fraction. It does not make the expression negative.}\\\\" +
  "x^{-n}=\\dfrac{1}{x^n}\\\\" +
  "5x^{-3}=\\dfrac{5}{x^3}\\\\\\\\" +
  "\\text{Zero Exponents: Any nonzero base raised to the zero power equals }1\\text{.}\\\\" +
  "x^0=1\\text{ for }x\\ne 0\\\\\\\\" +
  "\\text{Fractional Exponents: Fractional exponents represent roots.}\\\\" +
  "x^{1/2}=\\sqrt{x}\\\\" +
  "x^{m/n}=\\sqrt[n]{x^m}\\\\\\\\" +
  "\\text{Mixed Example: Simplify }\\dfrac{(2x^3y^{-2})^2}{4x^2}\\text{.}\\\\" +
  "(2x^3y^{-2})^2=2^2(x^3)^2(y^{-2})^2=4x^6y^{-4}\\\\" +
  "\\dfrac{4x^6y^{-4}}{4x^2}=x^{6-2}y^{-4}=x^4y^{-4}\\\\" +
  "x^4y^{-4}=\\dfrac{x^4}{y^4}\\\\\\\\" +
  "\\text{Final answer: }\\dfrac{x^4}{y^4}\\\\\\\\" +
  "\\text{Big idea: exponent rules are not random. They come from repeated multiplication, cancellation, and rewriting equivalent expressions.}";

const REFRESHER_LATEX =
  "\\text{Exponent Rules — Quick Reference}\\\\\\\\" +
  "\\text{Product Rule: }x^a\\cdot x^b=x^{a+b}\\\\\\\\" +
  "\\text{Quotient Rule: }\\dfrac{x^a}{x^b}=x^{a-b}\\\\\\\\" +
  "\\text{Power-to-Power: }(x^a)^b=x^{ab}\\\\\\\\" +
  "\\text{Power of a Product: }(ab)^n=a^nb^n\\\\\\\\" +
  "\\text{Negative Exponents: }x^{-n}=\\dfrac{1}{x^n}\\\\\\\\" +
  "\\text{Zero Exponent: }x^0=1\\text{ for }x\\ne 0\\\\\\\\" +
  "\\text{Fractional Exponents: }x^{m/n}=\\sqrt[n]{x^m}\\\\\\\\" +
  "\\text{Remember: negative exponents move the factor, not the whole expression.}\\\\" +
  "\\text{Remember: raise a power to a power by multiplying exponents, not adding.}";

export const LESSON_CONTENT: Record<"full" | "refresher", LessonContent> = {
  full: {
    title: "Exponent Rules",
    latex_content: FULL_LESSON_LATEX,
    ...LESSON_KEYWORDS,
  },
  refresher: {
    title: "Exponent Rules — Quick Refresher",
    latex_content: REFRESHER_LATEX,
    ...LESSON_KEYWORDS,
  },
};
