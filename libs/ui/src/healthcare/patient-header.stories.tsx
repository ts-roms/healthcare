import type { Meta, StoryObj } from "@storybook/react-vite";
import { anaReyes, juanCruz, mariaSantos } from "@healthcare/domain/fixtures";
import { Badge } from "../primitives/badge";
import { PatientHeader } from "./patient-header";

const meta: Meta<typeof PatientHeader> = {
  title: "Healthcare/PatientHeader",
  component: PatientHeader,
  parameters: { layout: "fullscreen" },
  args: { patient: mariaSantos },
};
export default meta;
type Story = StoryObj<typeof PatientHeader>;

export const Full: Story = {};
export const Compact: Story = { args: { variant: "compact", aside: <Badge variant="info">Consultation · 27 Sep 2026</Badge> } };
export const NoKnownAllergies: Story = { args: { patient: juanCruz } };
export const ModerateAllergy: Story = { args: { patient: anaReyes, variant: "compact" } };

/** A patient with no allergy record yet (e.g. registered before clinical modules exist): never "No known allergies". */
export const AllergiesNotRecorded: Story = { args: { patient: { ...juanCruz, allergies: [] }, allergiesRecorded: false } };

/** Sample extra banner facts (the Patient 360 workspace shows a masked PhilHealth PIN and alert badges here). */
export const WithDetails: Story = {
  args: {
    patient: { ...mariaSantos, philHealth: undefined },
    details: (
      <div className="flex items-center gap-1">
        <dt className="text-muted-foreground">PhilHealth PIN</dt>
        <dd className="font-mono">••-•••••••01-2 (sample)</dd>
      </div>
    ),
  },
};

/** The viewer lacks clinical access (e.g. front desk): no allergy statement at all, never "not recorded". */
export const AllergiesHidden: Story = { args: { patient: mariaSantos, variant: "compact", allergiesHidden: true } };
