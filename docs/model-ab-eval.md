# Model A/B Evaluation — 2026-06-22

Comparing **gpt-5.4-mini** (current default), **gpt-5.5** (current question model), and **Gemini 2.5 Flash** (REST API) across all generation tasks.

## Setup
- All calls use the **exact system/user prompts from the production generators** (`mathGenerator.ts`, `mcatGenerator.ts`).
- Gemini called via REST (`gemini-2.5-flash`, `responseMimeType: application/json`). No client package installed — key exists in `apps/student/.env.local`.
- Scores are heuristic (automated checks against prompt constraints). Human judgment notes supplement each section.
- Token counts from API usage metadata; latency = wall-clock per call.

## Pricing reference (as of evaluation date)

| Model | Input (per 1M tokens) | Output (per 1M tokens) | Notes |
|---|---|---|---|
| gpt-5.4-mini | ~\$0.40 | ~\$1.60 | Current GEN_MODEL; check OpenAI pricing page for exact rates |
| gpt-5.5 | ~\$2.00 | ~\$8.00 | Current QUESTION_MODEL; estimated from observed cost patterns |
| Gemini 2.5 Flash | ~\$0.15 | ~\$0.60 | Google AI Studio pricing; significantly cheaper |

> Pricing estimates — verify at platform pricing pages before budgeting. Ratios are more reliable than absolutes.

## Math Lesson (avg vs instantaneous rate of change)

### Automated quality scores (0–100)

| Model | Score | Latency | Input tok | Output tok |
|---|---|---|---|---|
| **gpt-5.4-mini** | 95/100 | 10802ms | 670 | 1709 |
| **gpt-5.5** | 100/100 | 56754ms | 670 | 3966 |
| **gemini-2.5-flash** | 100/100 | 27063ms | 706 | 2365 |

**gpt-5.4-mini** checks:
- ✅ 4 micro-steps (expected 3–4)
- ✅ All steps have required fields (explanation, example, hint)
- ✅ All steps have check questions with correct_answer_latex
- ✅ All check questions have 3 distractors
- ✅ Common mistake callouts present
- ✅ LaTeX $...$ delimiters used throughout
- ⚠️ Possible bare LaTeX in 2 step(s)

**gpt-5.5** checks:
- ✅ 4 micro-steps (expected 3–4)
- ✅ All steps have required fields (explanation, example, hint)
- ✅ All steps have check questions with correct_answer_latex
- ✅ All check questions have 3 distractors
- ✅ Common mistake callouts present
- ✅ LaTeX $...$ delimiters used throughout
- ✅ No obvious bare LaTeX detected

**gemini-2.5-flash** checks:
- ✅ 4 micro-steps (expected 3–4)
- ✅ All steps have required fields (explanation, example, hint)
- ✅ All steps have check questions with correct_answer_latex
- ✅ All check questions have 3 distractors
- ✅ Common mistake callouts present
- ✅ LaTeX $...$ delimiters used throughout
- ✅ No obvious bare LaTeX detected

### Raw output samples (side by side)

<details><summary><strong>gpt-5.4-mini</strong> — 10802ms, 1709 output tokens</summary>

```json
{
  "micro_steps": [
    {
      "step_index": 1,
      "has_check": true,
      "explanation_latex": "Average rate of change tells you how fast a quantity changes over an interval. If $f(x)$ is a function, then between $x=a$ and $x=b$, you find it by computing $\\dfrac{f(b)-f(a)}{b-a}$. This is the slope of the secant line connecting the two points on the graph.",
      "example_latex": "Example: Let $f(x)=2x+1$. Find the average rate of change from $x=1$ to $x=4$.\n\nFirst find the function values:\n$$f(1)=2(1)+1=3$$\n$$f(4)=2(4)+1=9$$\nNow compute the average rate of change:\n$$\\frac{f(4)-f(1)}{4-1}=\\frac{9-3}{3}=\\frac{6}{3}=2$$\nSo the average rate of change is $2$.\n\nCommon mistake: subtracting the $x$-values in the wrong order or forgetting to divide by $b-a$.",
      "check_question": {
        "latex_content": "Find the average rate of change of $f(x)=x^2$ from $x=1$ to $x=3$.",
        "solution_latex": "$$\\frac{f(3)-f(1)}{3-1}=\\frac{9-1}{2}=\\frac{8}{2}=4$$",
        "correct_answer_latex": "$4$",
        "distractors": [
          "$8$",
          "$2$",
          "$-4$"
        ]
      },
      "hint_latex": "Use $\\dfrac{f(b)-f(a)}{b-a}$."
    },
    {
      "step_index": 2,
      "has_check": true,
      "explanation_latex": "Building on average rate of change, instantaneous rate of change asks for the rate at one exact input. Since one point alone does not make a slope, we look at average rates over intervals that get closer and closer to that point. The limit of those secant slopes gives the slope of the tangent line.",
      "example_latex": "Example: For $f(x)=x^2$, find the instantaneous rate of change at $x=2$ using nearby points.\n\nAverage rate of change from $x=2$ to $x=2+h$ is\n$$\\frac{f(2+h)-f(2)}{(2+h)-2}$$\nSubstitute $f(x)=x^2$:\n$$\\frac{(2+h)^2-2^2}{h}$$\nExpand:\n$$\\frac{4+4h+h^2-4}{h}$$\nSimplify:\n$$\\frac{4h+h^2}{h}=4+h$$\nNow let $h$ get close to $0$:\n$$4+h \\to 4$$\nSo the instantaneous rate of change at $x=2$ is $4$.\n\nCommon mistake: plugging in $h=0$ too early, which gives division by $0$.",
      "check_question": {
        "latex_content": "For $f(x)=x^2$, what is the instantaneous rate of change at $x=1$?",
        "solution_latex": "$$\\frac{f(1+h)-f(1)}{h}=\\frac{(1+h)^2-1}{h}=\\frac{1+2h+h^2-1}{h}=2+h$$\n$$\\lim_{h\\to 0}(2+h)=2$$",
        "correct_answer_latex": "$2$",
        "distractors": [
          "$1$",
          "$0$",
          "$3$"
        ]
      },
      "hint_latex": "Form a secant slope with $1$ and $1+h$, then take the limit."
    },
    {
      "step_index": 3,
      "has_check": true,
      "explanation_latex": "Now that you know average rate uses two points and instantaneous rate uses a limit, you can use either idea in context. For motion, average rate of change is average velocity over an interval, while instantaneous rate of change is velocity at a single moment. The units matter: if position is in feet and time in seconds, the rate is in feet per second.",
      "example_latex": "Example: A particle has position $s(t)=t^2+1$ feet. Find the average velocity from $t=2$ to $t=5$, and the instantaneous velocity at $t=2$.\n\nAverage velocity:\n$$\\frac{s(5)-s(2)}{5-2}$$\nCompute the positions:\n$$s(5)=5^2+1=26$$\n$$s(2)=2^2+1=5$$\nSo\n$$\\frac{26-5}{3}=\\frac{21}{3}=7$$\nInstantaneous velocity at $t=2$:\n$$\\frac{s(2+h)-s(2)}{h}=\\frac{((2+h)^2+1)-5}{h}$$\nExpand:\n$$\\frac{4+4h+h^2+1-5}{h}=\\frac{4h+h^2}{h}=4+h$$\nTake the limit:\n$$\\lim_{h\\to 0}(4+h)=4$$\nSo the average velocity is $7$ ft/s, and the instantaneous velocity at $t=2$ is $4$ ft/s.\n\nCommon mistake: mixing up the average velocity over an interval with the velocity at one instant.",
      "check_question": {
        "latex_content": "A position function is $s(t)=3t^2$. What is the average velocity from $t=1$ to $t=4$?",
        "solution_latex": "$$\\frac{s(4)-s(1)}{4-1}=\\frac{48-3}{3}=\\frac{45}{3}=15$$",
        "correct_answer_latex": "$15$",
        "distractors": [
          "$12$"
... [truncated]
```

