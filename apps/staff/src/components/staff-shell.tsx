"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { BellIcon, FlaskConicalIcon, LifeBuoyIcon, LogOutIcon, SettingsIcon, UserRoundIcon } from "lucide-react";
import { SidebarPromo, StaffLayout, type LinkComponent } from "@healthcare/ui/layouts";
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
import { isDemoPath, navigationForPermissions } from "@/lib/navigation";

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
  children: React.ReactNode;
}

export function StaffShell({ permissions, user, organizationName, facilities, facilityId, timeZone, unreadNotices, children }: StaffShellProps) {
  // Set during render, before the page below renders, so every client component formats times in the facility's zone.
  setClinicTimeZone(timeZone);
  const pathname = usePathname();
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const navigation = React.useMemo(() => navigationForPermissions(permissions), [permissions]);

  // Company settings are the administration pages; staff without access to any of them only see their own account.
  const canOpenCompanySettings = navigation.some((item) => item.href === "/admin" && item.children?.some((c) => c.href === "/admin/organization"));

  return (
    <StaffLayout
      pathname={pathname}
      navigation={navigation}
      Link={NextLink}
      onSearch={(q) => router.push(`/patients?q=${encodeURIComponent(q)}`)}
      sidebarFooter={
        <>
          <SidebarPromo
            icon={LifeBuoyIcon}
            title="Need a hand?"
            description="Step-by-step guides for every role, from registration to billing."
            action={
              <Button asChild size="sm" className="w-full">
                <Link href="/help">Open the user manual</Link>
              </Button>
            }
          />
          <form action={signOut}>
            <Button type="submit" variant="ghost" className="w-full justify-start rounded-full px-3 text-sidebar-foreground" title={`Sign out ${user.email}`}>
              <LogOutIcon /> Sign out
            </Button>
          </form>
        </>
      }
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
          <Button asChild variant="ghost" size="icon" className="relative">
            <Link
              href="/notifications"
              aria-label={unreadNotices ? `Notifications, ${unreadNotices} unread` : "Notifications"}
              title={unreadNotices ? `${unreadNotices} unread` : "Notifications"}
            >
              <BellIcon />
              {unreadNotices ? (
                <span className="absolute -top-0.5 -right-0.5 min-w-4 rounded-full bg-primary px-1 text-center text-[10px] leading-4 font-semibold text-primary-foreground tabular-nums">
                  {unreadNotices > 99 ? "99+" : unreadNotices}
                </span>
              ) : null}
            </Link>
          </Button>
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
      {children}
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
