import { PageHeader } from "@/components/page-header";
import { manualSections } from "@healthcare/ui/primitives";
import { withoutTitle } from "@/lib/manual";
import { loadManual } from "@/lib/manual-content";
import { HelpShell } from "./help-shell";

export const metadata = { title: "Help" };

export default function HelpPage() {
  const { index, chapters } = loadManual();
  return (
    <>
      <PageHeader title="Help" description="The user manual: how to use each screen, by task and role." />
      <HelpShell chapters={chapters} sections={manualSections(chapters)} active={null} source={withoutTitle(index)} />
    </>
  );
}
