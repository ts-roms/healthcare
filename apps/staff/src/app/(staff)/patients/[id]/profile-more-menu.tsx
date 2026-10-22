"use client";

import Link from "next/link";
import { EllipsisIcon } from "lucide-react";
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@healthcare/ui/primitives";

export interface MoreMenuItem {
  key: string;
  label: string;
  href: string;
}

/** The record's less frequent actions behind one button, so the header keeps to the ones used at the desk. */
export function ProfileMoreMenu({ items }: { items: MoreMenuItem[] }) {
  if (items.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm" aria-label="More actions for this patient">
          <EllipsisIcon /> More
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {items.map((item) => (
          <DropdownMenuItem key={item.key} asChild>
            <Link href={item.href}>{item.label}</Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
