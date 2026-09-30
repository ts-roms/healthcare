import * as React from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { LinkComponent } from "../layouts/link";
import { DefaultLink } from "../layouts/link";
import { cn } from "../lib/utils";

/** GitHub-style heading anchor, so `file.md#how-to-enter-results` links keep working when rendered in an app. */
export function headingSlug(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s/g, "-");
}

function textOf(node: React.ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) return textOf(node.props.children);
  return "";
}

export interface MarkdownProps {
  /** Trusted Markdown from the repository (raw HTML in it is not rendered). */
  source: string;
  /** Maps a link target to an app path, or `null` to show the link text without a link. Defaults to keeping it. */
  resolveHref?: (href: string) => string | null;
  /** Router link (e.g. next/link) for in-app paths. */
  linkComponent?: LinkComponent;
  className?: string;
}

/** Reading view for long-form documentation (tables, lists, code, anchored headings) in the design system's type scale. */
export function Markdown({ source, resolveHref = (href) => href, linkComponent: Link = DefaultLink, className }: MarkdownProps) {
  const heading =
    (Tag: "h1" | "h2" | "h3" | "h4", size: string) =>
    ({ children }: { children?: React.ReactNode }) => (
      <Tag id={headingSlug(textOf(children))} className={cn("scroll-mt-20 font-semibold text-foreground", size)}>
        {children}
      </Tag>
    );

  const components: Components = {
    h1: heading("h1", "mb-3 text-page-lg"),
    h2: heading("h2", "mt-8 mb-2 border-b pb-1 text-page"),
    h3: heading("h3", "mt-6 mb-2 text-section-lg"),
    h4: heading("h4", "mt-4 mb-1 text-section"),
    p: ({ children }) => <p className="my-2 leading-relaxed">{children}</p>,
    ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-6">{children}</ul>,
    ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-6">{children}</ol>,
    li: ({ children }) => <li className="leading-relaxed">{children}</li>,
    blockquote: ({ children }) => <blockquote className="my-3 border-l-4 border-primary/40 bg-muted/50 px-4 py-1">{children}</blockquote>,
    hr: () => <hr className="my-6" />,
    a: ({ href = "", children }) => {
      const target = resolveHref(href);
      if (target === null) return children;
      if (/^https?:/.test(target)) {
        return (
          <a href={target} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2">
            {children}
          </a>
        );
      }
      return (
        <Link href={target} className="text-primary underline underline-offset-2">
          {children}
        </Link>
      );
    },
    code: ({ className: lang, children }) =>
      lang ? <code className={lang}>{children}</code> : <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">{children}</code>,
    pre: ({ children }) => <pre className="my-3 overflow-x-auto rounded-md bg-muted p-3 font-mono text-table">{children}</pre>,
    table: ({ children }) => (
      <div className="my-3 w-full overflow-x-auto rounded-md border">
        <table className="w-full text-table">{children}</table>
      </div>
    ),
    thead: ({ children }) => <thead className="bg-muted">{children}</thead>,
    tr: ({ children }) => <tr className="border-b last:border-0">{children}</tr>,
    th: ({ children }) => <th className="px-2 py-1.5 text-left align-top font-semibold">{children}</th>,
    td: ({ children }) => <td className="px-2 py-1.5 align-top">{children}</td>,
  };

  return (
    <div className={cn("max-w-none text-body text-foreground", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {source}
      </ReactMarkdown>
    </div>
  );
}
