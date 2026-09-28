"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarIcon, FlaskConicalIcon, HeartPulseIcon, HomeIcon, LogOutIcon, MessageSquareIcon, SmileIcon, UserIcon } from "lucide-react";
import { PatientLayout, type LinkComponent } from "@healthcare/ui/layouts";
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
  unreadMessages,
  dental,
  signOut,
  children,
}: {
  givenName: string;
  unreadMessages: number;
  /** The clinic shares dental records and there is something to show. */
  dental: boolean;
  signOut: () => Promise<void>;
  children: React.ReactNode;
}) {
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
          <form action={signOut}>
            <Button type="submit" variant="ghost" size="sm">
              <LogOutIcon aria-hidden /> Sign out
            </Button>
          </form>
        </>
      }
    >
      {children}
    </PatientLayout>
  );
}
