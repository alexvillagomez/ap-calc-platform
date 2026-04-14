import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import {
  buildApCalcFRQUserPrompt,
  buildApCalcMCQUserPrompt,
  buildCreateSystemPrompt,
  buildRefineSystemPrompt,
} from "@/lib/ai/prompts";
import {
  getDifficultyNarrative,
  getFrqArchetypeById,
  getMcqDifficultyPhrase,
  pickRandomFrqArchetype,
} from "@/lib/ai/examPrepConstants";
import { normalizeRichMathSource } from "@/lib/latexRichMathNormalize";
import { normalizeMcqChoices } from "@/lib/latexNormalize";

/** MCQ prompt template: correct_index chosen by server on create. */
function buildMcqSchemaJson(correctIndex: number): string {
  const ci = Math.min(3, Math.max(0, Math.floor(correctIndex)));
  return `{
  "latex_content": "",
  "solution_latex": "",
  "choices": [
    "A choice",
    "B choice",
    "C choice",
    "D choice"
  ],
  "correct_index": ${ci}
}`;
}

function buildFrSchemaJson(): string {
  return `{
  "latex_content": "...",
  "solution_latex": "...",
  "rubric": "..."
}`;
}

function resolveTopicIds(
  body: { topicId?: string; topicIds?: string[] },
  isRefinement: boolean,
  previousProblem?: Record<string, unknown>
): string[] {
  if (isRefinement && previousProblem) {
    const fromBody = body.topicIds;
    if (Array.isArray(fromBody) && fromBody.length > 0) {
      return fromBody.map(String);
    }
    const tw = previousProblem.topic_weights;
    if (tw && typeof tw === "object" && !Array.isArray(tw)) {
      return Object.keys(tw as Record<string, unknown>);
    }
    return [];
  }
  if (Array.isArray(body.topicIds) && body.topicIds.length > 0) {
    return body.topicIds.map(String);
  }
  if (typeof body.topicId === "string" && body.topicId) {
    return [body.topicId];
  }
  return [];
}

/** Light LaTeX cleanup (keep content as raw LaTeX for katex.renderToString). */
function sanitizeLatexContent(str: string): string {
  let out = normalizeRichMathSource(str);
  // Convert \newline to \\ so aligned-style layouts still break lines in KaTeX.
  out = out.replace(/\\newline\b/g, "\\\\");
  // Models often put "\[0.5em]" or "\\[0.5em]" on its own line — invalid in aligned; KaTeX shows red junk.
  // Remove those standalone lines first.
  out = out.replace(/^\s*\\\[\s*[0-9.]+\s*em\s*\]\s*$/gm, "");
  out = out.replace(/^\s*\\\\\[\s*[0-9.]+\s*em\s*\]\s*$/gm, "");
  out = out.replace(/\n{3,}/g, "\n\n");
  // Merge: row-ending "\\" + newline + standalone "\[...em]" -> "\\[...em]" after that "\\" (valid in aligned).
  out = out.replace(/(\\\\)\s*\n\s*\\\[\s*([0-9.]+\s*em)\s*\]/g, "$1[$2]");
  // Remaining "\[0.5em]" that should be optional space after "\\" (single backslash before bracket).
  out = out.replace(/\\\[\s*([0-9.]+\s*em)\s*\]/g, "\\\\[$1]");
  // Variable doubling: "function HH" / "at which HH" -> use single H (wrap in $ for consistency)
  out = out.replace(/\bfunction\s+HH\b/gi, "function H");
  out = out.replace(/\bat which HH\b/gi, "at which H");

  // Preserve only our embedded visual tags. Do NOT escape `<` / `>` globally — LaTeX uses `>` and `<`
  // in inequalities (e.g. piecewise `x > 2`); escaping breaks KaTeX and shows raw TeX in the UI.
  const placeholders: string[] = [];
  out = out.replace(/<(SlopeField|FunctionGraph)\s+[^>]*\/>/gi, (m) => {
    const idx = placeholders.push(m) - 1;
    return `@@VISUAL_${idx}@@`;
  });
  // Strip obvious raw HTML if the model emits it (tags are not valid KaTeX input anyway).
  out = out.replace(/<\s*script\b[^>]*>[\s\S]*?<\s*\/\s*script\s*>/gi, "");
  out = out.replace(/<\s*iframe\b[^>]*>[\s\S]*?<\s*\/\s*iframe\s*>/gi, "");
  out = out.replace(/@@VISUAL_(\d+)@@/g, (_m, n) => placeholders[Number(n)] ?? "");

  return out;
}

