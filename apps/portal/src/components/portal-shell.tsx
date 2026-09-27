"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BellIcon, CalendarIcon, FlaskConicalIcon, HeartPulseIcon, HomeIcon, MessageSquareIcon, UserIcon } from "lucide-react";
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

export function PortalShell({ children }: { children: React.ReactNode }) {
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
        <Button variant="ghost" size="icon" aria-label="Notifications">
          <BellIcon />
        </Button>
      }
    >
      {children}
    </PatientLayout>
  );
}
