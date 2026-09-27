import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * tailwind-merge must know the custom type scale; otherwise `text-body`
 * is mistaken for a colour and silently drops e.g. `text-primary-foreground`.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ["meta", "table", "body", "section", "section-lg", "page", "page-lg"],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
