import { notFound } from "next/navigation";
import { ConstructionIcon } from "lucide-react";
import { STAFF_NAVIGATION } from "@healthcare/ui/layouts";
import { PageHeader } from "@/components/page-header";

/** Placeholder for modules in the navigation that aren't built yet. */
export default async function ModulePlaceholder({ params }: { params: Promise<{ slug: string[] }> }) {
  const href = `/${(await params).slug.join("/")}`;
  const all = STAFF_NAVIGATION.flatMap((i) => [i, ...(i.children ?? [])]);
  const item = all.find((i) => i.href === href);
  if (!item) notFound();
  return (
    <>
      <PageHeader title={item.label} />
      <div className="flex flex-col items-center gap-2 p-12 text-center text-muted-foreground">
        <ConstructionIcon className="size-8" aria-hidden />
        <p>This module is part of the platform roadmap and is not built yet.</p>
      </div>
    </>
  );
}
