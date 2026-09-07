import { GoogleGenAI } from "@google/genai";
import { createLogger, withTimeout, retry } from "./_lib/forge-integrity.js";
import { requireAuth } from "./_lib/auth.js";

const log = createLogger("generate-daily-challenge");

let googleAI;
let geminiModel;
try {
  const apiKey = process.env.GEMINI_API_KEY;
  geminiModel = process.env.GEMINI_MODEL || "gemini-3.1-flash-lite";
  if (!apiKey) log.warn("GEMINI_API_KEY not set");
  else googleAI = new GoogleGenAI({ apiKey });
} catch (e) {
  log.error("init error", e);
}
function isConfigured() { return !!googleAI; }

function parseJson(text) {
  try {
    const cleaned = text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
    return JSON.parse(cleaned);
  } catch (e) {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) try { return JSON.parse(m[0]); } catch {}
    throw e;
  }
}

const TEMPLATE_SPECS = {
  mixedQuiz: "Mixed Quiz – 4-6 multipleChoice/trueFalse/fillBlank questions sampling multiple subtopics. Each question 2-3 sentences with context.",
  weakTopicRecovery: "Weak Topic Recovery – 3-5 questions targeting the user's weak concepts exactly. Provide misconception distractors.",
  explainConcept: "Explain a Concept – Ask learner to explain a concept in 3-5 sentences. Provide rubric with key points (3-4) and sample answer. Grading is self-assessed but include model answer.",
  matchFollowing: "Match the Following – 4-6 pairs left/right requiring conceptual mapping, not trivial recall. Provide pairs array.",
  caseStudy: "Case Study – Provide a 120-180 word scenario/passage + 3-4 analytical questions (multipleChoice). Include context field.",
  diagramLabeling: "Diagram Labeling – Describe a diagram in text (since no image yet) with 4-5 labels to identify. Provide diagramDescription and labels array with questions.",
  realLifeApplication: "Real-life Application – Real-world scenario (e.g., household, workplace) + 3-4 application questions linking theory to practice.",
  timedRecall: "Timed Recall – Rapid 5-7 short questions (30s each conceptually). Mix recall and understanding, but timePressure true.",
  multiStepReasoning: "Multi-step Reasoning – 2-3 multi-step problems each with 2-3 sub-questions chaining. Provide steps and requires sequential logic.",
  examSprint: "Exam Sprint – 5-6 exam-style questions (board-relevant) with marks distribution, covering high-weight topics. Include examTips.",
};