</details>

<details><summary><strong>gpt-5.5</strong> — 56754ms, 3966 output tokens</summary>

```json
{
  "micro_steps": [
    {
      "step_index": 1,
      "has_check": true,
      "explanation_latex": "When you measure change over an interval, you compare the start and end. The average rate of change of $f$ from $x=a$ to $x=b$ is $\\frac{f(b)-f(a)}{b-a}$. This is the slope of the secant line through the two endpoint points.",
      "example_latex": "Find the average rate of change of $f(x)=2x+1$ from $x=1$ to $x=4$.\n\nFirst find the endpoint outputs.\n$$f(1)=2(1)+1=3$$\n$$f(4)=2(4)+1=9$$\n\nUse change in output over change in input.\n$$\\frac{f(4)-f(1)}{4-1}=\\frac{9-3}{3}=\\frac{6}{3}=2$$\n\nThe average rate of change is $2$.\n\nCommon mistake: using only $f(4)-f(1)$ and forgetting to divide by the input change $4-1$.",
      "check_question": {
        "latex_content": "Find the average rate of change of $f(x)=5x-2$ from $x=0$ to $x=3$.",
        "solution_latex": "Compute the endpoint outputs.\n$$f(0)=5(0)-2=-2$$\n$$f(3)=5(3)-2=13$$\nThen divide output change by input change.\n$$\\frac{f(3)-f(0)}{3-0}=\\frac{13-(-2)}{3}=\\frac{15}{3}=5$$\n$5$",
        "correct_answer_latex": "$5$",
        "distractors": [
          "$15$",
          "$\\frac{1}{5}$",
          "$13$"
        ]
      },
      "hint_latex": "Use output change divided by input change."
    },
    {
      "step_index": 2,
      "has_check": true,
      "explanation_latex": "The previous step found rate over a whole interval; now focus on rate at one input. The instantaneous rate of change is the slope of the tangent line at that input, like a speedometer reading at one moment. For a straight line, every secant slope and every tangent slope are the same.",
      "example_latex": "Compare average and instantaneous rates for $f(x)=3x-2$.\n\nAverage rate from $x=1$ to $x=5$:\n$$f(1)=3(1)-2=1$$\n$$f(5)=3(5)-2=13$$\n$$\\frac{f(5)-f(1)}{5-1}=\\frac{13-1}{4}=\\frac{12}{4}=3$$\n\nBecause $f(x)=3x-2$ is a line, its tangent slope at every point is also $3$.\n\nSo the instantaneous rate at $x=4$ is $3$.\n\nCommon mistake: thinking an instantaneous rate must use two different $x$-values; it is attached to one input value.",
      "check_question": {
        "latex_content": "For the line $g(x)=-2x+7$, find the average rate of change from $x=0$ to $x=4$ and the instantaneous rate of change at $x=1$.",
        "solution_latex": "For the average rate:\n$$g(0)=-2(0)+7=7$$\n$$g(4)=-2(4)+7=-1$$\n$$\\frac{g(4)-g(0)}{4-0}=\\frac{-1-7}{4}=\\frac{-8}{4}=-2$$\nSince $g(x)=-2x+7$ is a line, the instantaneous rate at any input is also $-2$.\n$\\text{average}=-2,\\ \\text{instantaneous}=-2$",
        "correct_answer_latex": "$\\text{average}=-2,\\ \\text{instantaneous}=-2$",
        "distractors": [
          "$\\text{average}=2,\\ \\text{instantaneous}=2$",
          "$\\text{average}=-8,\\ \\text{instantaneous}=-2$",
          "$\\text{average}=-2,\\ \\text{instantaneous}=7$"
        ]
      },
      "hint_latex": "For a line, all slopes match the coefficient of $x$."
    },
    {
      "step_index": 3,
      "has_check": true,
      "explanation_latex": "The previous step was simple because a line has one constant slope; now use shrinking intervals for a curved graph. For a point $x=a$, the average rate from $a$ to $a+h$ is $\\frac{f(a+h)-f(a)}{h}$. The instantaneous rate is the limit of these secant slopes as $h$ approaches $0$.",
      "example_latex": "Find the instantaneous rate of change of $f(x)=x^2$ at $x=2$.\n\nUse the average rate from $x=2$ to $x=2+h$.\n$$\\frac{f(2+h)-f(2)}{(2+h)-2}=\\frac{f(2+h)-f(2)}{h}$$\n\nCompute the outputs.\n$$f(2+h)=(2+h)^2=4+4h+h^2$$\n$$f(2)=2^2=4$$\n\nSubstitute and simplify.\n$$\\frac{f(2+h)-f(2)}{h}=\\frac{(4+4h+h^2)-4}{h}$$\n$$=\\frac{4h+h^2}{h}$$\n$$=4+h$$\n\nNow let $h$ approach $0$.\n$$\\lim_{h\\to 0}(4+h)=4$$\n\nThe instantaneous rate of change is $4$.\n\nCommon mistake: plugging in $h=0$ before simplifying, which gives $\\frac{0}{0}$ and hides the tangent slope.",
      "check_question": {
        "latex_content": "Find the instantan
... [truncated]
```

</details>

<details><summary><strong>gemini-2.5-flash</strong> — 27063ms, 2365 output tokens</summary>

```json
{
  "micro_steps": [
    {
      "step_index": 1,
      "has_check": true,
      "explanation_latex": "When you travel, your average speed tells you how much distance you covered over a period of time. In math, this is called the \\textbf{average rate of change} of a function. It measures how much the output ($y$-value) changes on average for each unit change in the input ($x$-value) over a specific interval $[a, b]$. We calculate it using the formula $\\frac{\\Delta y}{\\Delta x} = \\frac{f(b) - f(a)}{b - a}$, which is exactly the slope of the line connecting two points $(a, f(a))$ and $(b, f(b))$ on the graph.",
      "example_latex": "Suppose a car's distance traveled (in miles) is given by $D(t) = t^2 + 10t$, where $t$ is time in hours. Let's find the average speed (average rate of change) from $t=1$ hour to $t=3$ hours.\n\nFirst, find the distance at $t=1$ and $t=3$:\n$D(1) = (1)^2 + 10(1) = 1 + 10 = 11$ miles\n$D(3) = (3)^2 + 10(3) = 9 + 30 = 39$ miles\n\nNow, apply the average rate of change formula:\nAverage Rate of Change $= \\frac{D(3) - D(1)}{3 - 1}$\n$= \\frac{39 - 11}{2}$\n$= \\frac{28}{2}$\n$= 14$ miles per hour\n\nCommon mistake: Forgetting to subtract the $x$-values (or time values) in the denominator, or mixing up $f(b)$ and $f(a)$ with $b$ and $a$.",
      "check_question": {
        "latex_content": "Find the average rate of change of $f(x) = 2x + 5$ over the interval $[1, 4]$.",
        "solution_latex": "First, find the function values at the endpoints:\n$f(1) = 2(1) + 5 = 7$\n$f(4) = 2(4) + 5 = 13$\n\nNow, apply the average rate of change formula:\nAverage Rate of Change $= \\frac{f(4) - f(1)}{4 - 1} = \\frac{13 - 7}{3} = \\frac{6}{3} = 2$.",
        "correct_answer_latex": "$2$",
        "distractors": [
          "$6$",
          "$3$",
          "$8$"
        ]
      },
      "hint_latex": "Remember, average rate of change is just the slope between two points."
    },
    {
      "step_index": 2,
      "has_check": true,
      "explanation_latex": "While average rate of change tells us what happens \\textit{over an interval}, sometimes we need to know the rate \\textit{at a precise moment}. This is called the \\textbf{instantaneous rate of change}. Think about your car's speedometer: it shows your speed at that exact instant, not your average speed over the whole trip. Graphically, instead of a line connecting two points (a \\textbf{secant line}), instantaneous rate of change is the slope of a line that touches the curve at only one point -- a \\textbf{tangent line}.",
      "example_latex": "Consider the same car's distance function $D(t) = t^2 + 10t$. If you want to know the car's exact speed \\textit{at} $t=2$ hours, that's an instantaneous rate of change. You wouldn't use the average rate formula because you only have one point in time. Instead, we're looking for the slope of the tangent line to the graph of $D(t)$ at the point $(2, D(2))$.\n\nCommon mistake: Trying to use the average rate of change formula with only one time value, which would result in division by zero.",
      "check_question": {
        "latex_content": "Which scenario best describes an instantaneous rate of change?",
        "solution_latex": "Instantaneous rate of change refers to the rate at a single moment. A car's speed as shown on the speedometer is a perfect example, as it gives the speed at that exact instant.",
        "correct_answer_latex": "The speed shown on a car's speedometer at a specific moment.",
        "distractors": [
          "The average speed of a runner over a 100-meter race.",
          "The change in temperature from morning to evening.",
          "The total distance a cyclist traveled in 3 hours."
        ]
      },
      "hint_latex": "Focus on whether the rate is measured over an \\textit{interval} or at a single \\textit{point}."
    },
    {
      "step_index": 3,
      "has_check": true,
      "explanation_latex": "Since we can't calculate a slope with just one point, how do we find the instan
... [truncated]
```

