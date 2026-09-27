"use client";

import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "../lib/utils";
import { DefaultLink, isActive, type LinkComponent } from "./link";

export interface PatientNavItem {
  label: string;
  href: string;
  icon: LucideIcon;
}

export interface PatientLayoutProps {
  nav: PatientNavItem[];
  pathname: string;
  brand: React.ReactNode;
  headerEnd?: React.ReactNode;
  children: React.ReactNode;
  Link?: LinkComponent;
}

/**
 * Patient portal shell. Mobile-first: single column, large touch targets,
 * bottom tab bar on phones and a top nav from `md` up. Deliberately softer and
 * roomier than the staff system.
 */
export function PatientLayout({ nav, pathname, brand, headerEnd, children, Link = DefaultLink }: PatientLayoutProps) {
  return (
    <div className="min-h-dvh bg-background pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:pb-0">
      <header className="sticky top-0 z-30 border-b bg-card/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-3xl items-center gap-4 px-4">
          {brand}
          <nav aria-label="Main" className="ml-4 hidden gap-1 md:flex">
            {nav.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                aria-current={isActive(pathname, n.href) ? "page" : undefined}
                className={cn(
                  "rounded-full px-3 py-1.5 text-body font-medium text-muted-foreground hover:bg-accent hover:text-foreground",
                  isActive(pathname, n.href) && "bg-primary-subtle text-primary",
                )}
              >
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">{headerEnd}</div>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-5 text-section">{children}</main>
      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 border-t bg-card pb-[env(safe-area-inset-bottom)] md:hidden">
        <ul className="mx-auto grid max-w-md" style={{ gridTemplateColumns: `repeat(${nav.length}, 1fr)` }}>
          {nav.map((n) => {
            const Icon = n.icon;
            const active = isActive(pathname, n.href);
            return (
              <li key={n.href}>
                <Link
                  href={n.href}
                  aria-current={active ? "page" : undefined}
                  className={cn("flex h-16 flex-col items-center justify-center gap-1 text-meta font-medium text-muted-foreground", active && "text-primary")}
                >
                  <Icon className="size-5" aria-hidden />
                  {n.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
