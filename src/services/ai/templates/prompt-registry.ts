/** Central prompt templates — no model IDs here (model comes from env). */

export function quizPromptForAtom(atomBody: string): string {
  return `You are an educational assistant. Return ONLY valid JSON with keys: question (string), choices (array of 4 strings), answerIndex (0-3 integer). Atom text:\n${atomBody}`;
}

/** Tiny single-concept HTML micro-game (drag-drop, fill-blank, match, tap-reveal). */
export function microGamePromptForAtom(atomBody: string, glossaryHint: string): string {
  return `You output ONE self-contained HTML document for a TINY vocabulary/concept micro-game.
Use full HTML5 (semantic layout, inline SVG/MathML/canvas as needed). No fetch/XHR, no external script src or CDN.
Game must focus on ONE concept or a few hard words from the paragraph.
Suitable mechanics: drag-and-drop matching, fill-in-the-blank, tap-to-reveal, or word-scramble.
Mobile-friendly; prefer concise but you may exceed 80 lines if clarity needs it.
When the learner finishes, call exactly: window.DEXTORA_COMPLETE({score:100,time:0,passed:true});
Hard words hint: ${glossaryHint}.
Paragraph:\n${atomBody.slice(0, 3000)}`;
}

/** Extract difficult/technical words from a paragraph with simple definitions. */
export function glossaryPromptForAtom(atomBody: string): string {
  return `You are a vocabulary assistant for Indian school students (CBSE-style).
Extract all difficult, technical, or domain-specific words from the paragraph below.
Return ONLY valid JSON: an array of objects [{"word":"...","meaning":"...","example":"..."}].
Keep meanings simple (1 sentence, age-appropriate). Provide a short example sentence.
If no hard words exist, return an empty array [].
Paragraph:\n${atomBody.slice(0, 4000)}`;
}

const TAG_LIST = [
  "DEFINITION",
  "FORMULA",
  "PROCESS",
  "COMPARISON",
  "EXAMPLE",
  "FACT_LIST",
  "DIAGRAM_REF",
  "EXPERIMENT",
  "THEOREM_LAW",
  "HISTORICAL",
  "INTRO_CONTEXT",
  "CONCEPT",
].join(", ");

export function classificationPromptForAtom(atomBody: string): string {
  return `You classify textbook paragraphs for an Indian school (CBSE-style) learning app.
Return ONLY JSON: {"primary":"<TAG>","tags":["<TAG>",...]}.
primary must be the single best tag. tags must include primary and up to 5 extra tags from the same list.
Allowed tags: ${TAG_LIST}.
Paragraph:\n${atomBody.slice(0, 6000)}`;
}

/** One Gemini call for many atoms — same rules as single-atom classification. */
export function classificationPromptForAtomBatch(items: { id: string; body: string }[]): string {
  const payload = items.map(({ id, body }) => ({
    id,
    paragraph: body.slice(0, 2800),
  }));
  return `You classify textbook paragraphs for an Indian school (CBSE-style) learning app.
You will receive a JSON array of objects with "id" and "paragraph". Return ONLY a JSON array of the same length and order, one object per input.
Each output object must be: {"id":"<same id as input>","primary":"<TAG>","tags":["<TAG>",...]}.
primary must be the single best tag. tags must include primary and up to 5 extra tags from the same list.
Allowed tags: ${TAG_LIST}.
Input:\n${JSON.stringify(payload)}`;
}

export function gameHtmlPromptForAtom(atomBody: string, importanceHint: string): string {
  return `You output ONE self-contained HTML document for a tiny mobile-friendly learning activity.
Use full HTML5: semantic tags (article, section, figure), inline SVG (xmlns allowed), MathML if it helps, canvas for simple drawings, flex/grid CSS, subtle animations, aria-* for accessibility.
No external network: no fetch(), no XMLHttpRequest, no external <script src= or CDN links. Inline <script> only for game logic. Inline CSS or <style> in the document.
When the learner finishes successfully, call exactly: window.DEXTORA_COMPLETE({score:100,time:0,passed:true});
Importance hint: ${importanceHint}.
Atom text to teach:\n${atomBody.slice(0, 4000)}`;
}