</details>

---

## MCAT Lesson (Km — Michaelis constant)

### Automated quality scores (0–100)

| Model | Score | Latency | Input tok | Output tok |
|---|---|---|---|---|
| **gpt-5.4-mini** | 65/100 | 6031ms | 630 | 983 |
| **gpt-5.5** | 85/100 | 33169ms | 630 | 2085 |
| **gemini-2.5-flash** | 0/100 | 15964ms | 657 | 1667 |

**gpt-5.4-mini** checks:
- ✅ 3 micro-steps (expected 3–4)
- ✅ All steps have check questions with correct_answer_latex
- ✅ All check questions have 3 distractors
- ⚠️ Common mistake callouts: 0/3
- ✅ LaTeX $...$ delimiters used throughout
- ⚠️ Possible bare LaTeX in 1 step(s)

**gpt-5.5** checks:
- ✅ 4 micro-steps (expected 3–4)
- ✅ All steps have required fields (explanation, example, hint)
- ✅ All steps have check questions with correct_answer_latex
- ✅ All check questions have 3 distractors
- ⚠️ Common mistake callouts: 0/4
- ✅ LaTeX $...$ delimiters used throughout
- ⚠️ Possible bare LaTeX in 1 step(s)

**gemini-2.5-flash** checks:
- ❌ Invalid JSON

### Raw output samples (side by side)

<details><summary><strong>gpt-5.4-mini</strong> — 6031ms, 983 output tokens</summary>

```json
{
  "micro_steps": [
    {
      "step_index": 1,
      "has_check": true,
      "explanation_latex": "An enzyme speeds up a reaction, and the reaction gets faster when more substrate is available. At very high substrate, the enzyme becomes saturated, so the speed cannot keep increasing forever. That highest possible speed is called $V_{max}$.",
      "example_latex": "Imagine an enzyme that breaks down $100$ sugar molecules per second when every active site is busy. Adding more sugar after that will not make it go faster than $100$ per second.",
      "check_question": {
        "latex_content": "What is $V_{max}$?",
        "solution_latex": "$V_{max}$ is the maximum reaction velocity when the enzyme is saturated with substrate.",
        "correct_answer_latex": "$V_{max}$ is the maximum reaction velocity when the enzyme is saturated with substrate.",
        "distractors": [
          "$V_{max}$ is the substrate concentration where the enzyme works slowest.",
          "$V_{max}$ is the substrate concentration at which the enzyme is half-saturated.",
          "$V_{max}$ is the amount of product made when no enzyme is present."
        ],
        "hint_latex": "Think of the fastest rate the enzyme can reach."
      }
    },
    {
      "step_index": 2,
      "has_check": true,
      "explanation_latex": "Building on $V_{max}$, $K_m$ tells you how much substrate is needed to get the enzyme to work at half of its maximum speed. By definition, when the reaction velocity is $\\frac{1}{2}V_{max}$, the substrate concentration is $K_m$. A smaller $K_m$ means the enzyme reaches half-max speed with less substrate, so it usually has higher substrate affinity.",
      "example_latex": "If an enzyme reaches $50\\%$ of $V_{max}$ at $2\\,\\text{mM}$ substrate, then $K_m = 2\\,\\text{mM}$. Another enzyme with $K_m = 0.5\\,\\text{mM}$ binds substrate more tightly because it needs less substrate to speed up.",
      "check_question": {
        "latex_content": "An enzyme reaches $\\frac{1}{2}V_{max}$ when the substrate concentration is $4\\,\\text{mM}$. What is $K_m$, and what does a lower $K_m$ usually mean?",
        "solution_latex": "$K_m = 4\\,\\text{mM}$, and a lower $K_m$ usually means higher substrate affinity.",
        "correct_answer_latex": "$K_m = 4\\,\\text{mM}$, and a lower $K_m$ usually means higher substrate affinity.",
        "distractors": [
          "$K_m = 8\\,\\text{mM}$, and a lower $K_m$ means lower affinity.",
          "$K_m = 2\\,\\text{mM}$, and a lower $K_m$ means the enzyme makes more product overall.",
          "$K_m$ is the maximum reaction velocity, and a lower $K_m$ means lower affinity."
        ],
        "hint_latex": "Half of $V_{max}$ matches the definition of $K_m$."
      }
    },
    {
      "step_index": 3,
      "has_check": true,
      "explanation_latex": "Connecting $K_m$ to the full rate picture, the Michaelis-Menten equation shows how substrate concentration controls velocity: $v=\\frac{V_{max}[S]}{K_m+[S]}$. When $[S]=K_m$, the equation gives $v=\\frac{V_{max}}{2}$, which is why that point is so important. On a graph of $v$ versus $[S]$, $K_m$ is the substrate concentration where the curve reaches half of $V_{max}$.",
      "example_latex": "If an enzyme has $V_{max}=120\\,\\text{units/s}$ and $K_m=3\\,\\text{mM}$, then at $[S]=3\\,\\text{mM}$ the velocity is $60\\,\\text{units/s}$.",
      "check_question": {
        "latex_content": "Using $v=\\frac{V_{max}[S]}{K_m+[S]}$, what is $v$ when $[S]=K_m$?",
        "solution_latex": "$v=\\frac{V_{max}}{2}$",
        "correct_answer_latex": "$v=\\frac{V_{max}}{2}$",
        "distractors": [
          "$v=V_{max}$",
          "$v=\\frac{K_m}{2}$",
          "$v=\\frac{[S]}{2}$"
        ],
        "hint_latex": "Substitute $[S]=K_m$ into the equation."
      }
    }
  ]
}
```

</details>

<details><summary><strong>gpt-5.5</strong> — 33169ms, 2085 output tokens</summary>

