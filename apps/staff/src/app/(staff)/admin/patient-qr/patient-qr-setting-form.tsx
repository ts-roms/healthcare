"use client";

import * as React from "react";
import { Button, Card, CardContent, CardHeader, CardTitle, Checkbox, RadioGroup, RadioGroupTile } from "@healthcare/ui/primitives";
import type { PatientQrContent, PatientQrSetting } from "@/lib/api/types";
import { useServerAction } from "@/lib/use-server-action";
import { savePatientQrSetting } from "./actions";

export function PatientQrSettingForm({ setting }: { setting: PatientQrSetting }) {
  const [enabled, setEnabled] = React.useState(setting.enabled);
  const [atRegistration, setAtRegistration] = React.useState(setting.issueAtRegistration);
  const [content, setContent] = React.useState<PatientQrContent>(setting.content);
  const { pending, run } = useServerAction({ refreshOnFailure: true });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Settings</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => savePatientQrSetting({ enabled, issueAtRegistration: atRegistration, content, version: setting.version }), "Settings saved");
          }}
        >
          <label className="flex items-center gap-2 text-table">
            <Checkbox id="qr-enabled" checked={enabled} onCheckedChange={(v) => setEnabled(v === true)} /> Use patient QR codes
          </label>
          <label className="flex items-center gap-2 text-table">
            <Checkbox id="qr-at-registration" disabled={!enabled} checked={atRegistration} onCheckedChange={(v) => setAtRegistration(v === true)} /> Issue a
            code when a patient is registered (the registering person can still decline for one patient)
          </label>
          <fieldset className="grid gap-2" disabled={!enabled}>
            <legend className="text-table font-medium">What the code holds</legend>
            <RadioGroup value={content} onValueChange={(v) => setContent(v as PatientQrContent)} className="grid gap-2">
              <RadioGroupTile value="token" id="qr-content-token" className="p-3">
                <span className="font-medium">A random key (recommended)</span>
                <span className="block text-meta text-muted-foreground">Meaningless without this system, and a lost card is revoked and replaced.</span>
              </RadioGroupTile>
              <RadioGroupTile value="patient_number" id="qr-content-number" className="p-3">
                <span className="font-medium">The patient number</span>
                <span className="block text-meta text-muted-foreground">
                  Easier to read from the card. Anyone who knows the number can make the same code, so revoking only stops this system accepting it.
                </span>
              </RadioGroupTile>
              <RadioGroupTile value="portal_link" id="qr-content-portal" className="p-3">
                <span className="font-medium">A MyHealth link</span>
                <span className="block text-meta text-muted-foreground">
                  The patient scans the card with their phone, MyHealth opens with their patient number filled in, and they choose their own password. They
                  still need their date of birth and the activation code the clinic gives them, so the card alone opens nothing. Needs the MyHealth address set
                  up for the API.
                </span>
              </RadioGroupTile>
            </RadioGroup>
            <p className="text-meta text-muted-foreground">Applies to codes issued from now on. Codes already on cards keep what they hold.</p>
          </fieldset>
          <Button type="submit" size="sm" className="self-start" disabled={pending}>
            Save settings
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
