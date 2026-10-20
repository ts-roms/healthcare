"use client";

import Link from "next/link";
import { HelpSearch } from "@healthcare/ui/healthcare";
import type { ManualSection } from "@healthcare/ui/primitives";

/** The guide's search box with Next's router link (a client boundary: the server page passes only the section data). */
export function GuideSearch({ sections }: { sections: ManualSection[] }) {
  return <HelpSearch sections={sections} linkComponent={Link} placeholder="Search this guide…" />;
}
