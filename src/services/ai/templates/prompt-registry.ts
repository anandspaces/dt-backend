/** Central prompt templates — no model IDs here (model comes from env). */

/**
 * Returns a concise grade/audience description for injection into prompts.
 * e.g. level="Class 10" → "Class 10 CBSE students"
 *      level=undefined   → "Indian school students (CBSE-style)"
 */
function audienceHint(level?: string): string {
  if (!level?.trim()) return "Indian school students (CBSE-style)";
  const l = level.trim();
  if (/^(class|grade|std|standard)\s+\d/i.test(l)) return `${l} CBSE students`;
  return `${l} students`;
}

export type ComicCharacterSet = {
  label: string;
  characters: [string, string];
};

const CHAPTER_COMIC_CHARACTER_SETS: readonly ComicCharacterSet[] = [
  { label: "Doraemon", characters: ["Doraemon", "Nobita"] },
  { label: "TomAndJerry", characters: ["Tom", "Jerry"] },
  { label: "OggyAndCockroaches", characters: ["Oggy", "Joey"] },
  { label: "MickeyMouse", characters: ["Mickey", "Minnie"] },
];

function simpleStableHash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
  }
  return Math.abs(h >>> 0);
}

export function chapterComicCharacters(
  chapterIndex: number,
  chapterTitle: string,
): ComicCharacterSet {
  const seed = `${String(chapterIndex)}:${chapterTitle.trim().toLowerCase()}`;
  const idx = simpleStableHash(seed) % CHAPTER_COMIC_CHARACTER_SETS.length;
  return CHAPTER_COMIC_CHARACTER_SETS[idx] ?? CHAPTER_COMIC_CHARACTER_SETS[0]!;
}

export function quizPromptForAtom(atomBody: string, level?: string): string {
  return `You are an educational assistant for ${audienceHint(level)}. Return ONLY valid JSON with keys: question (string), choices (array of 4 strings), answerIndex (0-3 integer). Difficulty and vocabulary must be appropriate for ${audienceHint(level)}. Atom text:\n${atomBody}`;
}

/** Tiny single-concept HTML micro-game (drag-drop, fill-blank, match, tap-reveal). */
export function microGamePromptForAtom(atomBody: string, glossaryHint: string, level?: string): string {
  return `You output ONE self-contained HTML document for a TINY vocabulary/concept micro-game targeting ${audienceHint(level)}.
Use full HTML5 (semantic layout, inline SVG/MathML/canvas as needed). No fetch/XHR, no external script src or CDN.
Game must focus on ONE concept or a few hard words from the paragraph.
Suitable mechanics: drag-and-drop matching, fill-in-the-blank, tap-to-reveal, or word-scramble.
Mobile-friendly; prefer concise but you may exceed 80 lines if clarity needs it.
When the learner finishes, call exactly: window.DEXTORA_COMPLETE({score:100,time:0,passed:true});
Hard words hint: ${glossaryHint}.
Paragraph:\n${atomBody.slice(0, 3000)}`;
}

