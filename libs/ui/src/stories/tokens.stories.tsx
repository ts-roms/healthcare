import type { Meta, StoryObj } from "@storybook/react-vite";

const meta: Meta = { title: "Foundations/Tokens" };
export default meta;

const colours = [
  ["primary", "Healthcare Blue"],
  ["teal", "Teal (secondary)"],
  ["success", "Success"],
  ["warning", "Warning"],
  ["danger", "Danger"],
  ["critical", "Critical"],
  ["info", "Info"],
  ["muted-foreground", "Neutral (slate)"],
] as const;

export const Colours: StoryObj = {
  render: () => (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {colours.map(([token, name]) => (
        <div key={token} className="overflow-hidden rounded-md border">
          <div className="h-12" style={{ background: `var(--${token})` }} />
          <div className="px-2 py-1.5">
            <p className="text-body font-medium">{name}</p>
            <p className="font-mono text-meta text-muted-foreground">--{token}</p>
          </div>
        </div>
      ))}
    </div>
  ),
};

export const TypeScale: StoryObj = {
  render: () => (
    <div className="flex flex-col gap-2">
      <p className="text-page-lg font-semibold">Page heading 24 — Patient 360</p>
      <p className="text-page font-semibold">Page heading 20 — Laboratory</p>
      <p className="text-section-lg font-semibold">Section 18 — Current encounter</p>
      <p className="text-section font-semibold">Section 16 — Clinical summary</p>
      <p className="text-body">Body 14 — 38F with HTN and T2DM. Reports good adherence to losartan and metformin.</p>
      <p className="tabular text-table">Table 13 — L-102391 · Maria Santos · CBC · 12.4 g/dL</p>
      <p className="text-meta text-muted-foreground">Meta 12 — Recorded 27 Sep 2026, 09:31 by Nurse Mercado</p>
    </div>
  ),
};