export async function POST(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  if (!supabaseUrl) {
    return NextResponse.json(
      { error: "Supabase is not configured" },
      { status: 500 }
    );
  }
  const supabaseKey = serviceRoleKey ?? anonKey;
  if (!supabaseKey) {
    return NextResponse.json(
      { error: "Supabase is not configured" },
      { status: 500 }
    );
  }
  if (!serviceRoleKey && anonKey) {
    console.warn(
      "generate-problem: using anon key; set SUPABASE_SERVICE_ROLE_KEY for service-role access"
    );
  }
  if (!openaiKey) {
    console.error("OPENAI_API_KEY is not set");
    return NextResponse.json(
      { error: "OPENAI_API_KEY is not configured" },
      { status: 500 }
    );
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  const openai = new OpenAI({ apiKey: openaiKey });

  try {
    const body = await request.json();
    const {
      topicId,
      topicIds: topicIdsBody,
      difficulty,
      questionType,
      previousProblem,
      feedback,
    } = body as {
      topicId?: string;
      topicIds?: string[];
      difficulty?: number;
      questionType?: "multiple_choice" | "free_response";
      previousProblem?: Record<string, unknown>;
      feedback?: string;
    };

    const isRefinement =
      typeof feedback === "string" &&
      feedback.trim().length > 0 &&
      previousProblem &&
      typeof previousProblem === "object";

    let topicIdsResolved: string[] = [];
    let orderedTopics: { id: string; name: string | null; description: string | null }[] = [];

    let refinementSeedTopics: string[] = [];
    if (isRefinement) {
      refinementSeedTopics = resolveTopicIds(
        { topicId, topicIds: topicIdsBody },
        true,
        previousProblem as Record<string, unknown> | undefined
      );
      if (refinementSeedTopics.length === 0) {
        return NextResponse.json(
          {
            error:
              "Could not resolve topics for refinement (missing topic_weights on previous problem)",
          },
          { status: 400 }
        );
      }
    }

    const { data: topicRows, error: topicFetchError } = await supabase
      .from("topic_metadata")
      .select("id, name, description");

    if (topicFetchError || !topicRows?.length) {
      console.error("Topic fetch failed:", topicFetchError?.message ?? "No topics");
      return NextResponse.json({ error: "No topics found" }, { status: 404 });
    }

    orderedTopics = [...topicRows].sort((a, b) => String(a.id).localeCompare(String(b.id)));
    const catalogIds = new Set(orderedTopics.map((t) => t.id));

    if (isRefinement) {
      for (const id of refinementSeedTopics) {
        if (!catalogIds.has(id)) {
          return NextResponse.json({ error: `Topic not found: ${id}` }, { status: 404 });
        }
      }
      topicIdsResolved = refinementSeedTopics;
    } else {
      const requested =
        Array.isArray(topicIdsBody) && topicIdsBody.length > 0
          ? topicIdsBody.map(String).filter((id) => catalogIds.has(id))
          : typeof topicId === "string" && topicId && catalogIds.has(topicId)
            ? [topicId]
            : [];
      if (requested.length === 0) {
        return NextResponse.json(
          { error: "Select at least one valid topic id from the catalog" },
          { status: 400 }
        );
      }
      topicIdsResolved = requested;
    }

    const poolTopicRows = orderedTopics.filter((t) => topicIdsResolved.includes(t.id));
    const compactTopicLines = poolTopicRows
      .map((t) => {
        const name = (t.name ?? "").trim();
        const skill = (t.description ?? "").trim();
        if (name && skill) return `${t.id}: ${name} (${skill})`;
        if (name) return `${t.id}: ${name}`;
        return `${t.id}: ${skill || t.id}`;
      })
      .join("\n");

    console.log("Topic pool:", topicIdsResolved, "Refinement:", isRefinement);

    let type: "multiple_choice" | "free_response";
    let difficultyNum: number | undefined;

    if (isRefinement) {
      const prev = previousProblem as Record<string, unknown>;
      type =
        prev.rubric != null && typeof prev.rubric === "string"
          ? "free_response"
          : "multiple_choice";
      difficultyNum = typeof prev.difficulty === "number" ? prev.difficulty : undefined;
    } else {
      difficultyNum = difficulty != null ? Number(difficulty) : undefined;
      if (
        difficultyNum != null &&
        (isNaN(difficultyNum) || difficultyNum < 1 || difficultyNum > 5)
      ) {
        return NextResponse.json(
          { error: "difficulty must be an integer between 1 and 5" },
          { status: 400 }
        );
      }
      type = questionType === "free_response" ? "free_response" : "multiple_choice";
    }

    let mcqEmphasisIdCreate: string | undefined;
    if (!isRefinement && type === "multiple_choice" && topicIdsResolved.length > 0) {
      mcqEmphasisIdCreate =
        topicIdsResolved[Math.floor(Math.random() * topicIdsResolved.length)];
    }

    let mcqCorrectIndexForSchema = 0;
    if (type === "multiple_choice") {
      if (isRefinement) {
        const prev = previousProblem as Record<string, unknown>;
        const ci = prev.correct_index;
        mcqCorrectIndexForSchema =
          typeof ci === "number" && Number.isFinite(ci) && ci >= 0 && ci <= 3
            ? Math.floor(ci)
            : 0;
      } else {
        mcqCorrectIndexForSchema = Math.floor(Math.random() * 4);
      }
    }

    const difficultyLevelClamped = Math.min(5, Math.max(1, Math.round(difficultyNum ?? 3)));

    const schemaExampleBlock =
      type === "multiple_choice"
        ? buildMcqSchemaJson(mcqCorrectIndexForSchema)
        : buildFrSchemaJson();

    const difficultyNarrative = getDifficultyNarrative(difficultyNum ?? 3);
    const mcqDifficultyPhrase = getMcqDifficultyPhrase(difficultyNum ?? 3);

    const systemPrompt = isRefinement
      ? buildRefineSystemPrompt(type)
      : buildCreateSystemPrompt(type);

    type GenerationMeta = {
      emphasis_topic_id?: string;
      emphasis_topic_name?: string;
      emphasis_topic_description?: string;
      frq_archetype_id?: number;
      frq_type?: string;
      frq_label?: string;
    };

    let generationMeta: GenerationMeta | undefined;
    let userPrompt: string;

    if (type === "multiple_choice") {
      let emphasisTopicId: string | null;
      let emphasisTopicName: string | undefined;
      let emphasisTopicSkillDescription: string | undefined;

      if (isRefinement) {
        const prev = previousProblem as Record<string, unknown>;
        const meta = prev.generation_meta as GenerationMeta | undefined;
        const tw = prev.topic_weights as Record<string, number> | undefined;
        const fromMeta = meta?.emphasis_topic_id;
        const fromTw =
          tw && typeof tw === "object"
            ? Object.entries(tw).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))[0]?.[0]
            : undefined;
        const eid = fromMeta ?? fromTw ?? topicIdsResolved[0] ?? null;
        emphasisTopicId = eid;
        const row = eid ? orderedTopics.find((t) => t.id === eid) : undefined;
        const fromDbName = (row?.name ?? "").trim();
        const fromDbSkill = (row?.description ?? "").trim();
        const fromMetaName = (meta?.emphasis_topic_name ?? "").trim();
        const fromMetaSkill = (meta?.emphasis_topic_description ?? "").trim();
        emphasisTopicName = fromMetaName || fromDbName || undefined;
        emphasisTopicSkillDescription = fromMetaSkill || fromDbSkill || undefined;
      } else {
        const eid = mcqEmphasisIdCreate ?? topicIdsResolved[0]!;
        emphasisTopicId = eid;
        const row = orderedTopics.find((t) => t.id === eid);
        const catalogName = (row?.name ?? "").trim();
        const catalogSkill = (row?.description ?? "").trim();
        emphasisTopicName = catalogName || undefined;
        emphasisTopicSkillDescription = catalogSkill || undefined;
        generationMeta = {
          emphasis_topic_id: eid,
          ...(catalogName ? { emphasis_topic_name: catalogName } : {}),
          ...(catalogSkill ? { emphasis_topic_description: catalogSkill } : {}),
        };
      }

      userPrompt = buildApCalcMCQUserPrompt({
        mode: isRefinement ? "refine" : "create",
        difficultyPhrase: mcqDifficultyPhrase,
        difficultyLevel: difficultyLevelClamped,
        schemaExampleBlock,
        emphasisTopicId,
        emphasisTopicName,
        emphasisTopicSkillDescription,
        previousProblemJson: isRefinement
          ? JSON.stringify(previousProblem, null, 2)
          : undefined,
        feedback: isRefinement ? feedback.trim() : undefined,
      });
    } else {
      let frqType: "A" | "B" | "C" | "D" | "E" | "F" | "G";
      let archetypeInstruction: string | undefined;
      let archetypeLabel: string | undefined;

      if (isRefinement) {
        const prev = previousProblem as Record<string, unknown>;
        const meta = prev.generation_meta as GenerationMeta | undefined;
        const letter = (meta?.frq_type ?? "D") as string;
        const allowed = new Set(["A", "B", "C", "D", "E", "F", "G"]);
        frqType = (allowed.has(letter) ? letter : "D") as typeof frqType;
        const arch = meta?.frq_archetype_id
          ? getFrqArchetypeById(meta.frq_archetype_id)
          : undefined;
        archetypeInstruction = arch?.instruction;
        archetypeLabel = arch?.label;
      } else {
        const arch = pickRandomFrqArchetype();
        frqType = arch.frqType;
        archetypeInstruction = arch.instruction;
        archetypeLabel = arch.label;
        generationMeta = {
          frq_archetype_id: arch.id,
          frq_type: arch.frqType,
          frq_label: arch.label,
        };
      }

      userPrompt = buildApCalcFRQUserPrompt({
        mode: isRefinement ? "refine" : "create",
        difficultyNarrative,
        topicLines: compactTopicLines,
        singleTopicId: null,
        schemaExampleBlock,
        calculatorAllowed: false,
        frqType,
        archetypeInstruction,
        archetypeLabel,
        previousProblemJson: isRefinement
          ? JSON.stringify(previousProblem, null, 2)
          : undefined,
        feedback: isRefinement ? feedback.trim() : undefined,
      });
    }

    // Single OpenAI completion; ordering is prompt-enforced in AP_CALC_*_SYSTEM + user builders.
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
      ...(!isRefinement ? { temperature: 1.08 } : {}),
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) {
      return NextResponse.json(
        { error: "No response from OpenAI" },
        { status: 500 }
      );
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(content) as Record<string, unknown>;
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON from OpenAI", raw: content },
        { status: 500 }
      );
    }

    const baseRequired = ["latex_content", "solution_latex"];
    const required =
      type === "multiple_choice"
        ? [...baseRequired, "choices", "correct_index"]
        : [...baseRequired, "rubric"];

    for (const key of required) {
      if (!(key in parsed)) {
        return NextResponse.json(
          { error: `Invalid response: missing field "${key}"`, raw: content },
          { status: 500 }
        );
      }
    }

    if (type === "free_response") {
      if (typeof parsed.solution_latex !== "string" || !parsed.solution_latex.trim()) {
        return NextResponse.json(
          { error: "Invalid response: solution_latex must be a non-empty string", raw: content },
          { status: 500 }
        );
      }
      if (typeof parsed.rubric !== "string" || !parsed.rubric.trim()) {
        return NextResponse.json(
          { error: "Invalid response: rubric must be a non-empty string", raw: content },
          { status: 500 }
        );
      }
    }

    // LaTeX safety: always return latex_content and solution_latex as strings so JSON is valid.
    // Coerce non-strings (e.g. from malformed model output) and preserve existing strings as-is
    // (double backslashes in JSON source become single backslash in parsed string; no change needed).
    const latexContent = typeof parsed.latex_content === "string" ? parsed.latex_content : String(parsed.latex_content ?? "");
    const solutionLatex = typeof parsed.solution_latex === "string" ? parsed.solution_latex : String(parsed.solution_latex ?? "");
    // Keep fields as raw LaTeX for katex.renderToString, apply light cleanup only.
    parsed.latex_content = sanitizeLatexContent(latexContent);
    parsed.solution_latex = sanitizeLatexContent(solutionLatex);

    if (type === "multiple_choice") {
      const normalizedChoices = normalizeMcqChoices(parsed.choices);
      if (normalizedChoices) parsed.choices = normalizedChoices;
    }

    // Strip difficulty and topic_weights — these are assigned by the separate assess-problem API.
    delete parsed.difficulty;
    delete parsed.topic_weights;

    const metaPersist =
      !isRefinement && generationMeta
        ? generationMeta
        : isRefinement &&
            previousProblem &&
            typeof (previousProblem as Record<string, unknown>).generation_meta === "object"
          ? (previousProblem as Record<string, unknown>).generation_meta
          : generationMeta;
    if (metaPersist && typeof metaPersist === "object") {
      (parsed as Record<string, unknown>).generation_meta = metaPersist;
    }

    const {
      topic_id: _omitTopicId,
      user_topic_priorities: _omitPri,
      difficulty: _omitDiff,
      topic_weights: _omitTW,
      ...responseBody
    } = parsed as Record<string, unknown>;
    void _omitTopicId;
    void _omitPri;
    void _omitDiff;
    void _omitTW;
    return NextResponse.json({
      ...responseBody,
      // Pass back the resolved topic pool so the frontend can forward it to assess-problem.
      resolved_topic_ids: topicIdsResolved,
      generation_prompts: { system: systemPrompt, user: userPrompt },
    });
  } catch (err) {
    console.error("generate-problem error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
