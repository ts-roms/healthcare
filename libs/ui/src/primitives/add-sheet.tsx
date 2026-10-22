"use client";

import * as React from "react";
import { PlusIcon } from "lucide-react";
import { Button } from "./button";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "./sheet";

const AddSheetContext = React.createContext<{ close: () => void } | null>(null);

/**
 * For the form inside an `AddSheet`: call `close()` when the server action succeeded (the sheet does not close itself,
 * so an error stays beside the fields that caused it).
 */
export function useAddSheet() {
  const ctx = React.useContext(AddSheetContext);
  if (!ctx) throw new Error("useAddSheet must be used inside an AddSheet");
  return ctx;
}

/**
 * The create pattern for settings and list pages: a header button opens a side sheet holding the create form, instead
 * of a form permanently open on the page. `children` is the form (a server action works as usual); focus moves into
 * the sheet and returns to the button when it closes. The core task of a screen (a consultation note, a result) stays inline instead.
 */
export function AddSheet({
  label,
  title,
  description,
  trigger,
  icon,
  variant = "default",
  open: controlledOpen,
  onOpenChange,
  children,
}: {
  /** The button's text, e.g. "Add procedure". */
  label: string;
  /** The sheet's heading; defaults to `label`. */
  title?: string;
  description?: React.ReactNode;
  /** Replaces the default button (it receives the click through `asChild`). */
  trigger?: React.ReactElement;
  icon?: React.ReactNode;
  variant?: React.ComponentProps<typeof Button>["variant"];
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
}) {
  const [innerOpen, setInnerOpen] = React.useState(false);
  const open = controlledOpen ?? innerOpen;
  const setOpen = React.useCallback(
    (next: boolean) => {
      setInnerOpen(next);
      onOpenChange?.(next);
    },
    [onOpenChange],
  );
  const ctx = React.useMemo(() => ({ close: () => setOpen(false) }), [setOpen]);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        {trigger ?? (
          <Button variant={variant}>
            {icon ?? <PlusIcon aria-hidden />} {label}
          </Button>
        )}
      </SheetTrigger>
      <SheetContent className="w-full gap-4 p-5 sm:max-w-lg">
        <div className="pr-8">
          <SheetTitle>{title ?? label}</SheetTitle>
          <SheetDescription className={description ? "mt-1" : "sr-only"}>{description ?? title ?? label}</SheetDescription>
        </div>
        <AddSheetContext.Provider value={ctx}>{children}</AddSheetContext.Provider>
      </SheetContent>
    </Sheet>
  );
}
