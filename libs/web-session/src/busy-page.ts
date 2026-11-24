/**
 * The page a proxy answers with when the API is rate-limiting or down while it renews a session (`refreshTokens` →
 * `unavailable`): a 503 that keeps the session cookies and reloads itself, rather than signing anyone out.
 *
 * It is one self-contained document, not a Next.js page: a rewrite to a page would lose the 503 and `Retry-After`, and
 * rendering it must not depend on anything that may be failing. So it carries its own styles, which repeat the light
 * tokens of `libs/ui/src/styles/theme.css` (a test checks they still match) and the look of `ErrorState`, and inline
 * lucide icons. It has no script, so it needs no nonce: a meta refresh reloads it and a CSS bar shows the wait.
 */

/** How long the browser waits before it asks again (`Retry-After` and the meta refresh). */
export const BUSY_RETRY_SECONDS = 10;

export interface BusyPageContent {
  /** The browser tab's title. */
  title: string;
  /** The app's name and mark above the message; left out where the screen has no brand (a kiosk). */
  brand?: { name: string; icon: "activity" | "heart-pulse" };
  heading: string;
  message: string;
  /** The button that reloads the page at once. */
  retryLabel: string;
  /** A last line in small print (who to tell if it keeps happening). */
  note?: string;
  /** `large` for a touch screen read from a step away (the kiosk). */
  size?: "standard" | "large";
}

export interface BusyPage {
  body: string;
  init: { status: 503; headers: Record<string, string> };
}

/** Lucide icon paths (lucide-react 1.x), drawn with the same 24-unit box and 2-unit stroke. */
const ICON_PATHS = {
  activity: ["M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"],
  "heart-pulse": [
    "M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5",
    "M3.22 13H9.5l.5-1 2 4.5 2-7 1.5 3.5h5.27",
  ],
  "refresh-cw": ["M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8", "M21 3v5h-5", "M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16", "M8 16H3v5"],
} as const;

function icon(name: keyof typeof ICON_PATHS): string {
  const paths = ICON_PATHS[name].map((d) => `<path d="${d}"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** The light theme of `libs/ui/src/styles/theme.css` (the apps have no dark mode). */
const TOKENS = `--background:oklch(0.968 0.006 200);--foreground:oklch(0.24 0.03 225);--card:oklch(1 0 0);--muted-foreground:oklch(0.44 0.03 220);--border:oklch(0.925 0.01 200);--ring:oklch(0.56 0.09 212);--primary:oklch(0.52 0.085 212);--primary-foreground:oklch(0.99 0 0);--primary-subtle:oklch(0.945 0.028 195);--radius:0.625rem;`;

function styles(seconds: number): string {
  return `:root{color-scheme:light;${TOKENS}}
*{box-sizing:border-box}
html,body{margin:0}
body{min-height:100vh;min-height:100dvh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1.75rem;padding:2rem 1rem;background:var(--background);color:var(--foreground);font-family:"Plus Jakarta Sans",ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;font-size:.9375rem;line-height:1.375rem;-webkit-font-smoothing:antialiased}
.brand{display:flex;align-items:center;gap:.625rem;margin:0;font-size:1.125rem;line-height:1.625rem;font-weight:600;letter-spacing:-.025em}
.brand-mark{display:grid;place-items:center;width:2.25rem;height:2.25rem;border-radius:var(--radius);background:var(--primary);color:var(--primary-foreground)}
.brand-mark svg{width:1.25rem;height:1.25rem}
main{width:100%;max-width:30rem;display:flex;flex-direction:column;align-items:center;gap:.5rem;padding:2.5rem 1.5rem 2rem;text-align:center;background:var(--card);border:1px solid var(--border);border-radius:calc(var(--radius) + 6px);box-shadow:0 1px 3px color-mix(in oklab,var(--foreground) 6%,transparent)}
.tile{display:grid;place-items:center;width:3.5rem;height:3.5rem;margin-bottom:.25rem;border-radius:calc(var(--radius) + 12px);background:var(--primary-subtle);color:var(--primary)}
.tile svg{width:1.75rem;height:1.75rem;animation:spin 2.5s linear infinite}
h1{margin:0;font-size:1.125rem;line-height:1.625rem;font-weight:600}
.message{margin:0;max-width:28rem;color:var(--muted-foreground)}
.wait{width:100%;max-width:12rem;height:.25rem;margin:.75rem 0 .25rem;overflow:hidden;border-radius:999px;background:var(--primary-subtle)}
.wait span{display:block;height:100%;border-radius:inherit;background:var(--primary);transform:scaleX(0);transform-origin:left;animation:wait ${seconds}s linear forwards}
.button{display:inline-flex;align-items:center;justify-content:center;gap:.375rem;height:2rem;margin-top:.5rem;padding:0 .875rem;border-radius:999px;background:var(--primary);color:var(--primary-foreground);font-weight:500;text-decoration:none;white-space:nowrap;outline:none;box-shadow:0 1px 2px color-mix(in oklab,var(--foreground) 8%,transparent);transition:background-color .15s,box-shadow .15s}
.button:hover{background:color-mix(in oklab,var(--primary) 90%,transparent)}
.button:focus-visible{box-shadow:0 0 0 3px color-mix(in oklab,var(--ring) 50%,transparent)}
.button svg{width:1rem;height:1rem}
.note{margin:.75rem 0 0;font-size:.75rem;line-height:1rem;color:var(--muted-foreground)}
.large main{max-width:48rem;gap:1rem;padding:4rem 2.5rem 3.5rem}
.large .tile{width:7rem;height:7rem;margin-bottom:.5rem}
.large .tile svg{width:3.5rem;height:3.5rem}
.large h1{font-size:3rem;line-height:1.15}
.large .message{max-width:42rem;font-size:1.875rem;line-height:2.375rem}
.large .wait{max-width:20rem;height:.5rem;margin:1.25rem 0 .5rem}
.large .button{height:4.5rem;gap:.75rem;padding:0 2.5rem;font-size:1.5rem}
.large .button svg{width:1.75rem;height:1.75rem}
.large .note{font-size:1.25rem;line-height:1.75rem}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes wait{to{transform:scaleX(1)}}
@media (prefers-reduced-motion:reduce){.tile svg{animation:none}.wait{display:none}}`;
}

/** The busy page and the response it goes out with (503, `Retry-After`, never cached). */
export function busyPage(content: BusyPageContent, retryAfterSeconds: number = BUSY_RETRY_SECONDS): BusyPage {
  const seconds = Math.max(1, Math.round(retryAfterSeconds));
  const brand = content.brand ? `<p class="brand"><span class="brand-mark">${icon(content.brand.icon)}</span>${escapeHtml(content.brand.name)}</p>` : "";
  const note = content.note ? `<p class="note">${escapeHtml(content.note)}</p>` : "";
  const body = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="${seconds}">
<meta name="robots" content="noindex">
<title>${escapeHtml(content.title)}</title>
<style>${styles(seconds)}</style>
</head>
<body${content.size === "large" ? ' class="large"' : ""}>
${brand}
<main>
<span class="tile">${icon("refresh-cw")}</span>
<h1>${escapeHtml(content.heading)}</h1>
<p class="message">${escapeHtml(content.message)}</p>
<div class="wait" aria-hidden="true"><span></span></div>
<a class="button" href="">${icon("refresh-cw")}${escapeHtml(content.retryLabel)}</a>
${note}
</main>
</body>
</html>`;
  return {
    body,
    init: { status: 503, headers: { "content-type": "text/html; charset=utf-8", "retry-after": String(seconds), "cache-control": "no-store" } },
  };
}