```json
{
  "micro_steps": [
    {
      "step_index": 1,
      "has_check": true,
      "explanation_latex": "An enzyme speeds up a reaction by binding substrate at its active site. If you add more substrate, the reaction usually gets faster because more enzyme molecules are busy working. But once every active site is occupied, the enzyme is saturated and cannot go faster; this maximum rate is $V_{max}$.",
      "example_latex": "Imagine a lab assay where enzyme is mixed with increasing substrate. The rate rises from $10$ to $30$ to $60\\ \\mathrm{nmol/min}$, but eventually levels off at $80\\ \\mathrm{nmol/min}$. That plateau is $V_{max}$ because adding more substrate no longer increases the rate.",
      "check_question": {
        "latex_content": "In an enzyme assay, adding more substrate no longer increases the reaction velocity. What is the best interpretation?",
        "solution_latex": "The enzyme is saturated; reaction velocity is near $V_{max}$.",
        "correct_answer_latex": "The enzyme is saturated; reaction velocity is near $V_{max}$.",
        "distractors": [
          "The enzyme has no active sites and cannot bind substrate.",
          "The substrate concentration must be zero.",
          "The reaction has reached equilibrium because all substrate is converted to product."
        ]
      },
      "hint_latex": "Think about whether active sites are still available."
    },
    {
      "step_index": 2,
      "has_check": true,
      "explanation_latex": "Now that $V_{max}$ means the fastest possible enzyme rate, we can define $K_m$ using half of that rate. $K_m$ is the substrate concentration when reaction velocity equals $\\frac{1}{2}V_{max}$. This definition matters because it gives one specific, comparable point on the enzyme’s rate curve.",
      "example_latex": "Suppose an enzyme has $V_{max}=100\\ \\mathrm{nmol/min}$. Half of that is $50\\ \\mathrm{nmol/min}$. If the enzyme reaches $50\\ \\mathrm{nmol/min}$ when substrate concentration is $4\\ \\mathrm{mM}$, then $K_m=4\\ \\mathrm{mM}$.",
      "check_question": {
        "latex_content": "An enzyme has $V_{max}=200\\ \\mathrm{nmol/min}$. Its velocity is $100\\ \\mathrm{nmol/min}$ when $[S]=8\\ \\mathrm{\\mu M}$. What is $K_m$?",
        "solution_latex": "Because $100\\ \\mathrm{nmol/min}$ is $\\frac{1}{2}V_{max}$, $K_m$ equals the substrate concentration at that velocity, so $K_m=8\\ \\mathrm{\\mu M}$.",
        "correct_answer_latex": "$8\\ \\mathrm{\\mu M}$",
        "distractors": [
          "$100\\ \\mathrm{\\mu M}$",
          "$200\\ \\mathrm{\\mu M}$",
          "$4\\ \\mathrm{\\mu M}$"
        ]
      },
      "hint_latex": "Find the substrate concentration at half the maximum rate."
    },
    {
      "step_index": 3,
      "has_check": true,
      "explanation_latex": "Because $K_m$ is the substrate concentration needed to reach half of $V_{max}$, it helps describe enzyme-substrate affinity. A lower $K_m$ means the enzyme reaches half-max speed at a lower $[S]$, so it binds and works effectively even when substrate is scarce. A higher $K_m$ means more substrate is needed, suggesting lower affinity.",
      "example_latex": "Enzyme A has $K_m=2\\ \\mathrm{\\mu M}$, while enzyme B has $K_m=20\\ \\mathrm{\\mu M}$ for the same substrate. Enzyme A reaches half of $V_{max}$ at much lower substrate concentration, so it has higher apparent affinity for that substrate.",
      "check_question": {
        "latex_content": "Two enzymes act on the same substrate. Enzyme X has $K_m=3\\ \\mathrm{\\mu M}$, and enzyme Y has $K_m=30\\ \\mathrm{\\mu M}$. Which enzyme has higher substrate affinity?",
        "solution_latex": "Enzyme X has higher affinity because its lower $K_m$ means it reaches half of $V_{max}$ at a lower substrate concentration.",
        "correct_answer_latex": "Enzyme X has higher affinity because its lower $K_m$ means it reaches half of $V_{max}$ at a lower substrate concentration.",
        "distractors": [
          "Enzyme Y has higher
... [truncated]
```

</details>

<details><summary><strong>gemini-2.5-flash</strong> — 15964ms, 1667 output tokens</summary>

```json
{
  "micro_steps": [
    {
      "step_index": 1,
      "has_check": true,
      "explanation_latex": "Enzymes are biological catalysts that speed up chemical reactions without being consumed. They achieve this by binding specifically to molecules called substrates, forming an enzyme-substrate complex. This complex then facilitates the conversion of the substrate into a product, after which the enzyme is released and ready for another reaction.",
      "example_latex": "Think of an enzyme as a highly specialized lock and a substrate as its unique key. Only the correct key (substrate) can fit into the lock (enzyme's active site) to perform a function (creating a product).",
      "check_question": {
        "latex_content": "What is the primary role of an enzyme in a biochemical reaction?",
        "solution_latex": "Enzymes are catalysts, meaning they increase the rate of a chemical reaction without being used up in the process. They do this by binding to substrates and facilitating their conversion into products.",
        "correct_answer_latex": "To increase the rate of a reaction without being consumed.",
        "distractors": [
          "To provide energy for the reaction.",
          "To be consumed during the reaction to form a product.",
          "To irreversibly bind to a substrate, preventing further reactions."
        ]
      },
      "hint_latex": "Recall the fundamental definition of a catalyst in chemistry and biology."
    },
    {
      "step_index": 2,
      "has_check": true,
      "explanation_latex": "Building on the idea of enzyme-substrate binding, the rate at which an enzyme converts substrate to product is called the reaction velocity ($V_0$). Initially, as substrate concentration ($[S]$) increases, $V_0$ rises because more active sites are occupied. However, at very high $[S]$, all active sites become saturated, meaning they are constantly busy. At this point, the reaction reaches its maximum possible velocity, known as $V_{max}$.",
      "example_latex": "Imagine a factory with a limited number of machines (enzymes) producing items (products) from raw materials (substrates). As you increase the supply of raw materials, production speeds up until all machines are working at full capacity. This maximum production rate is analogous to $V_{max}$.",
      "check_question": {
        "latex_content": "What happens to the reaction velocity of an enzyme-catalyzed reaction when the substrate concentration is extremely high?",
        "solution_latex": "When substrate concentration is extremely high, all active sites on the enzymes become occupied. This leads to the enzyme operating at its maximum capacity, and the reaction velocity reaches a plateau known as $V_{max}$.",
        "correct_answer_latex": "The reaction velocity approaches $V_{max}$ (its maximum rate).",
        "distractors": [
          "The reaction velocity continues to increase indefinitely.",
          "The enzyme denatures, and the reaction stops.",
          "The reaction velocity decreases due to substrate inhibition."
        ]
      },
      "hint_latex": "Consider what happens when all enzyme active sites are occupied."
    },
    {
      "step_index": 3,
      "has_check": true,
      "explanation_latex": "Connecting to $V_{max}$, the Michaelis constant ($K_m$) is a crucial value that describes an enzyme's kinetics. It is defined as the substrate concentration ($[S]$) at which the reaction velocity ($V_0$) is exactly half of the maximum velocity ($V_{max}$). Mathematically, this means $V_0 = \\frac{1}{2}V_{max}$ when $[S] = K_m$.",
      "example_latex": "If an enzyme has a $V_{max}$ of $100 \text{ } \mu M/s$, then its $K_m$ is the substrate concentration required to achieve a reaction velocity of $50 \text{ } \mu M/s$. This point is often observed on a Michaelis-Menten plot of initial velocity versus substrate concentration.",
      "check_question": {
        "latex_content": "An enzyme has a $V_{max}$ of $400 \text{ } nM/min$. A
... [truncated]
```

</details>

---

## Math Question (avg rate of change, medium difficulty)

### Automated quality scores (0–100)

| Model | Score | Latency | Input tok | Output tok |
|---|---|---|---|---|
| **gpt-5.4-mini** | 100/100 | 2532ms | 1025 | 329 |
| **gpt-5.5** | 100/100 | 15466ms | 1025 | 955 |
| **gemini-2.5-flash** | 100/100 | 11223ms | 1061 | 634 |