function buildPrompt(payload) {
  const {
    date,
    templateId,
    previousTemplateId,
    difficulty,
    focusSubject,
    candidateSubjects = [],
    weakConcepts = "",
    weakTopics = [],
    recentLessons = [],
    upcomingSessions = [],
    examDates = [],
    progressBySubject = [],
    stats = {},
    profile = {},
  } = payload;

  const lang = profile.preferredLanguage || "en";
  const spec = TEMPLATE_SPECS[templateId] || TEMPLATE_SPECS.mixedQuiz;

  return `You are a personalized Daily AI Challenge generator for a student revision app.

Generate ONE daily challenge in strict JSON. Language: "${lang}". All text must be in that language.

CHALLENGE META:
- Date: ${date}
- Template: ${templateId} – ${spec}
- Previous template (avoid repeating): ${previousTemplateId || "none"}
- Difficulty: ${difficulty} (easy=foundational, medium=balanced, hard=challenging, mixed=varied)
- Focus subject: ${focusSubject}
- Candidate subjects (weighted): ${candidateSubjects.join(", ") || focusSubject}
- Weak concepts (prioritize): ${weakConcepts.slice(0,1200) || "none"}
- Weak topics detail: ${JSON.stringify(weakTopics.slice(0,3)).slice(0,800)}
- Recently studied lessons: ${JSON.stringify(recentLessons.slice(0,4)).slice(0,800)}
- Upcoming timetable sessions: ${JSON.stringify(upcomingSessions.slice(0,4)).slice(0,800)}
- Upcoming exams: ${JSON.stringify(examDates).slice(0,600)}
- Progress by subject: ${JSON.stringify(progressBySubject.slice(0,6)).slice(0,1000)}
- Stats: ${JSON.stringify(stats).slice(0,600)}
- Profile: grade ${profile.grade||"unknown"}, curriculum ${profile.curriculum||"unknown"}, xp ${profile.xp||0}, streak ${profile.streak||0}

PERSONALIZATION RULES:
- Challenge MUST focus on ${focusSubject} or a weak/unpracticed subject from candidates. Do NOT pick random Biology chapter if student is weak in Genetics – focus on Genetics.
- Weight: weak topics > upcoming exams > timetable priorities > long-unpracticed > recently studied (avoid recently mastered unless reinforcing).
- If weakConcepts provided, at least 50% of items must test those.
- Difficulty scaling: respect ${difficulty}. Easy=recall+single concept, Medium=link 2 concepts, Hard=analysis/application, Mixed=blend.
- Sometimes reinforce fundamentals even at high difficulty – don't always escalate.

OUTPUT JSON SCHEMA (strict, return ONLY JSON):
{
  "title": "string – engaging, includes subject (max 60 chars)",
  "description": "string – 1-2 sentences, what learner will do",
  "subject": "string – main subject, must be ${focusSubject} or close variant",
  "difficulty": "${difficulty}",
  "estimatedTime": 5-20,
  "xpReward": 20-70,
  "energyReward": 2-6,
  "challengeData": {
    "templateId": "${templateId}",
    "type": "${templateId}",
    "instructions": "string – clear learner-facing instructions",
    // Template-specific payload – choose correct shape:
    // For mixedQuiz / weakTopicRecovery / timedRecall / examSprint / multiStepReasoning / realLifeApplication / caseStudy:
    "questions": [
      {
        "id": "q1",
        "question": "2-4 sentences with context/scenario – NOT one-line recall",
        "options": ["4 options for multipleChoice, or 2 for trueFalse, omit for open"],
        "correctAnswer": "exact answer – for multipleChoice one of options, for fillBlank exact, for multiStep maybe comma list",
        "explanation": "2-3 sentences why correct, why distractors wrong",
        "context": "optional background passage (caseStudy)",
        "type": "multipleChoice|trueFalse|fillBlank|shortAnswer"
      }
    ],
    // For matchFollowing:
    "pairs": [{"left":{"id":"l1","text":"term"},"right":{"id":"r1","text":"definition"}}],
    // For explainConcept:
    "concept": "concept to explain",
    "rubric": ["key point 1","key point 2","key point 3"],
    "sampleAnswer": "model 4-6 sentence answer",
    // For diagramLabeling:
    "diagramDescription": "textual description of diagram",
    "labels": [{"id":"a","label":"...","answer":"...","options":["..."]}],
    // For caseStudy:
    "passage": "120-180 word scenario",
    // For multiStepReasoning:
    "steps": [{"step":1,"prompt":"...","hint":"..."}],
    // Common optional:
    "timeLimitSeconds": 300,
    "examTips": "string"
  }
}

CONSTRAINTS:
- Always include challengeData.templateId = "${templateId}" and challengeData.type = "${templateId}"
- estimatedTime, xpReward, energyReward must align with difficulty
- At least 3 items unless explainConcept (then rubric+sample)
- Questions must be reasoning-heavy, 2-4 sentences, not trivial
- Include rich explanation per question
- Future-compatible: extra fields allowed, but keep core
- Return ONLY JSON, no markdown fences
`;
}

async function callGemini(prompt) {
  const result = await withTimeout(
    retry(() => googleAI.models.generateContent({ model: geminiModel, contents: prompt }), { logger: log }),
    45000
  );
  const text = result.text;
  if (!text) throw new Error("Empty Gemini response");
  log.info("Gemini daily challenge raw", { length: text.length, preview: text.slice(0,600) });
  const parsed = parseJson(text);
  return parsed;
}

