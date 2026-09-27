import * as React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { cbcOrder, hba1cTrend, labWorklist } from "@healthcare/domain/fixtures";
import { LabResult } from "./lab-result";
import { LabResultTable } from "./lab-result-table";
import { LabTrendChart } from "./lab-trend-chart";
import { LabWorklist } from "./lab-worklist";
import { SpecimenStatus } from "./specimen-status";
import { LabFlagBadge, labFlagSpec } from "./status";

const meta: Meta = { title: "Healthcare/Laboratory" };
export default meta;

export const Worklist: StoryObj = {
  render: function Render() {
    const [selected, setSelected] = React.useState(cbcOrder.id);
    return <LabWorklist orders={labWorklist} selectedId={selected} onSelect={(o) => setSelected(o.id)} />;
  },
};

export const ResultEntry: StoryObj = {
  render: function Render() {
    const [obs, setObs] = React.useState(cbcOrder.observations);
    return (
      <div className="flex max-w-xl flex-col gap-2">
        {cbcOrder.specimen ? <SpecimenStatus specimen={cbcOrder.specimen} /> : null}
        <p className="text-meta text-muted-foreground">Values auto-flag against range. Enter moves down.</p>
        <LabResultTable observations={obs} onChange={setObs} />
      </div>
    );
  },
};

export const ReadOnlyResults: StoryObj = { render: () => <LabResultTable observations={labWorklist[3]!.observations} className="max-w-xl" /> };

export const SingleResult: StoryObj = {
  render: () => (
    <div className="flex flex-col gap-2">
      <LabResult observation={{ id: "1", code: "4548-4", name: "HbA1c", value: 7.1, unit: "%", referenceHigh: 5.7, referenceText: "< 5.7", flag: "high" }} />
      <LabResult observation={labWorklist[4]!.observations[0]!} />
    </div>
  ),
};

export const Flags: StoryObj = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      {(Object.keys(labFlagSpec) as (keyof typeof labFlagSpec)[]).map((f) => (
        <LabFlagBadge key={f} flag={f} />
      ))}
    </div>
  ),
};

export const Trend: StoryObj = {
  render: () => <LabTrendChart className="max-w-md" data={hba1cTrend} name="HbA1c" unit="%" referenceLow={4} referenceHigh={5.7} />,
};