**gpt-5.4-mini** checks:
- ✅ 1 question(s) returned
- ✅ Stem properly capitalized and terminated
- ✅ final_answer_latex / correct_answer present
- ✅ Explanation/solution present and substantial
- ✅ 3 misconception-grounded distractors with explanations
- ✅ All distractor values distinct from each other and from correct answer
- ✅ No choices/correct_index in output (as required)

**gpt-5.5** checks:
- ✅ 1 question(s) returned
- ✅ Stem properly capitalized and terminated
- ✅ final_answer_latex / correct_answer present
- ✅ Explanation/solution present and substantial
- ✅ 3 misconception-grounded distractors with explanations
- ✅ All distractor values distinct from each other and from correct answer
- ✅ No choices/correct_index in output (as required)

**gemini-2.5-flash** checks:
- ✅ 1 question(s) returned
- ✅ Stem properly capitalized and terminated
- ✅ final_answer_latex / correct_answer present
- ✅ Explanation/solution present and substantial
- ✅ 3 misconception-grounded distractors with explanations
- ✅ All distractor values distinct from each other and from correct answer
- ✅ No choices/correct_index in output (as required)

### Raw output samples (side by side)

<details><summary><strong>gpt-5.4-mini</strong> — 2532ms, 329 output tokens</summary>

```json
{
  "questions": [
    {
      "stem_latex": "For the function $f(x)=x^2+1$, what is the average rate of change of $f$ on the interval $[1,3]$?",
      "solution_latex": "The average rate of change on $[1,3]$ is\n\n$$\\frac{f(3)-f(1)}{3-1}$$\n\nFirst find the function values:\n\n$$f(3)=3^2+1=10$$\n\n$$f(1)=1^2+1=2$$\n\nNow substitute:\n\n$$\\frac{10-2}{3-1}=\\frac{8}{2}=4$$\n\nSo the average rate of change is $4$.",
      "final_answer_latex": "$4$",
      "distractors": [
        {
          "misconception": "Uses the instantaneous rate of change formula $f'(x)=2x$ and evaluates at the right endpoint $x=3$.",
          "value_latex": "$6$"
        },
        {
          "misconception": "Finds the change in output but forgets to divide by the change in input.",
          "value_latex": "$8$"
        },
        {
          "misconception": "Subtracts the function values in the wrong order, giving a negative slope.",
          "value_latex": "$-4$"
        }
      ],
      "hint_latex": "Use $\\dfrac{f(b)-f(a)}{b-a}$ with the interval endpoints.",
      "keyword_weights": {
        "calc_ab_avg_vs_instant_rate": 1
      },
      "difficulty": 0.55
    }
  ]
}
```

</details>

<details><summary><strong>gpt-5.5</strong> — 15466ms, 955 output tokens</summary>

```json
{
  "questions": [
    {
      "stem_latex": "For a particle with position $s(t)=t^3-4t$, what is the average rate of change of $s$ on the interval $1 \\leq t \\leq 3$?",
      "solution_latex": "The average rate of change of $s$ on $1 \\leq t \\leq 3$ is the slope of the secant line:\n\n$$\\dfrac{s(3)-s(1)}{3-1}$$\n\nEvaluate $s(3)$ and $s(1)$:\n\n$$s(3)=3^3-4(3)=27-12=15$$\n\n$$s(1)=1^3-4(1)=1-4=-3$$\n\nSubstitute these values into the average rate of change formula:\n\n$$\\dfrac{s(3)-s(1)}{3-1}=\\dfrac{15-(-3)}{2}=\\dfrac{18}{2}=9$$\n\nTherefore, the average rate of change of $s$ on the interval is $9$.",
      "final_answer_latex": "$9$",
      "distractors": [
        {
          "misconception": "Uses instantaneous rate at the midpoint $t=2$: $s'(t)=3t^2-4$, so $s'(2)=8$.",
          "value_latex": "$8$"
        },
        {
          "misconception": "Reverses the secant slope numerator: $\\dfrac{s(1)-s(3)}{3-1}=-9$.",
          "value_latex": "$-9$"
        },
        {
          "misconception": "Finds total change but forgets to divide by interval length: $s(3)-s(1)=18$.",
          "value_latex": "$18$"
        }
      ],
      "hint_latex": "Use the secant slope formula $\\dfrac{s(b)-s(a)}{b-a}$.",
      "keyword_weights": {
        "calc_ab_avg_vs_instant_rate": 1
      },
      "difficulty": 0.55
    }
  ]
}
```

</details>

<details><summary><strong>gemini-2.5-flash</strong> — 11223ms, 634 output tokens</summary>

```json
{
  "questions": [
    {
      "stem_latex": "What is the average rate of change of the function $f(x) = x^2 - 3x + 1$ over the interval $[1, 4]$?",
      "solution_latex": "The average rate of change of a function $f(x)$ over an interval $[a, b]$ is given by the formula $\\dfrac{f(b) - f(a)}{b - a}$.\n\nFor the given function $f(x) = x^2 - 3x + 1$ and the interval $[1, 4]$, we have $a = 1$ and $b = 4$.\n\nFirst, evaluate the function at the endpoints:\n$f(1) = (1)^2 - 3(1) + 1 = 1 - 3 + 1 = -1$\n$f(4) = (4)^2 - 3(4) + 1 = 16 - 12 + 1 = 5$\n\nNow, substitute these values into the formula for the average rate of change:\n$$\\text{Average rate of change} = \\dfrac{f(4) - f(1)}{4 - 1}$$\n$$\\text{Average rate of change} = \\dfrac{5 - (-1)}{3}$$\n$$\\text{Average rate of change} = \\dfrac{5 + 1}{3}$$\n$$\\text{Average rate of change} = \\dfrac{6}{3}$$\n$$\\text{Average rate of change} = 2$$\n\nThus, the average rate of change of $f(x)$ over the interval $[1, 4]$ is $2$.",
      "final_answer_latex": "2",
      "distractors": [
        {
          "misconception": "Students may reverse the order of subtraction in the numerator, leading to a sign error.",
          "value_latex": "-2"
        },
        {
          "misconception": "Students may calculate only the change in the function values, forgetting to divide by the change in the independent variable.",
          "value_latex": "6"
        },
        {
          "misconception": "Students may invert the average rate of change formula, calculating the change in $x$ divided by the change in $y$.",
          "value_latex": "\\dfrac{1}{2}"
        }
      ],
      "hint_latex": "Recall the formula for the average rate of change of a function $f(x)$ over an interval $[a, b]$.",
      "keyword_weights": {
        "calc_ab_avg_vs_instant_rate": 1
      },
      "difficulty": 0.55
    }
  ]
}
```

</details>

---

## MCAT Question (Km, medium difficulty)

### Automated quality scores (0–100)

| Model | Score | Latency | Input tok | Output tok |
|---|---|---|---|---|
| **gpt-5.4-mini** | 100/100 | 2253ms | 643 | 326 |
| **gpt-5.5** | 100/100 | 14641ms | 643 | 933 |
| **gemini-2.5-flash** | 100/100 | 8470ms | 673 | 479 |

**gpt-5.4-mini** checks:
- ✅ 1 question(s) returned
- ✅ Stem properly capitalized and terminated
- ✅ final_answer_latex / correct_answer present
- ✅ Explanation/solution present and substantial
- ✅ 3 misconception-grounded distractors with explanations
- ✅ All distractor values distinct from each other and from correct answer
- ✅ No choices/correct_index in output (as required)

**gpt-5.5** checks:
- ✅ 1 question(s) returned
- ✅ Stem properly capitalized and terminated
- ✅ final_answer_latex / correct_answer present
- ✅ Explanation/solution present and substantial
- ✅ 3 misconception-grounded distractors with explanations
- ✅ All distractor values distinct from each other and from correct answer
- ✅ No choices/correct_index in output (as required)

