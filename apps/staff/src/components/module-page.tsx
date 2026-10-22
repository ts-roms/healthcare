import * as React from "react";
import { SettingsPage } from "@healthcare/ui/layouts";
import { Explain } from "@healthcare/ui/primitives";
import { NextLink } from "./next-link";

/**
 * A working page of a module (laboratory, inventory, billing, …) in the redesign: the plain page header, ONE sentence of
 * description (the longer explanation in `details`, "How this works"), the page's actions, and its sections below. Settings
 * pages use `StaffSettingsPage` instead (breadcrumbs into the Settings menu).
 */
export function ModulePage({
  title,
  description,
  details,
  detailsLabel = "How this works",
  actions,
  badges,
  width = "wide",
  children,
}: {
  title: string;
  description?: React.ReactNode;
  details?: React.ReactNode[];
  detailsLabel?: string;
  actions?: React.ReactNode;
  badges?: React.ReactNode;
  width?: "wide" | "medium" | "narrow";
  children: React.ReactNode;
}) {
  return (
    <SettingsPage
      title={title}
      description={description}
      Link={NextLink}
      actions={actions}
      badges={badges}
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
