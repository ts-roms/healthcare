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
    const [tooth, setTooth] = React.useState("36");
    const [changed, setChanged] = React.useState<Set<string>>(new Set());
    return (
      <div className="flex flex-col gap-6 xl:flex-row">
        <Odontogram chart={chart} selectedTooth={tooth} onSelectTooth={setTooth} changedTeeth={changed} className="flex-1" />
        <ToothEditor
          className="xl:w-80"
          tooth={tooth}
          state={chart[tooth]}
          onChange={(s) => {
            setChart({ ...chart, [tooth]: s });
            setChanged(new Set(changed).add(tooth));
          }}
        />
      </div>
    );
  },
};

export const UniversalNotation: StoryObj<typeof Odontogram> = { args: { chart: dentalChart, notation: "universal" } };

export const MixedDentition: StoryObj<typeof Odontogram> = {
  args: {
    dentition: "mixed",
    notation: "palmer",
    chart: {
      "54": { tooth: "54", findings: [{ condition: "caries", surfaces: ["O"] }] },
      "16": { tooth: "16", findings: [{ condition: "sealant", surfaces: ["O"] }] },
      "85": { tooth: "85", findings: [{ condition: "missing", surfaces: [] }] },
    },
  },
};

export const Empty: StoryObj<typeof Odontogram> = { args: { chart: {} } };