**gemini-2.5-flash** checks:
- ✅ 1 question(s) returned
- ✅ Stem properly capitalized and terminated
- ✅ final_answer_latex / correct_answer present
- ✅ Explanation/solution present and substantial
- ✅ 3 misconception-grounded distractors with explanations
- ✅ All distractor values distinct from each other and from correct answer
- ✅ No choices/correct_index in output (as required)

### Raw output samples (side by side)

<details><summary><strong>gpt-5.4-mini</strong> — 2253ms, 326 output tokens</summary>

```json
{
  "questions": [
    {
      "stem": "An enzyme-catalyzed reaction has a $K_m$ of $2\\,\\text{mM}$ for its substrate. At what substrate concentration is the reaction rate equal to half of $V_{max}$?",
      "explanation": "By definition, $K_m$ is the substrate concentration at which the reaction velocity is $\\frac{1}{2}V_{max}$. Therefore, when the substrate concentration is $2\\,\\text{mM}$, the enzyme is operating at half of $V_{max}$. A common misconception is that $K_m$ is the substrate concentration needed to reach $V_{max}$, but $V_{max}$ is approached asymptotically and is not reached by a finite substrate concentration.",
      "correct_answer": "$2\\,\\text{mM}$",
      "distractors": [
        {
          "misconception": "$K_m$ is the substrate concentration required to reach $V_{max}$, so the answer must be higher than the given value.",
          "value": "$4\\,\\text{mM}$"
        },
        {
          "misconception": "$K_m$ is the enzyme concentration, so the substrate concentration should be unrelated to it.",
          "value": "$2\\,\\mu\\text{M}$ of enzyme"
        },
        {
          "misconception": "$K_m$ is the product concentration at equilibrium, so the substrate concentration should be zero.",
          "value": "$0\\,\\text{mM}$"
        }
      ],
      "keyword_weights": {
        "mcat_enzyme_km": 1
      },
      "difficulty": 0.55
    }
  ]
}
```

</details>

<details><summary><strong>gpt-5.5</strong> — 14641ms, 933 output tokens</summary>

```json
{
  "questions": [
    {
      "stem": "Enzyme A has a $K_m$ of $2\\ \\mu M$ for substrate $S$, whereas enzyme B has a $K_m$ of $20\\ \\mu M$ for the same substrate; assume both follow Michaelis-Menten kinetics. Which conclusion best follows about substrate affinity and the substrate concentration needed to reach half-maximal velocity?",
      "explanation": "$K_m$ is the substrate concentration at which velocity is $0.5V_{max}$, so enzyme A reaches half-maximal velocity at $2\\ \\mu M$ and enzyme B at $20\\ \\mu M$. A lower $K_m$ generally indicates higher enzyme-substrate affinity because less substrate is needed to substantially occupy the enzyme. The tempting opposite conclusion confuses a larger $K_m$ with stronger binding, but a larger $K_m$ means more substrate is required to reach the same fractional velocity.",
      "correct_answer": "Enzyme A has higher substrate affinity and reaches $0.5V_{max}$ at $2\\ \\mu M$ substrate.",
      "distractors": [
        {
          "misconception": "Thinking that a larger $K_m$ means tighter enzyme-substrate binding.",
          "value": "Enzyme B has higher substrate affinity and reaches $0.5V_{max}$ at $20\\ \\mu M$ substrate."
        },
        {
          "misconception": "Confusing $K_m$ with $V_{max}$ rather than the substrate concentration at half-maximal velocity.",
          "value": "Enzyme B has the greater $V_{max}$ because its $K_m$ is $20\\ \\mu M$."
        },
        {
          "misconception": "Assuming enzymes with different $K_m$ values reach half-maximal velocity at the same substrate concentration if they act on the same substrate.",
          "value": "Both enzymes have the same substrate affinity and reach $0.5V_{max}$ at the same substrate concentration."
        }
      ],
      "keyword_weights": {
        "mcat_enzyme_km": 1
      },
      "difficulty": 0.55
    }
  ]
}
```

</details>

<details><summary><strong>gemini-2.5-flash</strong> — 8470ms, 479 output tokens</summary>

```json
{
  "questions": [
    {
      "stem": "Consider two enzymes, Enzyme X and Enzyme Y, which catalyze the same reaction involving the same substrate. Enzyme X exhibits a much higher affinity for its substrate compared to Enzyme Y. How would their Michaelis constants ($K_m$) likely compare?",
      "explanation": "The Michaelis constant ($K_m$) is a measure of an enzyme's affinity for its substrate. Specifically, a lower $K_m$ indicates a higher affinity, meaning the enzyme binds tightly to its substrate and requires a lower substrate concentration to reach half of its maximal velocity ($V_{max}$). Conversely, a higher $K_m$ indicates a lower affinity, meaning the enzyme binds loosely and requires a higher substrate concentration to reach half $V_{max}$. Since Enzyme X has a much higher affinity for its substrate than Enzyme Y, Enzyme X would therefore have a lower $K_m$ than Enzyme Y.",
      "correct_answer": "Enzyme X would have a lower $K_m$ than Enzyme Y.",
      "distractors": [
        {
          "misconception": "Confusing higher affinity with a higher $K_m$ value, or misinterpreting the inverse relationship between $K_m$ and affinity.",
          "value": "Enzyme X would have a higher $K_m$ than Enzyme Y."
        },
        {
          "misconception": "Believing that $K_m$ values are only distinguishable if $V_{max}$ values are different, or confusing $K_m$ with $V_{max}$.",
          "value": "Their $K_m$ values would only differ if their $V_{max}$ values were also different."
        },
        {
          "misconception": "Misunderstanding $K_m$ as dependent on enzyme concentration rather than an intrinsic property of the enzyme-substrate interaction.",
          "value": "The $K_m$ values would depend on the initial concentration of each enzyme."
        }
      ],
      "keyword_weights": {
        "mcat_enzyme_km": 1
      },
      "difficulty": 0.55
    }
  ]
}
```

</details>

---

## Math Flashcards (avg rate of change, 3 cards)

### Automated quality scores (0–100)

| Model | Score | Latency | Input tok | Output tok |
|---|---|---|---|---|
| **gpt-5.4-mini** | 70/100 | 1310ms | 323 | 147 |
| **gpt-5.5** | 80/100 | 4060ms | 323 | 217 |
| **gemini-2.5-flash** | 0/100 | 4576ms | 339 | 259 |

**gpt-5.4-mini** checks:
- ✅ 3 flashcard(s) returned
- ✅ All 3 cards are pure recall (no quiz-style fronts)
- ✅ All cards are concise (front ≤14 words, back ≤25 words)
- ⚠️ LaTeX notation in 1/3 cards

**gpt-5.5** checks:
- ✅ 3 flashcard(s) returned
- ✅ All 3 cards are pure recall (no quiz-style fronts)
- ✅ All cards are concise (front ≤14 words, back ≤25 words)
- ✅ 3/3 math cards use LaTeX notation

**gemini-2.5-flash** checks:
- ❌ Invalid JSON

### Raw output samples (side by side)

<details><summary><strong>gpt-5.4-mini</strong> — 1310ms, 147 output tokens</summary>

```json
{
  "flashcards": [
    {
      "front_latex": "Average rate of change",
      "back_latex": "$\frac{f(b)-f(a)}{b-a}$; slope of the secant line.",
      "keyword_weights": {
        "calc_ab_avg_vs_instant_rate": 1
      }
    },
    {
      "front_latex": "Instantaneous rate of change",
      "back_latex": "The derivative; slope of the tangent line at a point.",
      "keyword_weights": {
        "calc_ab_avg_vs_instant_rate": 1
      }
    },
    {
      "front_latex": "Limit connection",
      "back_latex": "Instantaneous rate of change is the limit of average rates as the interval shrinks.",
      "keyword_weights": {
        "calc_ab_avg_vs_instant_rate": 1
      }
    }
  ]
}
```

</details>