/** Extract difficult/technical words from a paragraph with simple definitions. */
export function glossaryPromptForAtom(atomBody: string, level?: string): string {
  return `You are a vocabulary assistant for ${audienceHint(level)}.
Extract all difficult, technical, or domain-specific words from the paragraph below.
Return ONLY valid JSON: an array of objects [{"word":"...","meaning":"...","example":"..."}].
Keep meanings simple (1 sentence, age-appropriate for ${audienceHint(level)}). Provide a short example sentence.
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

export function gameHtmlPromptForAtom(atomBody: string, importanceHint: string, level?: string): string {
  return `You output ONE self-contained HTML document for a tiny mobile-friendly learning activity designed for ${audienceHint(level)}.
Use full HTML5: semantic tags (article, section, figure), inline SVG (xmlns allowed), MathML if it helps, canvas for simple drawings, flex/grid CSS, subtle animations, aria-* for accessibility.
No external network: no fetch(), no XMLHttpRequest, no external <script src= or CDN links. Inline <script> only for game logic. Inline CSS or <style> in the document.
When the learner finishes successfully, call exactly: window.DEXTORA_COMPLETE({score:100,time:0,passed:true});
Importance hint: ${importanceHint}.
Atom text to teach:\n${atomBody.slice(0, 4000)}`;
}

/** Prompt for an interactive simulation spec (variables, rules, learner controls). */
export function simulationPromptForAtom(atomBody: string, primaryTag: string, level?: string): string {
  return `You design a short interactive simulation for ${audienceHint(level)}. Return ONLY valid JSON with keys:
title (string), scenario (string), learnerControls (array of {id, label, type: "slider"|"toggle"|"select", options?}),
stateVariables (array of {name, initial, unit?}), updateRules (string describing how state changes per step or time),
learningGoal (string). Primary content tag: ${primaryTag}. Atom text:\n${atomBody.slice(0, 4000)}`;
}

/** Prompt for a short educational video script / storyboard. */
export function videoLessonPromptForAtom(atomBody: string, primaryTag: string, level?: string): string {
  return `You write a concise educational video plan for ${audienceHint(level)}. Return ONLY valid JSON with keys:
title (string), durationSecondsEstimate (number), voiceoverScript (array of {segment: string, onScreen: string}),
visualNotes (string). Tone: clear, CBSE-style. Primary tag: ${primaryTag}. Atom text:\n${atomBody.slice(0, 4000)}`;
}

/**
 * Single-paragraph illustration: instructions for an **image-generation** model (passed to GeminiImageService).
 * Must ask for an actual image — not a meta-prompt (“write a prompt…”), or the API returns text only.
 */
export function illustrationImagePromptForAtom(
  atomBody: string,
  primaryTag: string,
  sectionLabel: string | null,
  level?: string,
): string {
  const label = sectionLabel?.trim() ? `Section context: ${sectionLabel.trim()}\n` : "";
  return `Generate ONE educational illustration image for ${audienceHint(level)}.
Visual goal: teach one clear idea from the textbook paragraph below (one focal scene or diagram-style layout).
Style: clean educational illustration — flat vector or soft 3D textbook art; accurate science where relevant; diverse and respectful representation if people appear.
Constraints: minimal readable text inside the artwork (short labels only if needed); no watermarks; no corporate logos; age-appropriate.
Content emphasis tag: ${primaryTag}.
${label}Paragraph this illustration must reflect:\n${atomBody.slice(0, 3000)}`;
}

/** Single-panel comic for one atom — direct image-generation instructions for GeminiImageService. */
export function comicImagePromptForAtom(
  atomBody: string,
  sectionLabel: string | null,
  level?: string,
): string {
  const section = sectionLabel?.trim() ? `Section: ${sectionLabel.trim()}\n` : "";
  return `Generate ONE educational comic PAGE image for ${audienceHint(level)} (single image file, not instructions for another tool).
Characters: kid-friendly cartoon versions of Doraemon and Nobita explaining the paragraph.
Goal: one mini narrative across the page (setup → explanation → takeaway); 4–6 panels; readable speech bubbles with short lines.
Style: colorful educational comic; no logos; no watermark; minimal clutter.
${section}Paragraph to explain in the comic:\n${atomBody.slice(0, 3000)}`;
}

/* ─────────────  TOPIC-LEVEL PROMPTS  ───────────── */

/** Concise topic summary synthesising all atoms. */
export function topicSummaryPrompt(topicTitle: string, atomBodies: string[], level?: string): string {
  const combined = atomBodies.map((b, i) => `[${String(i + 1)}] ${b.slice(0, 1500)}`).join("\n");
  return `You summarise a topic for ${audienceHint(level)}. Write a clear, concise summary (150-300 words) covering all key points.
Return ONLY valid JSON: {"summary":"...","keyPoints":["..."],"hardWords":[{"word":"...","meaning":"..."}]}.
Topic: ${topicTitle}\nParagraphs:\n${combined.slice(0, 12000)}`;
}

/** Multi-question quiz spanning an entire topic. */
export function topicQuizPrompt(topicTitle: string, atomBodies: string[], level?: string): string {
  const combined = atomBodies.map((b, i) => `[${String(i + 1)}] ${b.slice(0, 1200)}`).join("\n");
  return `You create a quiz for ${audienceHint(level)} on the topic below. Return ONLY valid JSON:
{"title":"...","questions":[{"question":"...","choices":["A","B","C","D"],"answerIndex":0,"explanation":"..."}]}.
Generate 3-5 questions covering different paragraphs. Mix recall and application. Difficulty appropriate for ${audienceHint(level)}.
Topic: ${topicTitle}\nParagraphs:\n${combined.slice(0, 12000)}`;
}

/** Topic-wide interactive HTML game. */
export function topicGameHtmlPrompt(topicTitle: string, atomBodies: string[], importanceHint: string, level?: string): string {
  const combined = atomBodies.map((b, i) => `[${String(i + 1)}] ${b.slice(0, 1000)}`).join("\n");
  return `You output ONE self-contained HTML document for a mobile-friendly learning game across the ENTIRE topic, designed for ${audienceHint(level)}.
Use full HTML5: semantic structure, inline SVG/MathML/canvas, flex/grid, aria-*; no fetch/XHR, no external script src or CDN.
Suitable mechanics: multi-round quiz, sorting, timeline ordering, or categorisation.
When the learner finishes, call exactly: window.DEXTORA_COMPLETE({score:100,time:0,passed:true});
Importance: ${importanceHint}.
Topic: ${topicTitle}\nParagraphs:\n${combined.slice(0, 10000)}`;
}

/** Short-answer / written assessment for a topic. */
export function topicAssessmentPrompt(topicTitle: string, atomBodies: string[], level?: string): string {
  const combined = atomBodies.map((b, i) => `[${String(i + 1)}] ${b.slice(0, 1200)}`).join("\n");
  return `You create a short written assessment for ${audienceHint(level)}. Return ONLY valid JSON:
{"title":"...","questions":[{"question":"...","expectedAnswer":"...","marks":1}]}.
Generate 3-5 short-answer questions. Include expected answers. Vocabulary and complexity suitable for ${audienceHint(level)}.
Topic: ${topicTitle}\nParagraphs:\n${combined.slice(0, 12000)}`;
}

/** Topic-level glossary of difficult terms across all atoms. */
export function topicGlossaryPrompt(topicTitle: string, atomBodies: string[], level?: string): string {
  const combined = atomBodies.map((b, i) => `[${String(i + 1)}] ${b.slice(0, 1000)}`).join("\n");
  return `You are a vocabulary assistant for ${audienceHint(level)}.
Extract all difficult, technical, or domain-specific words from the topic paragraphs below.
Return ONLY valid JSON: an array of objects [{"word":"...","meaning":"...","example":"..."}].
Keep meanings simple (1 sentence, age-appropriate). Provide a short example sentence. Deduplicate words.
Topic: ${topicTitle}\nParagraphs:\n${combined.slice(0, 10000)}`;
}

/** Topic-level micro-game (vocabulary / concept drill across the whole topic). */
export function topicMicroGamePrompt(topicTitle: string, atomBodies: string[], level?: string): string {
  const combined = atomBodies.map((b, i) => `[${String(i + 1)}] ${b.slice(0, 800)}`).join("\n");
  return `You output ONE self-contained HTML document for a TINY vocabulary/concept micro-game targeting ${audienceHint(level)}.
The game covers the ENTIRE topic (not just one paragraph): pick 4-6 key terms or facts.
Use full HTML5, no external network. Mechanics: matching, fill-in-the-blank, or word-scramble.
When the learner finishes, call exactly: window.DEXTORA_COMPLETE({score:100,time:0,passed:true});
Topic: ${topicTitle}\nParagraphs:\n${combined.slice(0, 8000)}`;
}

/** Topic-level single comic image prompt — direct image-generation instructions. */
export function comicImagePromptForTopic(topicTitle: string, atomBodies: string[], level?: string): string {
  const combined = atomBodies.map((b, i) => `[${String(i + 1)}] ${b.slice(0, 900)}`).join("\n");
  return `Generate ONE educational comic PAGE image for ${audienceHint(level)} that teaches this topic (single image file).
Characters: kid-friendly cartoon versions of Doraemon and Nobita.
Layout: 4–6 panels on one page; progression from basics to core understanding of the topic.
Topic: ${topicTitle}
Paragraphs:\n${combined.slice(0, 9000)}
Constraints: kid-friendly language in bubbles; readable text; minimal clutter; no logos or watermarks.`;
}

/* ─────────────  CHAPTER-LEVEL PROMPTS  ───────────── */

/** Chapter overview summarising all topics. */
export function chapterSummaryPrompt(chapterTitle: string, topicTitles: string[], keyAtomBodies: string[], level?: string): string {
  const topicList = topicTitles.map((t, i) => `${String(i + 1)}. ${t}`).join("\n");
  const atoms = keyAtomBodies.map((b, i) => `[${String(i + 1)}] ${b.slice(0, 800)}`).join("\n");
  return `You write a chapter summary for ${audienceHint(level)}. Return ONLY valid JSON:
{"summary":"...","topicOverviews":[{"topic":"...","gist":"..."}],"hardWords":[{"word":"...","meaning":"..."}]}.
Keep the summary 200-400 words. Appropriate for ${audienceHint(level)}.
Chapter: ${chapterTitle}\nTopics:\n${topicList}\nKey paragraphs:\n${atoms.slice(0, 12000)}`;
}

/** Comprehensive mixed-format chapter test. */
export function chapterTestPrompt(chapterTitle: string, topicTitles: string[], keyAtomBodies: string[], level?: string): string {
  const topicList = topicTitles.map((t, i) => `${String(i + 1)}. ${t}`).join("\n");
  const atoms = keyAtomBodies.map((b, i) => `[${String(i + 1)}] ${b.slice(0, 800)}`).join("\n");
  return `You create a comprehensive chapter test for ${audienceHint(level)}. Return ONLY valid JSON:
{"title":"...","sections":[{"type":"mcq"|"short_answer"|"true_false","questions":[{"question":"...","choices"?:[...],"answerIndex"?:0,"expectedAnswer"?:"...","marks":1}]}]}.
Include at least one section of each type. 8-12 questions total. Cover all topics. Appropriate difficulty for ${audienceHint(level)}.
Chapter: ${chapterTitle}\nTopics:\n${topicList}\nKey paragraphs:\n${atoms.slice(0, 12000)}`;
}

/** Chapter-wide interactive HTML game covering all topics. */
export function chapterGameHtmlPrompt(chapterTitle: string, topicTitles: string[], keyAtomBodies: string[], level?: string): string {
  const topicList = topicTitles.map((t, i) => `${String(i + 1)}. ${t}`).join("\n");
  const atoms = keyAtomBodies.map((b, i) => `[${String(i + 1)}] ${b.slice(0, 600)}`).join("\n");
  return `You output ONE self-contained HTML document for a mobile-friendly learning game covering the ENTIRE chapter, designed for ${audienceHint(level)}.
Use full HTML5: semantic structure, inline SVG/MathML/canvas, flex/grid, aria-*; no fetch/XHR, no external script src or CDN.
Span multiple topics: use timeline ordering, categorisation, multi-round quiz, or mind-map mechanics.
When the learner finishes, call exactly: window.DEXTORA_COMPLETE({score:100,time:0,passed:true});
Chapter: ${chapterTitle}\nTopics:\n${topicList}\nKey paragraphs:\n${atoms.slice(0, 8000)}`;
}

/** Chapter-level micro-game (key vocabulary / facts across the whole chapter). */
export function chapterMicroGamePrompt(chapterTitle: string, topicTitles: string[], keyAtomBodies: string[], level?: string): string {
  const topicList = topicTitles.map((t, i) => `${String(i + 1)}. ${t}`).join("\n");
  const atoms = keyAtomBodies.map((b, i) => `[${String(i + 1)}] ${b.slice(0, 500)}`).join("\n");
  return `You output ONE self-contained HTML document for a TINY vocabulary/concept micro-game targeting ${audienceHint(level)}.
Pick 5-8 key terms or facts from the entire chapter.
Use full HTML5, no external network. Mechanics: matching, fill-in-the-blank, or word-scramble.
When the learner finishes, call exactly: window.DEXTORA_COMPLETE({score:100,time:0,passed:true});
Chapter: ${chapterTitle}\nTopics:\n${topicList}\nKey excerpts:\n${atoms.slice(0, 6000)}`;
}

export type ChapterComicPagePlan = {
  pageNumber: number;
  description: string;
  visualCue: string;
};

/** Returns prompt to plan chapter comic pages as JSON. */
export function comicStoryPlanPromptForChapter(
  chapterTitle: string,
  topicTitles: string[],
  keyAtomBodies: string[],
  characters: ComicCharacterSet,
  maxPages: number,
  level?: string,
): string {
  const topics = topicTitles.map((t, i) => `${String(i + 1)}. ${t}`).join("\n");
  const excerpts = keyAtomBodies.map((b, i) => `[${String(i + 1)}] ${b.slice(0, 700)}`).join("\n");
  return `Create a chapter comic story plan for ${audienceHint(level)}.
Chapter: ${chapterTitle}
Characters fixed for all pages: ${characters.characters[0]} and ${characters.characters[1]}.
Topics:\n${topics}
Key excerpts:\n${excerpts.slice(0, 9000)}

Return ONLY JSON array with exactly ${String(maxPages)} items:
[
  {"pageNumber":1,"description":"...","visualCue":"..."}
]

Rules:
- Each item is ONE standalone comic page in a continuous chapter story.
- Keep progression from intro basics to deeper understanding and recap.
- Use age-appropriate language for ${audienceHint(level)}.
- Do not include markdown fences or extra text.`;
}

/** Returns prompt to generate one chapter comic page image — direct generation, not meta-prompt text. */
export function comicPageImagePromptForChapter(
  chapterTitle: string,
  characters: ComicCharacterSet,
  page: ChapterComicPagePlan,
  totalPages: number,
  level?: string,
): string {
  return `Generate ONE comic PAGE image — page ${String(page.pageNumber)} of ${String(totalPages)} — as a single image file.
Chapter: ${chapterTitle}
Characters (kid-friendly cartoon versions, consistent across the chapter): ${characters.characters[0]} and ${characters.characters[1]}.
Audience: ${audienceHint(level)}.
Story beat for this page: ${page.description}
Visual layout: ${page.visualCue}

Requirements:
- One portrait-format comic page; 4–6 panels maximum.
- Clear speech bubbles with short educational lines.
- Character designs match a continuous chapter story (consistent with adjacent pages conceptually).
- Visible page number ${String(page.pageNumber)} on the page.
- Kid-friendly; no logos; no watermark.`;
}

/** Topic-level hero / key visual — direct illustration generation instruction. */
export function illustrationImagePromptForTopic(topicTitle: string, atomBodies: string[], level?: string): string {
  const combined = atomBodies.map((b, i) => `[${String(i + 1)}] ${b.slice(0, 1200)}`).join("\n");
  return `Generate ONE educational illustration image: a topic-level hero or key visual for ${audienceHint(level)} summarising "${topicTitle}".
Style: cohesive illustration — montage or one strong metaphor is fine; minimal readable labels; inclusive casting if people appear; no watermarks or logos.
Topic paragraphs (truncated) to inspire the scene:\n${combined.slice(0, 10000)}`;
}

/** Chapter opener / cover-style illustration — direct image generation instruction. */
export function illustrationImagePromptForChapter(
  chapterTitle: string,
  topicTitles: string[],
  keyAtomBodies: string[],
  level?: string,
): string {
  const topicList = topicTitles.map((t, i) => `${String(i + 1)}. ${t}`).join("\n");
  const atoms = keyAtomBodies.map((b, i) => `[${String(i + 1)}] ${b.slice(0, 800)}`).join("\n");
  return `Generate ONE educational illustration image for ${audienceHint(level)}: a chapter opener or cover-style visual for "${chapterTitle}".
Use the topic titles as thematic cues only (do not plaster long sentences on the artwork). Inspiring, CBSE-appropriate, minimal short labels if needed; no watermarks or logos.
Topics:\n${topicList}\nKey excerpts:\n${atoms.slice(0, 8000)}`;
}
