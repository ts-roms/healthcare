"use client";

import * as React from "react";
import { ActivityIcon, MenuIcon, PanelLeftCloseIcon, PanelLeftOpenIcon, SearchIcon, ChevronDownIcon } from "lucide-react";
import type { StaffRole } from "@healthcare/domain";
import { Kbd } from "../primitives/kbd";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "../primitives/sheet";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../primitives/tooltip";
import { cn } from "../lib/utils";
import { DefaultLink, isActive, type LinkComponent } from "./link";
import { navigationForRole, STAFF_NAVIGATION, type NavItem } from "./staff-navigation";

const SIDEBAR_STORAGE_KEY = "staff.sidebar.collapsed";
const SIDEBAR_EVENT = "staff-sidebar-change";

function readSidebarCollapsed(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === "1";
  } catch {
    return false; // storage unavailable: start expanded
  }
}

function writeSidebarCollapsed(next: boolean): void {
  try {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, next ? "1" : "0");
  } catch {
    /* per-viewer convenience only */
  }
  window.dispatchEvent(new Event(SIDEBAR_EVENT));
}

/** Changes in this tab (the toggle) and in other tabs (the storage event). */
function subscribeSidebar(onChange: () => void): () => void {
  window.addEventListener(SIDEBAR_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(SIDEBAR_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

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
 * Desktop-first staff shell: narrow dark sidebar (role-filtered), a 44px top
 * bar with global patient search, and a full-bleed content area.
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
  // Read from this browser's storage after hydration (expanded on the server and when storage is unavailable).
  const collapsed = React.useSyncExternalStore(subscribeSidebar, readSidebarCollapsed, () => false);
  const toggleCollapsed = () => writeSidebarCollapsed(!collapsed);

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
  const railNav = <SidebarNav items={items} pathname={pathname} Link={Link} onNavigate={() => undefined} collapsed={collapsed} />;

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-dvh overflow-hidden bg-background">
        <aside
          className={cn("hidden shrink-0 flex-col bg-sidebar text-sidebar-foreground transition-[width] duration-200 lg:flex", collapsed ? "w-12" : "w-56")}
        >
          <Brand name={productName} collapsed={collapsed} />
          {railNav}
          <div className="shrink-0 border-t border-sidebar-border p-2">
            <button
              type="button"
              onClick={toggleCollapsed}
              aria-expanded={!collapsed}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              className="flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-body font-medium text-sidebar-muted outline-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              {collapsed ? <PanelLeftOpenIcon className="size-4 shrink-0" aria-hidden /> : <PanelLeftCloseIcon className="size-4 shrink-0" aria-hidden />}
              {collapsed ? null : "Collapse"}
            </button>
          </div>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-11 shrink-0 items-center gap-2 border-b bg-card px-3">
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
              <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <input
                ref={searchRef}
                type="search"
                aria-label="Search patients"
                placeholder="Search patients: name, patient no. or mobile…"
                className="h-8 w-full rounded-md border border-input bg-background pr-9 pl-8 text-body outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40"
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

function Brand({ name, collapsed = false }: { name: string; collapsed?: boolean }) {
  return (
    <div className={cn("flex h-11 shrink-0 items-center gap-2 border-b border-sidebar-border px-3", collapsed && "justify-center px-0")}>
      <span className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
        <ActivityIcon className="size-3.5" aria-hidden />
      </span>
      {collapsed ? null : <span className="truncate text-body font-semibold text-sidebar-accent-foreground">{name}</span>}
    </div>
  );
}

function SidebarNav({
  items,
  pathname,
  Link,
  onNavigate,
  collapsed = false,
}: {
  items: NavItem[];
  pathname: string;
  Link: LinkComponent;
  onNavigate: () => void;
  collapsed?: boolean;
}) {
  // Accordion: one group open at a time. The group holding the current page is open by default;
  // a click on a group header overrides that (`null` = all closed) until the page changes.
  const [choice, setChoice] = React.useState<{ pathname: string; group: string | null } | null>(null);
  const openGroup = choice?.pathname === pathname ? choice.group : undefined;
  const setOpenGroup = (group: string | null) => setChoice({ pathname, group });
  return (
    <nav aria-label="Main" className="flex-1 [scrollbar-width:none] overflow-y-auto px-2 py-2 [&::-webkit-scrollbar]:hidden">
      <ul className="flex flex-col gap-0.5">
        {items.map((item) => {
          const Icon = item.icon;
          const active = isActive(pathname, item.href);
          const exact = item.children ? pathname === item.href : active;
          const expanded = openGroup === undefined ? active : openGroup === item.href;
          return (
            <li key={item.href}>
              {(() => {
                const link = (
                  <Link
                    href={item.children?.[0]?.href ?? item.href}
                    aria-current={exact ? "page" : undefined}
                    aria-label={collapsed ? item.label : undefined}
                    onClick={onNavigate}
                    className={cn(
                      "flex h-8 items-center gap-2.5 rounded-md px-2 text-body font-medium transition-colors outline-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-ring",
                      collapsed && "justify-center px-0",
                      active && "bg-sidebar-accent text-sidebar-accent-foreground",
                    )}
                  >
                    {Icon ? <Icon className="size-4 shrink-0" aria-hidden /> : null}
                    {collapsed ? null : item.label}
                    {item.badge && !collapsed ? (
                      <span className="ml-auto rounded-sm border border-sidebar-border px-1 text-[10px] font-medium tracking-wide text-sidebar-muted uppercase">
                        {item.badge}
                      </span>
                    ) : null}
                  </Link>
                );
                if (item.children && !collapsed) {
                  return (
                    <button
                      type="button"
                      aria-expanded={expanded}
                      onClick={() => setOpenGroup(expanded ? null : item.href)}
                      className={cn(
                        "flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-left text-body font-medium transition-colors outline-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-ring",
                        active && "bg-sidebar-accent text-sidebar-accent-foreground",
                      )}
                    >
                      {Icon ? <Icon className="size-4 shrink-0" aria-hidden /> : null}
                      {item.label}
                      <ChevronDownIcon
                        className={cn("ml-auto size-3.5 shrink-0 text-sidebar-muted transition-transform", !expanded && "-rotate-90")}
                        aria-hidden
                      />
                    </button>
                  );
                }
                return collapsed ? (
                  <Tooltip>
                    <TooltipTrigger asChild>{link}</TooltipTrigger>
                    <TooltipContent side="right">{item.label}</TooltipContent>
                  </Tooltip>
                ) : (
                  link
                );
              })()}
              {item.children && expanded && !collapsed ? (
                <ul className="mt-0.5 ml-[18px] flex flex-col gap-0.5 border-l border-sidebar-border pl-2.5">
                  {item.children.map((c) => {
                    const cActive = isActive(pathname, c.href);
                    return (
                      <li key={c.href}>
                        <Link
                          href={c.href}
                          aria-current={cActive ? "page" : undefined}
                          onClick={onNavigate}
                          className={cn(
                            "flex h-7 items-center rounded-md px-2 text-table text-sidebar-muted outline-none hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-ring",
                            cActive && "font-semibold text-sidebar-accent-foreground",
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