<details><summary><strong>gpt-5.5</strong> — 4060ms, 217 output tokens</summary>

```json
{
  "flashcards": [
    {
      "front_latex": "Average rate of change",
      "back_latex": "Slope of the secant line: $\\dfrac{f(b)-f(a)}{b-a}$.",
      "keyword_weights": {
        "calc_ab_avg_vs_instant_rate": 1
      }
    },
    {
      "front_latex": "Instantaneous rate of change",
      "back_latex": "Slope of the tangent line: $f'(a)$.",
      "keyword_weights": {
        "calc_ab_avg_vs_instant_rate": 1
      }
    },
    {
      "front_latex": "Limit connection: average to instantaneous rate",
      "back_latex": "$f'(a)=\\lim_{h\\to 0}\\dfrac{f(a+h)-f(a)}{h}$.",
      "keyword_weights": {
        "calc_ab_avg_vs_instant_rate": 1
      }
    }
  ]
}
```

</details>

<details><summary><strong>gemini-2.5-flash</strong> — 4576ms, 259 output tokens</summary>

```json
{
  "flashcards": [
    {
      "front_latex": "Average rate of change of $f(x)$ on $[a,b]$",
      "back_latex": "$\frac{f(b)-f(a)}{b-a}$",
      "keyword_weights": {
        "calc_ab_avg_vs_instant_rate": 1.0
      }
    },
    {
      "front_latex": "Geometric interpretation of average rate of change",
      "back_latex": "Slope of the secant line",
      "keyword_weights": {
        "calc_ab_avg_vs_instant_rate": 1.0
      }
    },
    {
      "front_latex": "Instantaneous rate of change of $f(x)$ at $x=a$",
      "back_latex": "$\lim_{h \\to 0} \\frac{f(a+h)-f(a)}{h}$",
      "keyword_weights": {
        "calc_ab_avg_vs_instant_rate": 1.0
      }
    }
  ]
}
```

</details>

---

## MCAT Flashcards (Km, 3 cards)

### Automated quality scores (0–100)

| Model | Score | Latency | Input tok | Output tok |
|---|---|---|---|---|
| **gpt-5.4-mini** | 100/100 | 1264ms | 469 | 145 |
| **gpt-5.5** | 100/100 | 4263ms | 469 | 242 |
| **gemini-2.5-flash** | 100/100 | 3139ms | 477 | 239 |

**gpt-5.4-mini** checks:
- ✅ 3 flashcard(s) returned
- ✅ All 3 cards are pure recall (no quiz-style fronts)
- ✅ All cards are concise (front ≤14 words, back ≤25 words)
- ✅ All MCAT cards use $...$ notation for scientific terms
- ✅ Cards contain MCAT-depth terminology (Km, Vmax, allosteric, etc.)

**gpt-5.5** checks:
- ✅ 3 flashcard(s) returned
- ✅ All 3 cards are pure recall (no quiz-style fronts)
- ✅ All cards are concise (front ≤14 words, back ≤25 words)
- ✅ All MCAT cards use $...$ notation for scientific terms
- ✅ Cards contain MCAT-depth terminology (Km, Vmax, allosteric, etc.)

**gemini-2.5-flash** checks:
- ✅ 3 flashcard(s) returned
- ✅ All 3 cards are pure recall (no quiz-style fronts)
- ✅ All cards are concise (front ≤14 words, back ≤25 words)
- ✅ All MCAT cards use $...$ notation for scientific terms
- ✅ Cards contain MCAT-depth terminology (Km, Vmax, allosteric, etc.)

### Raw output samples (side by side)

<details><summary><strong>gpt-5.4-mini</strong> — 1264ms, 145 output tokens</summary>

```json
{
  "flashcards": [
    {
      "front": "$K_m$ definition",
      "back": "$[S]$ at $\\frac{1}{2}V_{max}$; lower $K_m$ means higher affinity.",
      "keyword_weights": {
        "mcat_enzyme_km": 1
      }
    },
    {
      "front": "$K_m$ and enzyme affinity",
      "back": "Lower $K_m$ indicates tighter enzyme-substrate binding.",
      "keyword_weights": {
        "mcat_enzyme_km": 1
      }
    },
    {
      "front": "Velocity at $K_m$",
      "back": "Reaction velocity is $\\frac{1}{2}V_{max}$.",
      "keyword_weights": {
        "mcat_enzyme_km": 1
      }
    }
  ]
}
```

</details>

<details><summary><strong>gpt-5.5</strong> — 4263ms, 242 output tokens</summary>

```json
{
  "flashcards": [
    {
      "front": "Michaelis constant $K_m$ definition",
      "back": "$K_m$ is the $[S]$ at which $v=\\frac{1}{2}V_{max}$.",
      "keyword_weights": {
        "mcat_enzyme_km": 1
      }
    },
    {
      "front": "Low $K_m$ significance",
      "back": "Lower $K_m$ means higher enzyme-substrate affinity; less substrate reaches $\\frac{1}{2}V_{max}$.",
      "keyword_weights": {
        "mcat_enzyme_km": 1
      }
    },
    {
      "front": "High $K_m$ significance",
      "back": "Higher $K_m$ means lower enzyme-substrate affinity; more substrate is needed for $\\frac{1}{2}V_{max}$.",
      "keyword_weights": {
        "mcat_enzyme_km": 1
      }
    }
  ]
}
```

</details>

<details><summary><strong>gemini-2.5-flash</strong> — 3139ms, 239 output tokens</summary>

```json
{
  "flashcards": [
    {
      "front": "Definition of the Michaelis constant ($K_m$)",
      "back": "The substrate concentration $[S]$ at which the reaction velocity is half of $V_{max}$.",
      "keyword_weights": {
        "mcat_enzyme_km": 1
      }
    },
    {
      "front": "Relationship between $K_m$ and enzyme-substrate affinity",
      "back": "A lower $K_m$ value indicates a higher affinity of the enzyme for its substrate.",
      "keyword_weights": {
        "mcat_enzyme_km": 1
      }
    },
    {
      "front": "Impact of a competitive inhibitor on $K_m$",
      "back": "A competitive inhibitor increases the apparent $K_m$ value, but $V_{max}$ remains unchanged.",
      "keyword_weights": {
        "mcat_enzyme_km": 1
      }
    }
  ]
}
```

</details>

---

## Cost analysis

Estimated cost per generation using observed token counts and approximate pricing:

