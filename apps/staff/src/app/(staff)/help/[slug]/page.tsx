import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { withoutTitle } from "@/lib/manual";
import { loadManual } from "@/lib/manual-content";
import { HelpShell } from "../help-shell";

function findChapter(slug: string) {
  const { chapters } = loadManual();
  const index = chapters.findIndex((c) => c.slug === slug);
  const chapter = chapters[index];
  return chapter ? { chapter, number: index + 1, chapters } : null;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const found = findChapter((await params).slug);
  return { title: found ? `${found.chapter.title} · Help` : "Help" };
}

export default async function HelpChapterPage({ params }: { params: Promise<{ slug: string }> }) {
  const found = findChapter((await params).slug);
  if (!found) notFound();
  const { chapter, number, chapters } = found;
  return (
    <>
      <PageHeader title={`${number}. ${chapter.title}`} description="User manual" />
      <HelpShell chapters={chapters} active={chapter.slug} source={withoutTitle(chapter.source)} />
    </>
  );
}
