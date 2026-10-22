"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { NativeSelect } from "@healthcare/ui/primitives";
import { cn } from "@healthcare/ui/lib/utils";
import { SETTINGS_HOME, type SettingsGroup } from "@/lib/settings-navigation";

/** The current settings page: the longest address that matches the path (so `/admin/users/abc` is "Staff users"). */
function currentHref(pathname: string, groups: SettingsGroup[]): string | null {
  const hrefs = [SETTINGS_HOME, ...groups.flatMap((g) => g.pages.map((p) => p.href))];
  let best: string | null = null;
  for (const href of hrefs) {
    const hit = href === SETTINGS_HOME ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
    if (hit && (best === null || href.length > best.length)) best = href;
  }
  return best;
}

/**
 * Every settings page is drawn inside this frame: a sub-navigation of all the settings open to the user (grouped), and the
 * page beside it. On a phone the sub-navigation is a "Settings section" select above the page.
 */
export function SettingsFrame({ groups, pathname, children }: { groups: SettingsGroup[]; pathname: string; children: React.ReactNode }) {
  const router = useRouter();
  const current = currentHref(pathname, groups);
  return (
    <div className="flex flex-col lg:flex-row lg:items-start">
      <div className="border-b bg-card px-4 py-2 lg:hidden">
        <NativeSelect aria-label="Settings section" value={current ?? SETTINGS_HOME} onChange={(e) => router.push(e.target.value)}>
          <option value={SETTINGS_HOME}>Settings overview</option>
          {groups.map((group) => (
            <optgroup key={group.label} label={group.label}>
              {group.pages.map((page) => (
                <option key={page.href} value={page.href}>
                  {page.label}
                </option>
              ))}
            </optgroup>
          ))}
        </NativeSelect>
      </div>
      <nav aria-label="Settings" className="sticky top-0 hidden max-h-dvh w-56 shrink-0 self-start overflow-y-auto border-r bg-card px-3 py-4 lg:block">
        <Link
          href={SETTINGS_HOME}
          aria-current={current === SETTINGS_HOME ? "page" : undefined}
          className={cn(
            "mb-3 flex h-8 items-center rounded-md px-2 text-body font-medium outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
            current === SETTINGS_HOME && "bg-accent font-semibold text-primary-deep",
          )}
        >
          Overview
        </Link>
        {groups.map((group) => (
          <section key={group.label} aria-label={group.label} className="mb-4">
            <p className="mb-1.5 rounded-md bg-primary px-2 py-1.5 text-meta font-bold tracking-wider text-primary-foreground uppercase" aria-hidden>
              {group.label}
            </p>
            <ul className="flex flex-col gap-0.5">
              {group.pages.map((page) => {
                const active = page.href === current;
                return (
                  <li key={page.href}>
                    <Link
                      href={page.href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex h-8 items-center rounded-md px-2 text-table outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
                        active ? "bg-accent font-semibold text-primary-deep" : "text-foreground",
                      )}
                    >
                      {page.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </nav>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
