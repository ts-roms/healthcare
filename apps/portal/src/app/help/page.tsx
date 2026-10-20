import { ArrowLeftIcon, HeartPulseIcon } from "lucide-react";
import Link from "next/link";
import { Markdown, manualSections } from "@healthcare/ui/primitives";
import { GuideSearch } from "@/components/help-search";
import { guideHref, patientGuideWithFaq } from "@/lib/guide";
import { loadGuideChapter, loadGuideFaqChapter } from "@/lib/guide-content";

export const metadata = { title: "Help" };

// Read when served, not baked in at build, so an updated guide shows without relying on the build cache.
export const dynamic = "force-dynamic";

/** The MyHealth guide from the user manual. Open to everyone, so a patient who cannot sign in can still read it. */
export default function HelpPage() {
  // The MyHealth chapter, then the manual's questions for patients.
  const guide = patientGuideWithFaq(loadGuideChapter(), loadGuideFaqChapter());
  // The guide is one page: search results link to its sections.
  const sections = manualSections([
    {
      slug: "",
      title: "How to use MyHealth",
      source: `# How to use MyHealth

${guide}`,
    },
  ]);
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-4 px-4 py-6">
      <header className="flex items-center gap-3">
        <Link href="/" className="flex items-center gap-2 text-section font-semibold">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <HeartPulseIcon className="size-4" aria-hidden />
          </span>
          MyHealth
        </Link>
        <Link href="/" className="ml-auto inline-flex items-center gap-1 text-body font-medium text-primary underline-offset-4 hover:underline">
          <ArrowLeftIcon className="size-4" aria-hidden /> Back to MyHealth
        </Link>
      </header>
      <h1 className="text-page-lg font-semibold">How to use MyHealth</h1>
      <GuideSearch sections={sections} />
      <Markdown source={guide} resolveHref={guideHref} linkComponent={Link} className="text-section" />
    </main>
  );
}
