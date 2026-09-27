import * as React from "react";

/** Layouts are router-agnostic: apps pass next/link (or any compatible component). */
export type LinkComponent = React.ComponentType<{
  href: string;
  className?: string;
  children?: React.ReactNode;
  "aria-current"?: "page" | undefined;
  onClick?: () => void;
}>;

export const DefaultLink: LinkComponent = ({ href, children, ...props }) => (
  <a href={href} {...props}>
    {children}
  </a>
);

export function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}
