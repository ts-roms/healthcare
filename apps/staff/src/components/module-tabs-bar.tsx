"use client";

import Link from "next/link";
import { ModuleTabs, type LinkComponent, type ModuleTab } from "@healthcare/ui/layouts";

const NextLink: LinkComponent = (props) => <Link {...props} />;

/** The module's tabs, in a strip under the top bar and above the page. */
export function ModuleTabsBar({ label, tabs, pathname }: { label: string; tabs: ModuleTab[]; pathname: string }) {
  return (
    <div className="border-b bg-card px-4 pt-1">
      <ModuleTabs tabs={tabs} pathname={pathname} label={label} Link={NextLink} className="border-b-0" />
    </div>
  );
}
