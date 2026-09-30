"use client";

import * as React from "react";
import { ActivityIcon, MenuIcon, SearchIcon } from "lucide-react";
import type { StaffRole } from "@healthcare/domain";
import { Kbd } from "../primitives/kbd";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "../primitives/sheet";
import { TooltipProvider } from "../primitives/tooltip";
import { cn } from "../lib/utils";
import { DefaultLink, isActive, type LinkComponent } from "./link";
import { navigationForRole, STAFF_NAVIGATION, type NavItem } from "./staff-navigation";

export interface StaffLayoutProps {
  /** Filters `navigation` by role. Omit when `navigation` is already filtered (e.g. by permissions). */
  role?: StaffRole;
  pathname: string;
  children: React.ReactNode;
  /** Top-bar right side: facility selector, role switcher, user menu. */
  topbarEnd?: React.ReactNode;
  /** Global patient search submit (Enter). Focus with `/`. */
  onSearch?: (query: string) => void;
  Link?: LinkComponent;
  navigation?: NavItem[];
  productName?: string;
}

/**
 * Desktop-first staff shell: light sidebar with a filled pill for the active item
 * (role-filtered), a soft top bar with global patient search, and a full-bleed content area.
 */
export function StaffLayout({
  role,
  pathname,
  children,
  topbarEnd,
  onSearch,
  Link = DefaultLink,
  navigation,
  productName = "Healthcare Platform",
}: StaffLayoutProps) {
  const items = role ? navigationForRole(role, navigation) : (navigation ?? STAFF_NAVIGATION);
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const searchRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) && !t.isContentEditable) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const nav = <SidebarNav items={items} pathname={pathname} Link={Link} onNavigate={() => setMobileOpen(false)} />;

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-dvh overflow-hidden bg-background">
        <aside className="hidden w-60 shrink-0 flex-col bg-sidebar text-sidebar-foreground lg:flex">
          <Brand name={productName} />
          {nav}
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-14 shrink-0 items-center gap-2 px-4">
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger className="rounded-md p-1.5 hover:bg-accent lg:hidden" aria-label="Open navigation">
                <MenuIcon className="size-4" />
              </SheetTrigger>
              <SheetContent side="left" className="bg-sidebar p-0 text-sidebar-foreground">
                <SheetTitle className="sr-only">Navigation</SheetTitle>
                <Brand name={productName} />
                {nav}
              </SheetContent>
            </Sheet>
            <form
              role="search"
              className="relative w-full max-w-md"
              onSubmit={(e) => {
                e.preventDefault();
                onSearch?.(searchRef.current?.value ?? "");
              }}
            >
              <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <input
                ref={searchRef}
                type="search"
                aria-label="Search patients"
                placeholder="Search patients: name, patient no. or mobile…"
                className="h-9 w-full rounded-full border border-transparent bg-card pr-9 pl-9 text-body shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40"
              />
              <Kbd className="absolute top-1/2 right-2 -translate-y-1/2">/</Kbd>
            </form>
            <div className="ml-auto flex items-center gap-2">{topbarEnd}</div>
          </header>
          <main className="min-h-0 flex-1 overflow-auto">{children}</main>
        </div>
      </div>
    </TooltipProvider>
  );
}

function Brand({ name }: { name: string }) {
  return (
    <div className="flex h-14 shrink-0 items-center gap-2 px-4">
      <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <ActivityIcon className="size-4" aria-hidden />
      </span>
      <span className="truncate text-section font-semibold text-primary-deep">{name}</span>
    </div>
  );
}

function SidebarNav({ items, pathname, Link, onNavigate }: { items: NavItem[]; pathname: string; Link: LinkComponent; onNavigate: () => void }) {
  return (
    <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 py-2">
      <ul className="flex flex-col gap-0.5">
        {items.map((item) => {
          const Icon = item.icon;
          const active = isActive(pathname, item.href);
          const exact = item.children ? pathname === item.href : active;
          return (
            <li key={item.href}>
              <Link
                href={item.children?.[0]?.href ?? item.href}
                aria-current={exact ? "page" : undefined}
                onClick={onNavigate}
                className={cn(
                  "flex h-9 items-center gap-2.5 rounded-full px-3 text-body font-medium transition-colors outline-none hover:bg-sidebar-hover focus-visible:ring-2 focus-visible:ring-ring",
                  active && "bg-sidebar-accent text-sidebar-accent-foreground hover:bg-sidebar-accent",
                )}
              >
                {Icon ? <Icon className="size-4 shrink-0" aria-hidden /> : null}
                {item.label}
                {item.badge ? (
                  <span className="ml-auto rounded-sm border border-sidebar-border px-1 text-[10px] font-medium tracking-wide text-sidebar-muted uppercase">
                    {item.badge}
                  </span>
                ) : null}
              </Link>
              {item.children && active ? (
                <ul className="mt-0.5 ml-6 flex flex-col gap-0.5 border-l border-sidebar-border pl-2.5">
                  {item.children.map((c) => {
                    const cActive = isActive(pathname, c.href);
                    return (
                      <li key={c.href}>
                        <Link
                          href={c.href}
                          aria-current={cActive ? "page" : undefined}
                          onClick={onNavigate}
                          className={cn(
                            "flex h-7 items-center rounded-md px-2 text-table text-sidebar-muted outline-none hover:text-primary-deep focus-visible:ring-2 focus-visible:ring-ring",
                            cActive && "font-semibold text-primary-deep",
                          )}
                        >
                          {c.label}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
