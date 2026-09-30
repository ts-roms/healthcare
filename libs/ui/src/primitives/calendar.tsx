"use client";

import * as React from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { DayPicker } from "react-day-picker";
import { cn } from "../lib/utils";

/** shadcn/ui Calendar (react-day-picker) themed with the design tokens. */
function Calendar({ className, classNames, showOutsideDays = true, ...props }: React.ComponentProps<typeof DayPicker>) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("p-0", className)}
      classNames={{
        root: "w-fit text-body",
        months: "relative flex flex-col gap-4",
        month: "flex flex-col gap-3",
        nav: "absolute inset-x-0 top-0 flex h-8 items-center justify-between",
        button_previous:
          "z-10 inline-flex size-8 items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-primary-subtle hover:text-primary-deep focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-40",
        button_next:
          "z-10 inline-flex size-8 items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-primary-subtle hover:text-primary-deep focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-40",
        month_caption: "flex h-8 items-center justify-center px-9",
        caption_label: "text-body font-semibold",
        dropdowns: "flex items-center gap-1.5",
        dropdown_root:
          "relative inline-flex items-center rounded-lg border border-input bg-card has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/40",
        dropdown: "absolute inset-0 cursor-pointer opacity-0",
        months_dropdown: "",
        years_dropdown: "",
        month_grid: "w-full border-collapse",
        weekdays: "flex",
        weekday: "w-9 py-1 text-center text-meta font-medium text-muted-foreground",
        week: "mt-1 flex w-full",
        day: "relative size-9 p-0 text-center text-table",
        day_button:
          "inline-flex size-9 items-center justify-center rounded-full outline-none hover:bg-primary-subtle focus-visible:ring-[3px] focus-visible:ring-ring/50",
        today: "[&>button]:font-bold [&>button]:text-primary",
        selected: "[&>button]:bg-primary [&>button]:font-semibold [&>button]:text-primary-foreground [&>button]:hover:bg-primary",
        outside: "[&>button]:text-muted-foreground/60",
        disabled: "[&>button]:pointer-events-none [&>button]:opacity-40",
        hidden: "invisible",
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation, className: c, ...rest }) => {
          const Icon = orientation === "left" ? ChevronLeftIcon : orientation === "right" ? ChevronRightIcon : null;
          return Icon ? <Icon className={cn("size-4", c)} {...(rest as object)} /> : <span className={cn("ml-1 text-meta", c)}>▾</span>;
        },
      }}
      {...props}
    />
  );
}

export { Calendar };