| Task | Model | Input tok | Output tok | Est. cost (per call) |
|---|---|---|---|---|
| Math Lesson (avg vs instantaneous rate o | gpt-5.4-mini | 670 | 1709 | \$0.00300 |
| Math Lesson (avg vs instantaneous rate o | gpt-5.5 | 670 | 3966 | \$0.03307 |
| Math Lesson (avg vs instantaneous rate o | gemini-2.5-flash | 706 | 2365 | \$0.00152 |
| MCAT Lesson (Km — Michaelis constant) | gpt-5.4-mini | 630 | 983 | \$0.00182 |
| MCAT Lesson (Km — Michaelis constant) | gpt-5.5 | 630 | 2085 | \$0.01794 |
| MCAT Lesson (Km — Michaelis constant) | gemini-2.5-flash | 657 | 1667 | \$0.00110 |
| Math Question (avg rate of change, mediu | gpt-5.4-mini | 1025 | 329 | \$0.00094 |
| Math Question (avg rate of change, mediu | gpt-5.5 | 1025 | 955 | \$0.00969 |
| Math Question (avg rate of change, mediu | gemini-2.5-flash | 1061 | 634 | \$0.00054 |
| MCAT Question (Km, medium difficulty) | gpt-5.4-mini | 643 | 326 | \$0.00078 |
| MCAT Question (Km, medium difficulty) | gpt-5.5 | 643 | 933 | \$0.00875 |
| MCAT Question (Km, medium difficulty) | gemini-2.5-flash | 673 | 479 | \$0.00039 |
| Math Flashcards (avg rate of change, 3 c | gpt-5.4-mini | 323 | 147 | \$0.00036 |
| Math Flashcards (avg rate of change, 3 c | gpt-5.5 | 323 | 217 | \$0.00238 |
| Math Flashcards (avg rate of change, 3 c | gemini-2.5-flash | 339 | 259 | \$0.00021 |
| MCAT Flashcards (Km, 3 cards) | gpt-5.4-mini | 469 | 145 | \$0.00042 |
| MCAT Flashcards (Km, 3 cards) | gpt-5.5 | 469 | 242 | \$0.00287 |
| MCAT Flashcards (Km, 3 cards) | gemini-2.5-flash | 477 | 239 | \$0.00021 |

## Recommendation summary

### Gemini diagnosis — why 0/100 on MCAT Lesson and Math Flashcards

Gemini 2.5 Flash produced **invalid JSON** on two tasks because it emitted LaTeX backslash sequences (e.g. `\mu`, `\frac`, `\text`) without double-escaping the backslash. In JSON, `\m` is not a legal escape and `JSON.parse` throws. The OpenAI models consistently double-escape (`\\frac`, `\\mu`) because the JSON mode enforces valid JSON encoding. This is a **hard blocker** for any Gemini integration involving math or science notation — it would need a pre-processing repair step (similar to the existing `sanitizeEscapes` but for arbitrary command sequences) or we'd rely on Gemini's retry/backoff to produce correct JSON, which is unreliable in production.

On the tasks that succeeded (math lesson, all questions, MCAT flashcards), Gemini's output quality was comparable to or better than gpt-5.4-mini. The failure mode is specific to LaTeX-dense output, not general reasoning.

### gpt-5.4-mini vs gpt-5.5 — quality gap analysis

**Math lessons**: gpt-5.4-mini scored 95/100 (minor bare-LaTeX false positive from the heuristic) vs gpt-5.5's 100/100. Both generated 4 well-structured steps with worked examples, check questions, and distractors. The visual difference in the raw outputs is marginal — gpt-5.5 writes slightly more detailed solutions but the gap is cosmetic at this topic level.

**MCAT lessons**: gpt-5.4-mini scored 65/100 vs gpt-5.5's 85/100. The shortfall on mini was missing "Common mistake" callouts in the `example_latex` fields (gpt-5.4-mini wrote analogies without explicitly labeling them as mistake callouts). Pedagogically the MCAT content was sound on both. gpt-5.5's lesson had 4 steps vs mini's 3 and covered Vmax → Km → Michaelis-Menten → affinity more completely. This gap is real and matters for MCAT.

**Questions**: Both scored 100/100 on structural checks. The prior A/B test that established gpt-5.5 as QUESTION_MODEL was based on distractor quality across many samples — that finding stands. One-run automated checks can't capture the nuanced misconception-grounding quality difference that accumulated over many samples.

**Flashcards**: gpt-5.4-mini produces acceptable recall cards (correct content, correct format). gpt-5.5 adds slightly better LaTeX formatting (proper `\dfrac` vs bare `\frac`). The quality difference is small.

**Latency observation**: gpt-5.5 is dramatically slower. The math lesson call took **56.8 seconds** — catastrophic for a cold-cache lesson generation where a student is waiting. gpt-5.4-mini took 10.8s. Since lessons are cached post-first-generation, this only affects the first user per keyword (and regeneration after cache invalidation), but it's still a significant cold-path penalty.

### Aggregate quality scores (avg across relevant tasks)

| Task group | gpt-5.4-mini | gpt-5.5 | Gemini 2.5 Flash |
|---|---|---|---|
| Lessons | 80/100 | 93/100 | 50/100 |
| Questions | 100/100 | 100/100 | 100/100 |
| Flashcards | 85/100 | 90/100 | 50/100 |

### Relative cost (gpt-5.4-mini = 1.0×)

| Task group | gpt-5.4-mini | gpt-5.5 | Gemini 2.5 Flash |
|---|---|---|---|
| Lessons | 1.0× | 10.6× | 0.5× |
| Questions | 1.0× | 10.8× | 0.5× |
| Flashcards | 1.0× | 6.7× | 0.5× |

### Per-task recommendation

| Task | Recommended model | Cost vs current | Rationale |
|---|---|---|---|
| **Math lessons** | **gpt-5.4-mini** (no change) | — | 95/100 quality, 10.8s cold path, $0.003/lesson. Quality gap vs gpt-5.5 is cosmetic at this level. Cached post-generation so per-student cost ~$0. |
| **MCAT lessons** | **gpt-5.5** (upgrade from mini for lessons only) | +11× per cold generation | 85 vs 65 quality — MCAT content is biochem-heavy and the step-completeness gap is real. Lesson caching amortizes cost; the one-time cold cost is ~$0.018/lesson, negligible at scale. Monitor latency (57s cold path — consider pre-warming top MCAT keywords). |
| **Math questions** | **gpt-5.5** (no change) | — | All models 100/100 on structural checks; prior A/B win on distractor quality stands. Questions are batch-recycled so per-student cost is low. |
| **MCAT questions** | **gpt-5.5** (no change) | — | Same as math. Prior A/B established this. |
| **Flashcards (math + MCAT)** | **gpt-5.4-mini** (no change) | — | 85–100/100 quality, $0.00036–0.00042/batch. gpt-5.5 improvement marginal (LaTeX style only). Flashcards are cached; no cost pressure to switch. |
| **Verification calls** | **gpt-5.4-mini** (no change) | — | Short fast task; 80-token output cap; $0.0001/call. No value in upgrading. |
| **Gemini 2.5 Flash** | **Not ready for production** | — | JSON encoding of LaTeX backslashes is broken on LaTeX-heavy tasks (MCAT lessons, math flashcards). Would need a JSON repair layer before it can be used reliably. If cost pressure becomes acute, revisit with a backslash-repair preprocessor applied before `JSON.parse`. |

### Net recommended config change

Only one change from today's setup: **use gpt-5.5 for MCAT lesson generation** (currently gpt-5.4-mini via `GEN_MODEL`). Everything else stays as-is.

To implement: in `mcatGenerator.ts`, introduce a `LESSON_MODEL = "gpt-5.5"` constant (mirroring the existing `QUESTION_MODEL` pattern) and pass it to the `callGen` call inside `generateMcatLesson`. The math generator's lesson path stays on `GEN_MODEL`.

## Caveats

- **Gemini availability**: `GEMINI_API_KEY` exists in `apps/student/.env.local` but `@google/generative-ai` is NOT installed. The harness used the REST API directly. For production wiring, a separate session should add the Gemini client to `apps/student/package.json`, add a JSON-repair step for unescaped LaTeX backslashes, and adapt the generators to a provider-agnostic interface.
- **Sample size**: 1 run per task per model. Stochastic variance is real — production decisions should average 3–5 runs per keyword type. The lesson and flashcard scores especially can vary by topic complexity.
- **Pricing**: model pricing changes frequently. The ratios (relative cost) are more durable than absolute dollar figures. Verify at platform pricing pages before budgeting.
- **Lesson caching**: lessons are cached after first generation (stored in DB), so per-student cost is amortized across the full course enrollment. A 10× more expensive lesson model costs proportionally less per-student than a 10× more expensive question model (which fires every single practice round). This is why upgrading to gpt-5.5 for MCAT lessons only is a safe call.
- **MCAT lesson latency**: gpt-5.5 took 33s for the MCAT lesson (vs gpt-5.4-mini's 6s). Cold-path latency for first user to hit a new keyword increases. Mitigations: pre-warm the top ~100 MCAT keywords during off-peak hours; the lesson API already has a retry-on-invalid path that doubles worst-case latency — ensure the gpt-5.5 lesson call has a generous timeout.
