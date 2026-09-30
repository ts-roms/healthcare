"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { BellIcon, UserRoundIcon, FlaskConicalIcon, LifeBuoyIcon, LogOutIcon } from "lucide-react";
import { SidebarPromo, StaffLayout, type LinkComponent } from "@healthcare/ui/layouts";
import { setClinicTimeZone } from "@healthcare/ui/healthcare";
import { Button, NativeSelect, toast } from "@healthcare/ui/primitives";
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
          <Link
            href="/account"
            title="My account: password and two-step verification"
            className="hidden rounded-md px-1 text-right leading-tight hover:bg-muted lg:block"
          >
            <span className="block text-table font-medium">{user.displayName}</span>
            <span className="block text-meta text-muted-foreground">{organizationName}</span>
          </Link>
          <Button asChild variant="ghost" size="icon" className="lg:hidden">
            <Link href="/account" aria-label="My account" title="My account">
              <UserRoundIcon />
            </Link>
          </Button>
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
