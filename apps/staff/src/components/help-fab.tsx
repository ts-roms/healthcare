"use client";

import Link from "next/link";
import { LifeBuoyIcon } from "lucide-react";
import { Button, Tooltip, TooltipContent, TooltipTrigger } from "@healthcare/ui/primitives";

/**
 * The floating help button at the bottom-right of every signed-in staff page: opens the user manual (`/help`, the
 * same page as **Help** in the menu). Fixed to the viewport with a 16px gutter (and the phone's safe area), below
 * dialogs, sheets and toasts (`z-30`); the content area keeps enough bottom padding that it never covers a form's
 * last buttons. Rendered by `StaffShell`, so the waiting-room display and the signed-out pages never show it.
 */
export function HelpFab() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          asChild
          size="icon"
          className="fixed right-[max(1rem,env(safe-area-inset-right))] bottom-[max(1rem,env(safe-area-inset-bottom))] z-30 size-11 shadow-lg"
        >
          <Link href="/help" aria-label="Open the user manual">
            <LifeBuoyIcon className="size-5" aria-hidden />
          </Link>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="left">Open the user manual</TooltipContent>
    </Tooltip>
  );
}
