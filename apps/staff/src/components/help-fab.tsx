"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpenIcon, LifeBuoyIcon } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@healthcare/ui/primitives";
import { chapterForPath, type ManualChapter } from "@/lib/manual";

export type HelpChapter = Pick<ManualChapter, "slug" | "title">;

/**
 * The floating help button at the bottom-right of every signed-in staff page. It opens a dialog with the manual's
 * chapters (the one about the current screen first) and a button to the full manual (`/help`, the same page as
 * **Help** in the menu). Fixed to the viewport with a 16px gutter (and the phone's safe area), below dialogs,
 * sheets and toasts (`z-30`); the content area keeps enough bottom padding that it never covers a form's last
 * buttons. Rendered by `StaffShell`, so the waiting-room display and the signed-out pages never show it.
 */
export function HelpFab({ chapters }: { chapters: HelpChapter[] }) {
  const pathname = usePathname();
  const [open, setOpen] = React.useState(false);
  const suggestedSlug = chapterForPath(pathname);
  const suggestedIndex = chapters.findIndex((c) => c.slug === suggestedSlug);
  const suggested = suggestedIndex >= 0 ? chapters[suggestedIndex] : undefined;
  const close = () => setOpen(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DialogTrigger asChild>
            <Button
              size="icon"
              aria-label="Open the user manual"
              className="fixed right-[max(1rem,env(safe-area-inset-right))] bottom-[max(1rem,env(safe-area-inset-bottom))] z-30 size-11 shadow-lg"
            >
              <LifeBuoyIcon className="size-5" aria-hidden />
            </Button>
          </DialogTrigger>
        </TooltipTrigger>
        <TooltipContent side="left">Open the user manual</TooltipContent>
      </Tooltip>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-full bg-primary-subtle text-primary" aria-hidden>
              <LifeBuoyIcon className="size-4" />
            </span>
            Need a hand?
          </DialogTitle>
          <DialogDescription>Step-by-step guides for every role, from registration to billing.</DialogDescription>
        </DialogHeader>
        {suggested ? (
          <Link
            href={`/help/${suggested.slug}`}
            onClick={close}
            className="flex items-center gap-3 rounded-lg border border-primary/30 bg-primary-subtle px-3 py-2 text-table outline-none hover:bg-primary-subtle/70 focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <BookOpenIcon className="size-4 shrink-0 text-primary" aria-hidden />
            <span className="min-w-0">
              <span className="block text-meta text-muted-foreground">About this screen</span>
              <span className="block truncate font-semibold">
                {suggestedIndex + 1}. {suggested.title}
              </span>
            </span>
          </Link>
        ) : null}
        <nav aria-label="Manual chapters" className="max-h-[45dvh] overflow-y-auto">
          <ol className="flex flex-col gap-0.5 text-table">
            {chapters.map((chapter, i) => (
              <li key={chapter.slug}>
                <Link
                  href={`/help/${chapter.slug}`}
                  onClick={close}
                  aria-current={chapter.slug === suggested?.slug ? "true" : undefined}
                  className="block rounded-md px-2 py-1 outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-[current]:font-semibold"
                >
                  <span className="mr-1 text-muted-foreground tabular-nums">{i + 1}.</span>
                  {chapter.title}
                </Link>
              </li>
            ))}
          </ol>
        </nav>
        <Button asChild className="w-full">
          <Link href="/help" onClick={close}>
            <BookOpenIcon aria-hidden /> Open the user manual
          </Link>
        </Button>
      </DialogContent>
    </Dialog>
  );
}
