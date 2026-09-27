import * as React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { DentalChart } from "@healthcare/domain";
import { dentalChart } from "@healthcare/domain/fixtures";
import { Odontogram, ToothEditor } from "./odontogram";

const meta: Meta<typeof Odontogram> = { title: "Healthcare/Odontogram", component: Odontogram };
export default meta;

export const Interactive: StoryObj = {
  render: function Render() {
    const [chart, setChart] = React.useState<DentalChart>(dentalChart);
    const [tooth, setTooth] = React.useState(36);
    return (
      <div className="flex flex-col gap-6 xl:flex-row">
        <Odontogram chart={chart} selectedTooth={tooth} onSelectTooth={setTooth} className="flex-1" />
        <ToothEditor className="xl:w-80" tooth={tooth} record={chart[tooth]} onChange={(r) => setChart({ ...chart, [tooth]: r })} />
      </div>
    );
  },
};

export const Empty: StoryObj<typeof Odontogram> = { args: { chart: {} } };
