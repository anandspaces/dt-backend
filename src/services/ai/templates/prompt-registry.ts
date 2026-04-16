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