/** Prompt for an interactive simulation spec (variables, rules, learner controls). */
export function simulationPromptForAtom(atomBody: string, primaryTag: string): string {
  return `You design a short interactive simulation for a school learner. Return ONLY valid JSON with keys:
title (string), scenario (string), learnerControls (array of {id, label, type: "slider"|"toggle"|"select", options?}),
stateVariables (array of {name, initial, unit?}), updateRules (string describing how state changes per step or time),
learningGoal (string). Primary content tag: ${primaryTag}. Atom text:\n${atomBody.slice(0, 4000)}`;
}

/** Prompt for a short educational video script / storyboard. */
export function videoLessonPromptForAtom(atomBody: string, primaryTag: string): string {
  return `You write a concise educational video plan. Return ONLY valid JSON with keys:
title (string), durationSecondsEstimate (number), voiceoverScript (array of {segment: string, onScreen: string}),
visualNotes (string). Tone: clear, CBSE-style. Primary tag: ${primaryTag}. Atom text:\n${atomBody.slice(0, 4000)}`;
}

/**
 * Single-paragraph illustration: output ONE detailed English prompt for an image-generation model (not JSON).
 * Educational, CBSE-appropriate, inclusive; minimal readable text in-image; no watermarks or brand logos.
 */
export function illustrationImagePromptForAtom(
  atomBody: string,
  primaryTag: string,
  sectionLabel: string | null,
): string {
  const label = sectionLabel?.trim() ? `Section context: ${sectionLabel.trim()}\n` : "";
  return `You write exactly ONE detailed English prompt (plain text, not JSON) for an AI image generator.
The image must teach one key idea from a textbook paragraph for Indian school students (CBSE-style).
Style: clean educational illustration (flat vector or soft 3D textbook art), accurate science where relevant, diverse and respectful representation of students/teachers if people appear.
Constraints: minimal text on the image (short labels only if needed); no watermarks; no corporate logos; age-appropriate.
Content classification tag: ${primaryTag}.
${label}Paragraph to visualize:\n${atomBody.slice(0, 3000)}`;
}

/* ─────────────  TOPIC-LEVEL PROMPTS  ───────────── */

/** Concise topic summary synthesising all atoms. */
export function topicSummaryPrompt(topicTitle: string, atomBodies: string[]): string {
  const combined = atomBodies.map((b, i) => `[${String(i + 1)}] ${b.slice(0, 1500)}`).join("\n");
  return `You summarise a topic for Indian school students (CBSE-style). Write a clear, concise summary (150-300 words) covering all key points.
Return ONLY valid JSON: {"summary":"...","keyPoints":["..."],"hardWords":[{"word":"...","meaning":"..."}]}.
Topic: ${topicTitle}\nParagraphs:\n${combined.slice(0, 12000)}`;
}

/** Multi-question quiz spanning an entire topic. */
export function topicQuizPrompt(topicTitle: string, atomBodies: string[]): string {
  const combined = atomBodies.map((b, i) => `[${String(i + 1)}] ${b.slice(0, 1200)}`).join("\n");
  return `You create a quiz for Indian school students on the topic below. Return ONLY valid JSON:
{"title":"...","questions":[{"question":"...","choices":["A","B","C","D"],"answerIndex":0,"explanation":"..."}]}.
Generate 3-5 questions covering different paragraphs. Mix recall and application.
Topic: ${topicTitle}\nParagraphs:\n${combined.slice(0, 12000)}`;
}

/** Topic-wide interactive HTML game. */
export function topicGameHtmlPrompt(topicTitle: string, atomBodies: string[], importanceHint: string): string {
  const combined = atomBodies.map((b, i) => `[${String(i + 1)}] ${b.slice(0, 1000)}`).join("\n");
  return `You output ONE self-contained HTML document for a mobile-friendly learning game across the ENTIRE topic.
Use full HTML5: semantic structure, inline SVG/MathML/canvas, flex/grid, aria-*; no fetch/XHR, no external script src or CDN.
Suitable mechanics: multi-round quiz, sorting, timeline ordering, or categorisation.
When the learner finishes, call exactly: window.DEXTORA_COMPLETE({score:100,time:0,passed:true});
Importance: ${importanceHint}.
Topic: ${topicTitle}\nParagraphs:\n${combined.slice(0, 10000)}`;
}

