"use client";

import * as React from "react";
import { ActivityIcon, MenuIcon, PanelLeftCloseIcon, PanelLeftOpenIcon, SearchIcon, ChevronDownIcon } from "lucide-react";
import type { StaffRole } from "@healthcare/domain";
import { Kbd } from "../primitives/kbd";
import { Popover, PopoverContent, PopoverTrigger } from "../primitives/popover";
import { Sheet,SheetContent, SheetTitle, SheetTrigger } from "../primitives/sheet";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../primitives/tooltip";
import { cn } from "../lib/utils";
import { DefaultLink, isActive, type LinkComponent } from "./link";
import { navigationForRole, STAFF_NAVIGATION, type NavItem } from "./staff-navigation";

const SIDEBAR_STORAGE_KEY = "staff.sidebar.collapsed";

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
  /** Bottom of the sidebar (and mobile menu): a help card, sign-out. */
  sidebarFooter?: React.ReactNode;
}

/**
 * Desktop-first staff shell: light sidebar with a filled pill for the active item
 * (role-filtered), a soft top bar with global patient search, and a full-bleed content area.
 */
/** The sidebar's collapsed state: per viewer, in local storage when available (else for this page load only). */
const SIDEBAR_EVENT = "healthcare:sidebar";
let sidebarInMemory = false;

function readSidebarCollapsed(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === "1";
  } catch {
    return sidebarInMemory;
  }
}

function writeSidebarCollapsed(next: boolean): void {
  sidebarInMemory = next;
  try {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, next ? "1" : "0");
  } catch {
    /* per-viewer convenience only */
  }
  window.dispatchEvent(new Event(SIDEBAR_EVENT));
}

function subscribeSidebar(onChange: () => void): () => void {
  window.addEventListener(SIDEBAR_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(SIDEBAR_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function StaffLayout({
  role,
  pathname,
  children,
  topbarEnd,
  onSearch,
  Link = DefaultLink,
  navigation,
  productName = "Healthcare Platform",
  sidebarFooter,
}: StaffLayoutProps) {
  const items = role ? navigationForRole(role, navigation) : (navigation ?? STAFF_NAVIGATION);
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const searchRef = React.useRef<HTMLInputElement>(null);
  // Expanded on the server and on first paint; the viewer's choice is read from storage after hydration.
  const collapsed = React.useSyncExternalStore(subscribeSidebar, readSidebarCollapsed, () => false);
  const toggleCollapsed = () => writeSidebarCollapsed(!readSidebarCollapsed());

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
          className={cn(
            "hidden shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200 lg:flex",
            collapsed ? "w-14" : "w-60",
          )}
        >
          <Brand name={productName} collapsed={collapsed} />
          {railNav}
          {sidebarFooter && !collapsed ? <div className="flex shrink-0 flex-col gap-2 p-3">{sidebarFooter}</div> : null}
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
          <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-card px-4">
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger className="rounded-md p-1.5 hover:bg-accent lg:hidden" aria-label="Open navigation">
                <MenuIcon className="size-4" />
              </SheetTrigger>
              <SheetContent side="left" className="flex flex-col border-r border-sidebar-border bg-sidebar p-0 text-sidebar-foreground">
                <SheetTitle className="sr-only">Navigation</SheetTitle>
                <Brand name={productName} />
                {nav}
                {sidebarFooter ? <div className="flex shrink-0 flex-col gap-2 p-3">{sidebarFooter}</div> : null}
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
                className="h-9 w-full rounded-full border border-transparent bg-muted pr-9 pl-9 text-body outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40"
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
    <div className={cn("flex h-14 shrink-0 items-center gap-2 px-4", collapsed && "justify-center px-0")}>
      <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <ActivityIcon className="size-4" aria-hidden />
      </span>
      {collapsed ? null : <span className="truncate text-section font-semibold text-primary-deep">{name}</span>}
    </div>
  );
}

/** A group in the collapsed rail: its icon opens a pop-out beside the rail listing the sub-pages. */
function CollapsedGroup({
  item,
  pathname,
  Link,
  active,
  onNavigate,
}: {
  item: NavItem;
  pathname: string;
  Link: LinkComponent;
  active: boolean;
  onNavigate: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const Icon = item.icon;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={item.label}
          aria-haspopup="menu"
          className={cn(
            "flex h-9 w-full items-center justify-center rounded-full text-body font-medium transition-colors outline-none hover:bg-sidebar-hover focus-visible:ring-2 focus-visible:ring-ring",
            active && "bg-sidebar-accent text-sidebar-accent-foreground hover:bg-sidebar-accent",
          )}
        >
          {Icon ? <Icon className="size-4 shrink-0" aria-hidden /> : null}
        </button>
      </PopoverTrigger>
      <PopoverContent side="right" align="start" sideOffset={12} className="w-52 p-1.5">
        <p className="px-2 py-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{item.label}</p>
        <ul className="flex flex-col gap-0.5">
          {item.children?.map((c) => {
            const cActive = isActive(pathname, c.href);
            return (
              <li key={c.href}>
                <Link
                  href={c.href}
                  aria-current={cActive ? "page" : undefined}
                  onClick={() => {
                    setOpen(false);
                    onNavigate();
                  }}
                  className={cn(
                    "flex h-8 items-center rounded-md px-2 text-table outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
                    cActive && "bg-accent font-semibold text-primary-deep",
                  )}
                >
                  {c.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
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
  const [openGroup, setOpenGroup] = React.useState<string | null | undefined>(undefined);
  const [openedOn, setOpenedOn] = React.useState(pathname);
  if (openedOn !== pathname) {
    // A new page: back to the default (reset during render, not in an effect).
    setOpenedOn(pathname);
    setOpenGroup(undefined);
  }
  return (
    <nav aria-label="Main" className="flex-1 [scrollbar-width:none] overflow-y-auto px-3 py-2 [&::-webkit-scrollbar]:hidden">
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
                      "flex h-9 items-center gap-2.5 rounded-full px-3 text-body font-medium transition-colors outline-none hover:bg-sidebar-hover focus-visible:ring-2 focus-visible:ring-ring",
                      collapsed && "justify-center px-0",
                      active && "bg-sidebar-accent text-sidebar-accent-foreground hover:bg-sidebar-accent",
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
                        "flex h-9 w-full items-center gap-2.5 rounded-full px-3 text-left text-body font-medium transition-colors outline-none hover:bg-sidebar-hover focus-visible:ring-2 focus-visible:ring-ring",
                        active && "bg-sidebar-accent text-sidebar-accent-foreground hover:bg-sidebar-accent",
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
                if (item.children && collapsed) {
                  return <CollapsedGroup item={item} pathname={pathname} Link={Link} active={active} onNavigate={onNavigate} />;
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
