import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BUSY_RETRY_SECONDS, busyPage } from "./busy-page";

const content = {
  title: "Service busy",
  brand: { name: "Healthcare Platform", icon: "activity" as const },
  heading: "The patient record service is busy",
  message: "Your session is still active.",
  retryLabel: "Try again now",
  note: "If this keeps happening, tell your administrator.",
};

describe("busyPage", () => {
  it("answers 503 with Retry-After, never cached, and reloads itself after the same wait", () => {
    const page = busyPage(content);
    expect(page.init).toEqual({
      status: 503,
      headers: { "content-type": "text/html; charset=utf-8", "retry-after": String(BUSY_RETRY_SECONDS), "cache-control": "no-store" },
    });
    expect(page.body).toContain(`<meta http-equiv="refresh" content="${BUSY_RETRY_SECONDS}">`);
    expect(busyPage(content, 30).body).toContain('<meta http-equiv="refresh" content="30">');
    expect(busyPage(content, 30).body).toContain("animation:wait 30s linear forwards");
  });

  it("shows the app's words, escaped, and a button that reloads the same address", () => {
    const { body } = busyPage({ ...content, heading: 'Busy <b>&</b> "back soon"' });
    expect(body).toContain("<title>Service busy</title>");
    expect(body).toContain("<h1>Busy &#60;b&#62;&#38;&#60;/b&#62; &#34;back soon&#34;</h1>");
    expect(body).toContain("Healthcare Platform</p>");
    expect(body).toMatch(/<a class="button" href="">.*Try again now<\/a>/);
    expect(body).toContain('<p class="note">If this keeps happening, tell your administrator.</p>');
  });

  it("runs no script, so it works under any Content Security Policy without a nonce", () => {
    expect(busyPage(content).body).not.toMatch(/<script|\son\w+=/i);
  });

  it("leaves out the brand and note when not given, and has a large size for touch screens", () => {
    const { body } = busyPage({ title: "Please wait", heading: "This kiosk is reconnecting", message: "Please wait.", retryLabel: "Try again", size: "large" });
    expect(body).not.toContain('class="brand"');
    expect(body).not.toContain('class="note"');
    expect(body).toContain('<body class="large">');
  });

  it("repeats the design system's light tokens exactly", () => {
    const theme = readFileSync(new URL("../../ui/src/styles/theme.css", import.meta.url), "utf8");
    const rootAt = theme.indexOf(":root {");
    const light = theme.slice(rootAt, theme.indexOf(".dark {", rootAt));
    expect(light).toContain("--primary:");
    const copied = /:root\{color-scheme:light;([^}]*)\}/.exec(busyPage(content).body)?.[1] ?? "";
    const tokens = [...copied.matchAll(/(--[\w-]+):([^;]+);/g)].map(([, name = "", value = ""]) => ({ name, value }));
    expect(tokens.length).toBeGreaterThan(5);
    for (const { name, value } of tokens) expect(light, name).toMatch(new RegExp(`\\s${name}:\\s*${value.replace(/[().]/g, "\\$&")};`));
  });
});
