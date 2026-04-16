import { describe, expect, test } from "bun:test";
import { verifyGeneratedHtml } from "./html-verification.js";

describe("verifyGeneratedHtml", () => {
  test("accepts minimal valid html", () => {
    const html =
      "<!DOCTYPE html><html><body><script>window.DEXTORA_COMPLETE({score:1,time:0,passed:true});</script></body></html>";
    expect(verifyGeneratedHtml(html).ok).toBe(true);
  });

  test("rejects fetch", () => {
    const html =
      "<html><body>fetch('http://x')<script>window.DEXTORA_COMPLETE({score:1,time:0,passed:true});</script></body></html>";
    expect(verifyGeneratedHtml(html).ok).toBe(false);
  });

  test("rejects missing complete", () => {
    expect(verifyGeneratedHtml("<html><body>hi</body></html>").ok).toBe(false);
  });
});
