"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarIcon,
  CircleHelpIcon,
  FlaskConicalIcon,
  HeartPulseIcon,
  HomeIcon,
  LogOutIcon,
  MessageSquareIcon,
  SmileIcon,
  UserIcon,
  UsersIcon,
} from "lucide-react";
import { PatientLayout, type LinkComponent } from "@healthcare/ui/layouts";
import { setClinicTimeZone } from "@healthcare/ui/healthcare";
import { Button } from "@healthcare/ui/primitives";

const NextLink: LinkComponent = (props) => <Link {...props} />;

const NAV = [
  { label: "Home", href: "/", icon: HomeIcon },
  { label: "Visits", href: "/appointments", icon: CalendarIcon },
  { label: "Results", href: "/results", icon: FlaskConicalIcon },
  { label: "Dental", href: "/dental", icon: SmileIcon },
  { label: "Messages", href: "/messages", icon: MessageSquareIcon },
  { label: "Profile", href: "/profile", icon: UserIcon },
];

export function PortalShell({
  givenName,
  timeZone,
  unreadMessages,
  dental,
  acting,
  hasDependents,
  signOut,
  children,
}: {
  givenName: string;
  /** The patient's clinic's time zone: design-system dates (e.g. the result trend chart) are shown in it. */
  timeZone: string;
  unreadMessages: number;
  /** The clinic shares dental records and there is something to show. */
  dental: boolean;
  /** Acting for another person: who, how the signed-in person is related, and whether they may only look. */
  acting: { name: string; relationship: string; viewOnly: boolean } | null;
  /** The signed-in person may act for someone else. */
  hasDependents: boolean;
  signOut: () => Promise<void>;
  children: React.ReactNode;
}) {
  // Set during render, before the page below renders (one patient per page).
  setClinicTimeZone(timeZone);
  const nav = NAV.filter((n) => dental || n.href !== "/dental").map((n) => (n.href === "/messages" ? { ...n, count: unreadMessages } : n));
  return (
    <PatientLayout
      nav={nav}
      pathname={usePathname()}
      Link={NextLink}
      brand={
        <Link href="/" className="flex items-center gap-2 text-section font-semibold">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <HeartPulseIcon className="size-4" aria-hidden />
          </span>
          MyHealth
        </Link>
      }
      headerEnd={
        <>
          <span className="hidden text-body text-muted-foreground sm:inline">{givenName}</span>
          {hasDependents || acting ? (
            <Button asChild variant="ghost" size="sm">
              <Link href="/people">
                <UsersIcon aria-hidden /> People
              </Link>
            </Button>
          ) : null}
          <Button asChild variant="ghost" size="sm">
            <Link href="/help">
              <CircleHelpIcon aria-hidden /> Help
            </Link>
          </Button>
          <form action={signOut}>
            <Button type="submit" variant="ghost" size="sm">
              <LogOutIcon aria-hidden /> Sign out
            </Button>
          </form>
        </>
      }
    >
      {acting ? (
        <div
          role="status"
          className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-warning/50 bg-warning-subtle p-3 text-body"
        >
          <span>
            <UsersIcon className="mr-1.5 inline size-4" aria-hidden />
            You are looking at <strong>{acting.name}</strong>&apos;s MyHealth as their {acting.relationship.toLowerCase()}.
            {acting.viewOnly ? " You can look but not make changes." : ""}
          </span>
          <Link href="/people/stop" className="font-medium text-primary underline">
            Back to my own MyHealth
          </Link>
        </div>
      ) : null}
      {children}
    </PatientLayout>
  );
}
