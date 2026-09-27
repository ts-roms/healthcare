"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { FlaskConicalIcon, LogOutIcon } from "lucide-react";
import { StaffLayout, type LinkComponent } from "@healthcare/ui/layouts";
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
  children: React.ReactNode;
}

export function StaffShell({ permissions, user, organizationName, facilities, facilityId, children }: StaffShellProps) {
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
          <div className="hidden text-right leading-tight lg:block">
            <p className="text-table font-medium">{user.displayName}</p>
            <p className="text-meta text-muted-foreground">{organizationName}</p>
          </div>
          <form action={signOut}>
            <Button type="submit" variant="ghost" size="icon" aria-label="Sign out" title={`Sign out ${user.email}`}>
              <LogOutIcon />
            </Button>
          </form>
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
