"use client";

import * as React from "react";
import { Toaster as Sonner, toast, type ToasterProps } from "sonner";

function Toaster(props: ToasterProps) {
  return (
    <Sonner
      className="toaster group"
      richColors
      closeButton
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
        } as React.CSSProperties
      }
      {...props}
    />
  );
}

export { Toaster, toast };
