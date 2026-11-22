import type { Meta, StoryObj } from "@storybook/react-vite";
import { AskAnswerCard, type AskAnswerView } from "./ask-answer";

const meta: Meta<typeof AskAnswerCard> = { title: "Healthcare/Assistant/Ask answer", component: AskAnswerCard };
export default meta;
type Story = StoryObj<typeof AskAnswerCard>;

const revenue: AskAnswerView = {
  title: "Revenue and collections",
  status: "answered",
  sentence: "₱412,300.00 was invoiced and ₱398,150.00 collected (net) at Main Clinic, 1–22 November 2026.",
  periodText: "This month · 1–22 November 2026",
  comparisonText: "the period before · 1–22 October 2026",
  scopeName: "Main Clinic",
  rows: [
    {
      label: "Invoiced (net)",
      value: "₱412,300.00",
      previous: "₱380,000.00",
      change: { text: "up ₱32,300.00 (8.5%)", direction: "up", assessment: "better" },
    },
    {
      label: "Collected (net)",
      value: "₱398,150.00",
      previous: "₱401,900.00",
      change: { text: "down ₱3,750.00 (0.9%)", direction: "down", assessment: "worse" },
    },
  ],
  notes: [],
  definition: "Net total of invoices issued in the period and still valid. Payments recorded in the period less refunds recorded in the period.",
  link: { label: "Open the management dashboard", href: "/management" },
};

export const Compared: Story = { args: { answer: revenue } };

export const Figures: Story = {
  args: {
    answer: {
      title: "Low stock",
      status: "answered",
      sentence: "2 items are low or out at Main Clinic.",
      scopeName: "Main Clinic",
      rows: [
        { label: "Gauze pad 4x4 (Main store)", value: "5 pack usable, reorder level 20" },
        { label: "Paracetamol 500 mg (Pharmacy)", value: "Out, reorder level 100" },
      ],
      notes: ["Only items with a reorder level are listed."],
      definition: "Items whose usable stock is at or below the reorder level set for them.",
      link: { label: "Open low stock", href: "/inventory?show=low" },
    },
  },
};

export const Withheld: Story = {
  args: {
    answer: {
      title: "Revenue and collections",
      status: "withheld",
      sentence: "This answer comes from figures your role cannot open (the management dashboard), so it is not shown.",
      periodText: "This month · 1–22 November 2026",
      scopeName: "Main Clinic",
      rows: [],
      notes: [],
    },
  },
};