function validateChallenge(data, templateId, difficulty) {
  if (!data || typeof data !== "object") throw new Error("Invalid JSON");
  if (!data.title || typeof data.title !== "string") throw new Error("Missing title");
  if (!data.description || typeof data.description !== "string") throw new Error("Missing description");
  if (!data.challengeData || typeof data.challengeData !== "object") throw new Error("Missing challengeData");
  const cd = data.challengeData;
  if (cd.templateId !== templateId && cd.type !== templateId) {
    // auto-fix
    cd.templateId = templateId;
    cd.type = templateId;
  }
  // Ensure at least one content field
  const hasQuestions = Array.isArray(cd.questions) && cd.questions.length > 0;
  const hasPairs = Array.isArray(cd.pairs) && cd.pairs.length >= 2;
  const hasExplain = cd.concept && cd.rubric;
  const hasDiagram = cd.diagramDescription && cd.labels;
  const hasPassage = cd.passage;
  if (!hasQuestions && !hasPairs && !hasExplain && !hasDiagram && !hasPassage) {
    throw new Error("Challenge has no content (questions/pairs/concept)");
  }
  if (hasQuestions) {
    for (const q of cd.questions) {
      if (!q.question || !q.correctAnswer) throw new Error("Question missing fields");
      if (!q.explanation || q.explanation.length < 15) throw new Error("Question missing explanation");
    }
  }
  // Normalize rewards
  if (!data.estimatedTime) data.estimatedTime = 10;
  if (!data.xpReward) data.xpReward = difficulty === "hard" ? 60 : difficulty === "easy" ? 25 : 40;
  if (!data.energyReward) data.energyReward = difficulty === "hard" ? 5 : 3;
  if (!data.subject) data.subject = "General";
  if (!data.difficulty) data.difficulty = difficulty;
  return data;
}

function fallbackFor(templateId, difficulty, focusSubject) {
  const diffXp = difficulty === "hard" ? 60 : difficulty === "easy" ? 25 : 40;
  const diffEnergy = difficulty === "hard" ? 5 : difficulty === "easy" ? 2 : 3;
  const baseQuestions = [
    {
      id: "q1",
      type: "multipleChoice",
      question: `In ${focusSubject}, consider a core principle you recently studied. A scenario presents conflicting data. Which explanation best resolves the conflict while staying consistent with the underlying theory of ${focusSubject}? Analyze the cause-effect chain before choosing.`,
      options: ["The theory-consistent resolution that links two concepts", "A plausible distractor ignoring second concept", "A common misconception", "An unrelated factual statement"],
      correctAnswer: "The theory-consistent resolution that links two concepts",
      explanation: "Correct links two concepts; others either ignore mechanism or repeat misconception. Review how the principle applies across contexts.",
    },
    {
      id: "q2",
      type: "multipleChoice",
      question: `You are given a real-world application in ${focusSubject}. Which approach correctly applies the concept to solve the practical problem, justifying steps rather than recalling a definition?`,
      options: ["Applied solution with reasoning chain", "Definition without application", "Partial step missing justification", "Opposite approach"],
      correctAnswer: "Applied solution with reasoning chain",
      explanation: "Application requires chaining concepts; definition alone insufficient.",
    },
    {
      id: "q3",
      type: "multipleChoice",
      question: `Compare two related ideas in ${focusSubject}. Which comparison correctly distinguishes them by mechanism, not just by label?`,
      options: ["Mechanism-based distinction", "Label-only difference", "Reversed mechanism", "Unrelated comparison"],
      correctAnswer: "Mechanism-based distinction",
      explanation: "Mechanism reveals understanding beyond labels.",
    },
  ];
  if (templateId === "matchFollowing") {
    return {
      title: `Match & Link: ${focusSubject}`,
      description: `Connect terms to definitions in ${focusSubject} • ${difficulty}`,
      subject: focusSubject,
      difficulty,
      estimatedTime: 8,
      xpReward: diffXp,
      energyReward: diffEnergy,
      challengeData: {
        templateId,
        type: templateId,
        instructions: `Match each term on the left with its correct definition on the right. Focus on ${focusSubject}.`,
        pairs: [
          { left: { id: "l1", text: `${focusSubject} Concept A` }, right: { id: "r1", text: "Its precise definition and function" } },
          { left: { id: "l2", text: `${focusSubject} Concept B` }, right: { id: "r2", text: "Its mechanism and why it matters" } },
          { left: { id: "l3", text: `${focusSubject} Concept C` }, right: { id: "r3", text: "Its application condition" } },
          { left: { id: "l4", text: `${focusSubject} Concept D` }, right: { id: "r4", text: "Its contrast with related idea" } },
        ],
      },
    };
  }
  if (templateId === "explainConcept") {
    return {
      title: `Explain: ${focusSubject}`,
      description: `Articulate a key idea in ${focusSubject} clearly.`,
      subject: focusSubject,
      difficulty,
      estimatedTime: 8,
      xpReward: diffXp,
      energyReward: diffEnergy,
      challengeData: {
        templateId,
        type: templateId,
        instructions: `Explain the concept in 3-5 sentences, covering the rubric points. Self-assess against sample.`,
        concept: `A foundational concept in ${focusSubject} you recently studied`,
        rubric: ["Defines term accurately", "Explains underlying mechanism", "Gives one concrete example", "Connects to related idea"],
        sampleAnswer: `In ${focusSubject}, the concept describes how... It matters because... For example... This links to...`,
      },
    };
  }
  if (templateId === "caseStudy") {
    return {
      title: `Case Study: ${focusSubject}`,
      description: `Analyze a scenario in ${focusSubject} and answer.`,
      subject: focusSubject,
      difficulty,
      estimatedTime: 14,
      xpReward: diffXp,
      energyReward: diffEnergy,
      challengeData: {
        templateId,
        type: templateId,
        instructions: `Read the passage and answer the questions. Focus on reasoning, not recall.`,
        passage: `A detailed 150-word scenario in ${focusSubject} presents a challenge where multiple concepts interact. The learner must trace cause-effect, evaluate evidence, and choose the best explanation grounded in ${focusSubject} principles.`,
        questions: baseQuestions.slice(0, 3),
      },
    };
  }
  if (templateId === "diagramLabeling") {
    return {
      title: `Label the Diagram: ${focusSubject}`,
      description: `Identify structures in a ${focusSubject} diagram.`,
      subject: focusSubject,
      difficulty,
      estimatedTime: 10,
      xpReward: diffXp,
      energyReward: diffEnergy,
      challengeData: {
        templateId,
        type: templateId,
        instructions: `Using the diagram description, choose the correct label for each marked part.`,
        diagramDescription: `Textual diagram of a key ${focusSubject} structure with parts A-D marked. Imagine the spatial layout as described.`,
        labels: [
          { id: "A", label: "Part A", answer: `${focusSubject} Component A`, options: [`${focusSubject} Component A`, "Distractor 1", "Distractor 2", "Distractor 3"] },
          { id: "B", label: "Part B", answer: `${focusSubject} Component B`, options: ["Distractor", `${focusSubject} Component B`, "Distractor 2", "Distractor 3"] },
        ],
        questions: baseQuestions.slice(0, 2),
      },
    };
  }
  return {
    title: `Daily Challenge: ${focusSubject}`,
    description: `Personalized ${difficulty} challenge in ${focusSubject}`,
    subject: focusSubject,
    difficulty,
    estimatedTime: 10,
    xpReward: diffXp,
    energyReward: diffEnergy,
    challengeData: {
      templateId,
      type: templateId,
      instructions: `Answer the questions for ${focusSubject}. Focus on linking ideas, not memorizing.`,
      questions: baseQuestions,
    },
  };
}

