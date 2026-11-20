import type { Meta, StoryObj } from "@storybook/react-vite";
import { AssistantPanel, type AssistantSuggestionView } from "./assistant-panel";

const meta: Meta<typeof AssistantPanel> = { title: "Healthcare/Assistant", component: AssistantPanel };
export default meta;

const stock: AssistantSuggestionView = {
  id: "inventory.days-of-cover@1:item:1",
  ruleId: "inventory.days-of-cover",
  ruleVersion: 1,
  severity: "advice",
  title: "Paracetamol 500 mg: about 9 days of stock left",
  rationale:
    "At the pace of the last 30 days (about 3.3 tablet a day), what is usable lasts less than your 14-day delivery time. Ordering 70 tablet would cover 30 days at that pace.",
  evidence: [
    { label: "Usable stock", value: "30 tablet" },
    { label: "Issued in 30 days", value: "100 tablet in 5 issues" },
  ],
  basis: "statistic",
  strength: "matched",
  action: { label: "Open purchase orders", href: "#" },
};

type Story = StoryObj<typeof AssistantPanel>;

export const Default: Story = {
  args: {
    suggestions: [
      { ...stock, id: "a", severity: "warning", title: "Gauze pad 4x4: about 2 days of stock left" },
      stock,
      { ...stock, id: "b", strength: "weak", title: "Syringe 5 ml: about 6 days of stock left" },
    ],
    dismissedCount: 1,
    onAnswer: () => undefined,
  },
};

export const Empty: Story = { args: { suggestions: [] } };

export const SomeNotAvailable: Story = { args: { suggestions: [stock], withheldCount: 1 } };
