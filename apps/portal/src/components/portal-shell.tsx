"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarIcon, FlaskConicalIcon, HeartPulseIcon, HomeIcon, LogOutIcon, MessageSquareIcon, UserIcon } from "lucide-react";
import { PatientLayout, type LinkComponent } from "@healthcare/ui/layouts";
import { Button } from "@healthcare/ui/primitives";

const NextLink: LinkComponent = (props) => <Link {...props} />;

const NAV = [
  { label: "Home", href: "/", icon: HomeIcon },
  { label: "Visits", href: "/appointments", icon: CalendarIcon },
  { label: "Results", href: "/results", icon: FlaskConicalIcon },
  { label: "Messages", href: "/messages", icon: MessageSquareIcon },
  { label: "Profile", href: "/profile", icon: UserIcon },
];

export function PortalShell({ givenName, signOut, children }: { givenName: string; signOut: () => Promise<void>; children: React.ReactNode }) {
  return (
    <PatientLayout
      nav={NAV}
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
