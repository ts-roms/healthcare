import * as React from "react";
import { SmartphoneIcon } from "lucide-react";
import { cn } from "../lib/utils";

export interface DownloadCode {
  key: string;
  /** "App Store", "Google Play", "MyHealth on the web". */
  label: string;
  href: string;
  /** The QR code as an SVG document, drawn on the server from `href` (never from user input). */
  svg: string;
}

/**
 * "Get the app" block: one QR code per store link, each with the link under it for people who read this on the phone
 * itself. The organization sets the links per deployment (its own store listings); until it publishes the app, the
 * code can point at MyHealth on the web instead.
 */
export function AppDownload({
  codes,
  title = "MyHealth on your phone",
  note,
  className,
}: {
  codes: DownloadCode[];
  title?: string;
  note?: React.ReactNode;
  className?: string;
}) {
  if (codes.length === 0) return null;
  return (
    <section aria-labelledby="app-download-title" className={cn("flex flex-col gap-4", className)}>
      <h2 id="app-download-title" className="flex items-center gap-2 text-section font-semibold">
        <SmartphoneIcon className="size-5 text-primary" aria-hidden /> {title}
      </h2>
      <ul className="flex flex-wrap gap-6">
        {codes.map((code) => (
          <li key={code.key} className="flex w-44 flex-col items-center gap-2 text-center">
            <a href={code.href} className="block rounded-xl border bg-white p-2 shadow-xs" aria-label={`${code.label}: ${code.href}`}>
              {/* The SVG is produced by the server from a configured URL. */}
              <span className="block size-36 [&>svg]:size-full" dangerouslySetInnerHTML={{ __html: code.svg }} />
            </a>
            <span className="text-body font-medium">{code.label}</span>
            <a href={code.href} className="text-meta break-all text-primary underline-offset-4 hover:underline">
              {code.href.replace(/^https?:\/\//, "")}
            </a>
          </li>
        ))}
      </ul>
      {note ? <p className="max-w-prose text-body text-muted-foreground">{note}</p> : null}
    </section>
  );
}
