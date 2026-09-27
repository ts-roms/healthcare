import * as React from "react";
import type { Preview } from "@storybook/react-vite";
import { TooltipProvider } from "../src/primitives/tooltip";
import "./storybook.css";

const preview: Preview = {
  parameters: {
    layout: "padded",
    controls: { expanded: true },
    a11y: { test: "error" },
    backgrounds: { disable: true },
  },
  globalTypes: {
    theme: {
      description: "Colour scheme",
      toolbar: { title: "Theme", icon: "mirror", items: ["light", "dark"], dynamicTitle: true },
    },
  },
  initialGlobals: { theme: "light" },
  decorators: [
    (Story, ctx) => {
      const dark = ctx.globals.theme === "dark";
      document.documentElement.classList.toggle("dark", dark);
      return (
        <TooltipProvider delayDuration={200}>
          <Story />
        </TooltipProvider>
      );
    },
  ],
};

export default preview;
