"use client";

import Link from "next/link";
import { HelpSearch } from "@healthcare/ui/healthcare";
import type { ManualSection } from "@healthcare/ui/primitives";

/** The manual search box with Next's router link (a client boundary: server pages pass only the section data). */
export function StaffHelpSearch({ sections, className, onNavigate }: { sections: ManualSection[]; className?: string; onNavigate?: () => void }) {
  return <HelpSearch sections={sections} linkComponent={Link} className={className} onNavigate={onNavigate} />;
}
