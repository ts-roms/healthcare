import Link from "next/link";
import { CircleHelpIcon } from "lucide-react";
import { Button } from "@healthcare/ui/primitives";
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
      <PageHeader
        title="Help"
        description="The user manual: how to use each screen, by task and role."
        actions={
          <Button asChild size="sm" variant="outline">
            <Link href="/help/glossary-and-faq#faq">
              <CircleHelpIcon /> Frequently asked questions
            </Link>
          </Button>
        }
      />
      <HelpShell chapters={chapters} sections={manualSections(chapters)} active={null} source={withoutTitle(index)} />
    </>
  );
}