/** Short-answer / written assessment for a topic. */
export function topicAssessmentPrompt(topicTitle: string, atomBodies: string[]): string {
  const combined = atomBodies.map((b, i) => `[${String(i + 1)}] ${b.slice(0, 1200)}`).join("\n");
  return `You create a short written assessment for Indian school students. Return ONLY valid JSON:
{"title":"...","questions":[{"question":"...","expectedAnswer":"...","marks":1}]}.
Generate 3-5 short-answer questions. Include expected answers.
Topic: ${topicTitle}\nParagraphs:\n${combined.slice(0, 12000)}`;
}

/* ─────────────  CHAPTER-LEVEL PROMPTS  ───────────── */

/** Chapter overview summarising all topics. */
export function chapterSummaryPrompt(chapterTitle: string, topicTitles: string[], keyAtomBodies: string[]): string {
  const topicList = topicTitles.map((t, i) => `${String(i + 1)}. ${t}`).join("\n");
  const atoms = keyAtomBodies.map((b, i) => `[${String(i + 1)}] ${b.slice(0, 800)}`).join("\n");
  return `You write a chapter summary for Indian school students (CBSE-style). Return ONLY valid JSON:
{"summary":"...","topicOverviews":[{"topic":"...","gist":"..."}],"hardWords":[{"word":"...","meaning":"..."}]}.
Keep the summary 200-400 words.
Chapter: ${chapterTitle}\nTopics:\n${topicList}\nKey paragraphs:\n${atoms.slice(0, 12000)}`;
}

/** Comprehensive mixed-format chapter test. */
export function chapterTestPrompt(chapterTitle: string, topicTitles: string[], keyAtomBodies: string[]): string {
  const topicList = topicTitles.map((t, i) => `${String(i + 1)}. ${t}`).join("\n");
  const atoms = keyAtomBodies.map((b, i) => `[${String(i + 1)}] ${b.slice(0, 800)}`).join("\n");
  return `You create a comprehensive chapter test for Indian school students. Return ONLY valid JSON:
{"title":"...","sections":[{"type":"mcq"|"short_answer"|"true_false","questions":[{"question":"...","choices"?:[...],"answerIndex"?:0,"expectedAnswer"?:"...","marks":1}]}]}.
Include at least one section of each type. 8-12 questions total. Cover all topics.
Chapter: ${chapterTitle}\nTopics:\n${topicList}\nKey paragraphs:\n${atoms.slice(0, 12000)}`;
}

/** Topic-level hero / key visual — one English image prompt (plain text). */
export function illustrationImagePromptForTopic(topicTitle: string, atomBodies: string[]): string {
  const combined = atomBodies.map((b, i) => `[${String(i + 1)}] ${b.slice(0, 1200)}`).join("\n");
  return `You write exactly ONE detailed English prompt (plain text, not JSON) for an AI image generator.
The image is a topic-level "hero" or key visual for Indian school students (CBSE), summarising: ${topicTitle}.
Style: cohesive educational illustration; may suggest a simple montage or one strong metaphor; minimal on-image text; inclusive; no watermarks or logos.
Topic paragraphs (truncated):\n${combined.slice(0, 10000)}`;
}

/** Chapter opener / cover-style illustration — one English image prompt (plain text). */
export function illustrationImagePromptForChapter(
  chapterTitle: string,
  topicTitles: string[],
  keyAtomBodies: string[],
): string {
  const topicList = topicTitles.map((t, i) => `${String(i + 1)}. ${t}`).join("\n");
  const atoms = keyAtomBodies.map((b, i) => `[${String(i + 1)}] ${b.slice(0, 800)}`).join("\n");
  return `You write exactly ONE detailed English prompt (plain text, not JSON) for an AI image generator.
The image is a chapter opener or cover visual for: ${chapterTitle}.
Use topic titles as thematic cues (not as long text blocks on the image). CBSE-appropriate, inspiring, minimal readable labels, no watermarks.
Topics:\n${topicList}\nKey excerpts:\n${atoms.slice(0, 8000)}`;
}
