import Link from "next/link";
import { cn } from "@healthcare/ui/lib/utils";
import { PROFILE_TABS, type ProfileTab } from "@/lib/patient-profile";

/**
 * The record's sections as links (`?tab=`), so a section can be bookmarked or shared inside the clinic and the page stays a
 * server component.
 */
export function ProfileTabs({ patientId, active }: { patientId: string; active: ProfileTab }) {
  return (
    <nav aria-label="Sections of the patient record" className="border-b">
      <ul className="-mb-px flex gap-1 overflow-x-auto">
        {PROFILE_TABS.map((tab) => {
          const isActive = tab.key === active;
          return (
            <li key={tab.key}>
              <Link
                href={tab.key === "overview" ? `/patients/${patientId}` : `/patients/${patientId}?tab=${tab.key}`}
                scroll={false}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-body font-medium whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                  isActive ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
