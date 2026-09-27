"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { STAFF_ROLES, type StaffRole } from "@healthcare/domain";
import { StaffLayout, type LinkComponent } from "@healthcare/ui/layouts";
import { FacilitySelector } from "@healthcare/ui/healthcare";
import { NativeSelect } from "@healthcare/ui/primitives";
import { catalogs } from "@/lib/data";

const NextLink: LinkComponent = (props) => <Link {...props} />;

export function StaffShell({ role, children }: { role: StaffRole; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  return (
    <StaffLayout
      role={role}
      pathname={pathname}
      Link={NextLink}
      onSearch={(q) => router.push(`/patients?q=${encodeURIComponent(q)}`)}
      topbarEnd={
        <>
          <FacilitySelector facilities={catalogs.facilities} className="hidden md:inline-flex" />
          <NativeSelect
            aria-label="Demo role"
            value={role}
            onChange={(e) => {
              document.cookie = `hc-role=${e.target.value}; path=/; max-age=31536000; samesite=lax`;
              router.refresh();
            }}
          >
            {STAFF_ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </NativeSelect>
        </>
      }
    >
      {children}
    </StaffLayout>
  );
}
