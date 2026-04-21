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

  test("strict allows W3C SVG xmlns when DEXTORA_COMPLETE present", () => {
    const html = `<!DOCTYPE html><html><body>
<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>
<script>window.DEXTORA_COMPLETE({score:1,time:0,passed:true});</script></body></html>`;
    expect(verifyGeneratedHtml(html, { mode: "strict" }).ok).toBe(true);
  });

  test("strict rejects arbitrary remote https", () => {
    const html = `<html><body><a href="https://evil.example/x">x</a>
<script>window.DEXTORA_COMPLETE({score:1,time:0,passed:true});</script></body></html>`;
    expect(verifyGeneratedHtml(html, { mode: "strict" }).ok).toBe(false);
  });

  test("relaxed allows svg xmlns and canvas; still requires DEXTORA_COMPLETE", () => {
    const html = `<article><section>
<svg xmlns="http://www.w3.org/2000/svg"><circle r="1"/></svg>
<math xmlns="http://www.w3.org/1998/Math/MathML"><mi>x</mi></math>
<canvas id="c" width="20" height="20"></canvas>
<script>window.DEXTORA_COMPLETE({score:1,time:0,passed:true});</script></section></article>`;
    expect(verifyGeneratedHtml(html, { mode: "relaxed" }).ok).toBe(true);
  });

  test("relaxed rejects external script src", () => {
    const html = `<html><head><script src="https://cdn.example/lib.js"></script></head><body>
<script>window.DEXTORA_COMPLETE({score:1,time:0,passed:true});</script></body></html>`;
    expect(verifyGeneratedHtml(html, { mode: "relaxed" }).ok).toBe(false);
  });

  test("respects maxBytes", () => {
    const pad = "x".repeat(50);
    const html = `${pad}<script>window.DEXTORA_COMPLETE({score:1,time:0,passed:true});</script>`;
    expect(verifyGeneratedHtml(html, { mode: "relaxed", maxBytes: 80 }).ok).toBe(false);
  });
});
