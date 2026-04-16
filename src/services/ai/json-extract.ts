/** Strip markdown code fences from model output before JSON.parse. */
export function extractJsonFromModelText(text: string): string {
  const t = text.trim();
  if (t.startsWith("```")) {
    const without = t.replace(/^```[a-zA-Z]*\n?/, "").replace(/```$/, "");
    return without.trim();
  }
  return t;
}
