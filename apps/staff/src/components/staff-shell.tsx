"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { CompassIcon, FlaskConicalIcon, LogOutIcon, SettingsIcon, UserRoundIcon } from "lucide-react";
import { StaffLayout, type LinkComponent } from "@healthcare/ui/layouts";
import { setClinicTimeZone } from "@healthcare/ui/healthcare";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  NativeSelect,
  toast,
} from "@healthcare/ui/primitives";
import { selectFacility, signOut } from "@/app/(staff)/actions";
import type { StaffBadges } from "@/lib/api/types";
import { NOTICE_EVENTS } from "@/lib/live-queue";
import { moduleTabsFor } from "@/lib/module-tabs";
import { isDemoPath, navigationForPermissions, withBadgeCounts } from "@/lib/navigation";
import { TOUR_START_EVENT } from "@/lib/tour";
import { isSettingsPath, settingsForPermissions } from "@/lib/settings-navigation";
import type { ManualSection } from "@healthcare/ui/primitives";
import { GuidedTour } from "./guided-tour";
import { HelpFab, type HelpChapter } from "./help-fab";
import { NotificationBell } from "./notification-bell";
import { useLiveUpdates } from "./live-queue";
import { ModuleTabsBar } from "./module-tabs-bar";
import { OfflineBanner } from "./offline-banner";
import { SettingsFrame } from "./settings-frame";

const NextLink: LinkComponent = (props) => <Link {...props} />;

export interface StaffShellProps {
  /** Effective permissions from the API; navigation is built here because nav items carry icon components. */
  permissions: string[];
  user: { displayName: string; email: string };
  organizationName: string;
  facilities: { id: string; name: string }[];
  facilityId: string | null;
  /** The selected facility's time zone; clinical times in the page are shown in it (Asia/Manila when none). */
  timeZone: string | null;
  /** Unread in-app messages of the signed-in user. */
  unreadNotices: number;
  /** Counts for the navigation (`GET /me/badges`); refreshed every minute from `/badges`. */
  badges: StaffBadges | null;
  /** Whether the organization offers the guided tour (Settings → Guided tour); off = it never starts. */
  tourEnabled?: boolean;
  /** The user manual's chapters, for the floating help button's dialog. */
  manualChapters: HelpChapter[];
  /** Every section of the manual, for the dialog's search box. */
  manualSections?: ManualSection[];
  children: React.ReactNode;
}

const BADGES_REFRESH_MS = 60_000;

