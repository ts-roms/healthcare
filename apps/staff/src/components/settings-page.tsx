import * as React from "react";
import { SettingsPage } from "@healthcare/ui/layouts";
import { Card, Explain } from "@healthcare/ui/primitives";
import { NextLink } from "./next-link";

/**
 * A settings page in the redesign: the design system's `SettingsPage` with staff-app defaults. The breadcrumb names the Settings
 * group the page is listed under; ONE sentence describes the page, and anything longer goes in `details` ("How this works").
 */
export function StaffSettingsPage({
  group,
  title,
  description,
  details,
  detailsLabel = "How this works",
  actions,
  width,
  children,
}: {
  /** The Settings menu group, e.g. "Clinical". */
  group: string;
  title: string;
  description?: React.ReactNode;
  /** The longer explanation: paragraphs shown in a disclosure under the header. */
  details?: React.ReactNode[];
  detailsLabel?: string;
  actions?: React.ReactNode;
  width?: "wide" | "medium" | "narrow";
  children: React.ReactNode;
}) {
  return (
    <SettingsPage
      title={title}
      description={description}
      Link={NextLink}
      breadcrumbs={[{ label: "Settings", href: "/admin" }, { label: group }]}
      actions={actions}
      width={width}
      explain={
        details && details.length > 0 ? (
          <Explain summary={detailsLabel}>
            {details.map((paragraph, i) => (
              <p key={i}>{paragraph}</p>
            ))}
          </Explain>
        ) : undefined
      }
    >
      {children}
    </SettingsPage>
  );
}

/** Sections of one settings page stacked in a single card, separated by a rule (each section keeps its own padding and heading). */
export function SettingsStack({ children, className }: { children: React.ReactNode; className?: string }) {
  return <Card className={`overflow-hidden [&>*+*]:border-t ${className ?? ""}`}>{children}</Card>;
}