export default requireAuth(async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const payload = req.body;
    if (!payload.templateId) return res.status(400).json({ error: "Missing templateId" });
    if (!payload.focusSubject) payload.focusSubject = "General";
    const templateId = payload.templateId;
    const difficulty = payload.difficulty || "medium";
    const focusSubject = payload.focusSubject;

    if (!isConfigured()) {
      log.warn("Gemini not configured, returning fallback");
      return res.status(200).json(fallbackFor(templateId, difficulty, focusSubject));
    }

    try {
      const prompt = buildPrompt(payload);
      const parsed = await callGemini(prompt);
      const validated = validateChallenge(parsed, templateId, difficulty);
      return res.status(200).json(validated);
    } catch (aiErr) {
      log.warn("Gemini generation failed, fallback", aiErr);
      // Retry once with simplified prompt
      try {
        const retryPrompt = buildPrompt({ ...payload, weakConcepts: String(payload.weakConcepts||"").slice(0,400) });
        const parsed2 = await callGemini(retryPrompt);
        const validated2 = validateChallenge(parsed2, templateId, difficulty);
        return res.status(200).json(validated2);
      } catch {
        return res.status(200).json(fallbackFor(templateId, difficulty, focusSubject));
      }
    }
  } catch (error) {
    log.error("generate-daily-challenge failed", error);
    return res.status(500).json({ error: error.message || "Failed to generate challenge" });
  }
});