export function StaffShell({
  permissions,
  user,
  organizationName,
  facilities,
  facilityId,
  timeZone,
  unreadNotices,
  badges,
  tourEnabled = true,
  manualChapters,
  manualSections = [],
  children,
}: StaffShellProps) {
  // Set during render, before the page below renders, so every client component formats times in the facility's zone.
  setClinicTimeZone(timeZone);
  const pathname = usePathname();
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  // Polled counts replace the server-rendered ones; a new server render (navigation) resets them through the prop.
  const [polled, setPolled] = React.useState<{ from: StaffBadges | null; counts: StaffBadges | null; unread: number | null }>({
    from: badges,
    counts: null,
    unread: null,
  });
  const counts = polled.from === badges && polled.counts ? polled.counts : badges;
  // The bell's count follows the same rule: the server-rendered number until a fresher one arrives for this render.
  const unread = polled.from === badges && polled.unread !== null ? polled.unread : unreadNotices;
  const refreshCounts = React.useCallback(async () => {
    try {
      const response = await fetch("/badges", { cache: "no-store" });
      if (response.status === 200) {
        const { unreadNotices: fresh, ...rest } = (await response.json()) as StaffBadges & { unreadNotices?: number };
        setPolled({ from: badges, counts: rest, unread: typeof fresh === "number" ? fresh : null });
      }
    } catch {
      // Keep the last counts; the next tick (or notice) tries again.
    }
  }, [badges]);
  React.useEffect(() => {
    const timer = setInterval(() => void refreshCounts(), BADGES_REFRESH_MS);
    return () => clearInterval(timer);
  }, [refreshCounts]);
  // A new in-app notice reaches this browser over the realtime socket: update the bell and the counts at once (not the page).
  useLiveUpdates(NOTICE_EVENTS, () => void refreshCounts(), { refreshPage: false });
  const navigation = React.useMemo(() => withBadgeCounts(navigationForPermissions(permissions), counts), [permissions, counts]);

  // Settings: every configuration page open to the user, drawn beside a sub-navigation; a module's other pages are its tabs.
  const settingsGroups = React.useMemo(() => settingsForPermissions(permissions), [permissions]);
  const moduleTabs = moduleTabsFor(pathname, permissions, counts);
  const inSettings = isSettingsPath(pathname);
  const canOpenCompanySettings = settingsGroups.some((g) => g.pages.some((p) => p.href === "/admin/organization"));

  return (
    <StaffLayout
      pathname={pathname}
      navigation={navigation}
      Link={NextLink}
      onSearch={(q) => router.push(`/patients?q=${encodeURIComponent(q)}`)}
      // Room under every page for the floating help button (from md up), so it never sits on a form's last controls.
      contentClassName="md:pb-20"
      topbarEnd={
        <>
          {facilities.length > 0 ? (
            <NativeSelect
              aria-label="Facility"
              className="hidden md:inline-flex"
              value={facilityId ?? ""}
              disabled={pending}
              onChange={(e) => {
                const id = e.target.value;
                startTransition(async () => {
                  try {
                    await selectFacility(id);
                    router.refresh();
                  } catch {
                    toast.error("Could not switch facility.");
                  }
                });
              }}
            >
              {facilityId ? null : (
                <option value="" disabled>
                  Select facility…
                </option>
              )}
              {facilities.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </NativeSelect>
          ) : null}
          {/* On phones the help button lives here instead of floating over the page. */}
          <HelpFab chapters={manualChapters} sections={manualSections} placement="topbar" />
          <NotificationBell unread={unread} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Account menu" title={user.displayName}>
                <UserInitials name={user.displayName} className="size-7 text-meta" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuLabel className="flex items-center gap-3">
                <UserInitials name={user.displayName} className="size-10 text-section" />
                <span className="min-w-0 leading-tight">
                  <span className="block truncate text-body font-semibold">{user.displayName}</span>
                  <span className="block truncate text-meta font-normal text-muted-foreground">{user.email}</span>
                  <span className="block truncate text-meta font-normal text-muted-foreground">{organizationName}</span>
                </span>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href="/account">
                  <UserRoundIcon aria-hidden /> My account
                </Link>
              </DropdownMenuItem>
              {canOpenCompanySettings ? (
                <DropdownMenuItem asChild>
                  <Link href="/admin/organization">
                    <SettingsIcon aria-hidden /> Company settings
                  </Link>
                </DropdownMenuItem>
              ) : null}
              {tourEnabled ? (
                <DropdownMenuItem onSelect={() => window.dispatchEvent(new CustomEvent(TOUR_START_EVENT, { detail: {} }))}>
                  <CompassIcon aria-hidden /> Tour this page
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => void signOut()}>
                <LogOutIcon aria-hidden /> Log out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      }
    >
      {isDemoPath(pathname) ? <DemoDataBanner /> : null}
      <OfflineBanner />
      {moduleTabs ? <ModuleTabsBar label={moduleTabs.label} tabs={moduleTabs.tabs} pathname={pathname} /> : null}
      {inSettings ? (
        <SettingsFrame groups={settingsGroups} pathname={pathname}>
          {children}
        </SettingsFrame>
      ) : (
        children
      )}
      <HelpFab chapters={manualChapters} sections={manualSections} />
      {tourEnabled ? <GuidedTour /> : null}
    </StaffLayout>
  );
}

/** Shown on modules that still run on fixtures, so no one mistakes them for real patient data. */
function DemoDataBanner() {
  return (
    <div role="note" className="flex items-center gap-2 border-b border-warning/40 bg-warning-subtle px-4 py-1.5 text-table text-warning-foreground">
      <FlaskConicalIcon className="size-4 shrink-0" aria-hidden />
      <span>
        <strong className="font-semibold">Demo data.</strong> This module is a design preview on sample patients and is not connected to the patient record yet.
        Nothing here is saved.
      </span>
    </div>
  );
}

/** Initials on the brand colour; solid tokens so it reads in both themes (no photo is stored for staff). */
function UserInitials({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={`flex shrink-0 items-center justify-center rounded-full bg-primary font-semibold text-primary-foreground select-none ${className ?? ""}`}
    >
      {initials(name)}
    </span>
  );
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "")).toUpperCase() || "?";
}
