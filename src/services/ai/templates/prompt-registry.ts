/** Central prompt templates — no model IDs here (model comes from env). */

export function quizPromptForAtom(atomBody: string): string {
  return `You are an educational assistant. Return ONLY valid JSON with keys: question (string), choices (array of 4 strings), answerIndex (0-3 integer). Atom text:\n${atomBody}`;
}

export function gamePromptForAtom(atomBody: string, difficulty: string): string {
  return `Design a short learning game idea as JSON keys: title, rules (string), difficulty (string). Difficulty hint: ${difficulty}. Atom:\n${atomBody}`;
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

export function gameHtmlPromptForAtom(atomBody: string, importanceHint: string): string {
  return `You output ONE self-contained HTML document (no external URLs, no CDN, no fetch/XHR) for a tiny mobile-friendly learning activity.
Use inline SVG or CSS only. One simple mechanic only (tap-to-reveal OR multiple choice buttons).
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
