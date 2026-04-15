/** Central prompt templates — no model IDs here (model comes from env). */

export function quizPromptForAtom(atomBody: string): string {
  return `You are an educational assistant. Return ONLY valid JSON with keys: question (string), choices (array of 4 strings), answerIndex (0-3 integer). Atom text:\n${atomBody}`;
}

export function gamePromptForAtom(atomBody: string, difficulty: string): string {
  return `Design a short learning game idea as JSON keys: title, rules (string), difficulty (string). Difficulty hint: ${difficulty}. Atom:\n${atomBody}`;
}
