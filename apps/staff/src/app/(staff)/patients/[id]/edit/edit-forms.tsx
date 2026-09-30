"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button, Checkbox, Input, Label, NativeSelect, toast } from "@healthcare/ui/primitives";
import { label } from "@/lib/patient-mapping";
import {
  ADDRESS_USE_OPTIONS,
  CIVIL_STATUS_OPTIONS,
  COMMUNICATION_CATEGORY_OPTIONS,
  COMMUNICATION_CHANNEL_OPTIONS,
  CONTACT_SYSTEM_OPTIONS,
  CONTACT_USE_OPTIONS,
  demographicsFormFrom,
  effectivePreferences,
  IDENTIFIER_NEEDS_ISSUER,
  IDENTIFIER_TYPE_OPTIONS,
  RELATIONSHIP_OPTIONS,
  SEX_OPTIONS,
} from "@/lib/patient-edit";
import {
  addAddress,
  addContact,
  addIdentifier,
  addRelationship,
  changeStatus,
  type FormResult,
  removeEntry,
  setPreferences,
  updateDemographics,
} from "./actions";

type Errors = Record<string, string>;

/** Runs an action; on success toasts and refreshes, otherwise returns the field errors (and toasts the message). */
function useSubmit() {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [errors, setErrors] = React.useState<Errors>({});
  const submit = (call: () => Promise<FormResult>, success: string, after?: () => void) =>
    startTransition(async () => {
      const result = await call();
      if (result.ok) {
        setErrors({});
        toast.success(success);
        after?.();
        router.refresh();
      } else {
        setErrors(result.fieldErrors ?? {});
        toast.error(result.message);
      }
    });
  return { pending, errors, submit };
}

function Field({ id, label: text, error, children, className }: { id: string; label: string; error?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`grid gap-1 ${className ?? ""}`}>
      <Label htmlFor={id}>{text}</Label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-meta text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function CheckField({ id, checked, onChange, children }: { id: string; checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <Checkbox id={id} checked={checked} onCheckedChange={(v) => onChange(v === true)} />
      <Label htmlFor={id} className="font-normal">
        {children}
      </Label>
    </div>
  );
}

type Current = Parameters<typeof demographicsFormFrom>[0];

/** Name, sex, birth date and the other details; only what changed is sent, with an optional reason. */
export function DemographicsForm({ patientId, current, version }: { patientId: string; current: Current; version: number }) {
  const [form, setForm] = React.useState(() => demographicsFormFrom(current));
  const { pending, errors, submit } = useSubmit();
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [key]: e.target.value }));
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit(
          () => updateDemographics(patientId, current, version, form),
          "Details saved",
          () => setForm((f) => ({ ...f, reason: "" })),
        );
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="familyName" label="Family name *" error={errors.familyName}>
          <Input id="familyName" required value={form.familyName} onChange={set("familyName")} />
        </Field>
        <Field id="givenName" label="Given name *" error={errors.givenName}>
          <Input id="givenName" required value={form.givenName} onChange={set("givenName")} />
        </Field>
        <Field id="middleName" label="Middle name" error={errors.middleName}>
          <Input id="middleName" value={form.middleName} onChange={set("middleName")} />
        </Field>
        <Field id="suffix" label="Suffix" error={errors.suffix}>
          <Input id="suffix" placeholder="e.g. Jr., III" value={form.suffix} onChange={set("suffix")} />
        </Field>
        <Field id="sex" label="Sex *" error={errors.sex}>
          <NativeSelect id="sex" value={form.sex} onChange={set("sex")}>
            {SEX_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {label(s)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="genderIdentity" label="Gender identity" error={errors.genderIdentity}>
          <Input id="genderIdentity" value={form.genderIdentity} onChange={set("genderIdentity")} />
        </Field>
        <Field id="birthDate" label="Birth date *" error={errors.birthDate}>
          <Input id="birthDate" type="date" required value={form.birthDate} onChange={set("birthDate")} />
        </Field>
        <div className="flex items-end pb-2">
          <CheckField id="birthDateIsEstimated" checked={form.birthDateIsEstimated} onChange={(v) => setForm((f) => ({ ...f, birthDateIsEstimated: v }))}>
            Estimated (exact date unknown)
          </CheckField>
        </div>
        <Field id="civilStatus" label="Civil status" error={errors.civilStatus}>
          <NativeSelect id="civilStatus" value={form.civilStatus} onChange={set("civilStatus")} emptyText="No civil statuses">
            <option value="">Not recorded</option>
            {CIVIL_STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {label(s)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="nationality" label="Nationality (2-letter code)" error={errors.nationality}>
          <Input id="nationality" maxLength={2} placeholder="PH" value={form.nationality} onChange={set("nationality")} />
        </Field>
        <Field id="occupation" label="Occupation" error={errors.occupation} className="sm:col-span-2">
          <Input id="occupation" value={form.occupation} onChange={set("occupation")} />
        </Field>
        <Field id="demographics-reason" label="Reason for the change (recorded in the audit trail)" error={errors.reason} className="sm:col-span-2">
          <Input
            id="demographics-reason"
            maxLength={500}
            placeholder="e.g. Spelling corrected from the birth certificate"
            value={form.reason}
            onChange={set("reason")}
          />
        </Field>
      </div>
      <Button type="submit" size="sm" className="self-start" disabled={pending}>
        {pending ? "Saving…" : "Save details"}
      </Button>
    </form>
  );
}

/** Active, inactive or deceased, with a reason; deceased needs the date and time of death. */
export function StatusForm({ patientId, version, status }: { patientId: string; version: number; status: string }) {
  const [form, setForm] = React.useState({ status: status === "active" ? "inactive" : "active", deceasedAt: "", reason: "" });
  const { pending, errors, submit } = useSubmit();
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit(
          () => changeStatus(patientId, version, form as Parameters<typeof changeStatus>[2]),
          `Record marked ${label(form.status).toLowerCase()}`,
          () => setForm((f) => ({ ...f, reason: "" })),
        );
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="status" label="Change the record to" error={errors.status}>
          <NativeSelect id="status" value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
            {(["active", "inactive", "deceased"] as const)
              .filter((s) => s !== status)
              .map((s) => (
                <option key={s} value={s}>
                  {label(s)}
                </option>
              ))}
          </NativeSelect>
        </Field>
        {form.status === "deceased" ? (
          <Field id="deceasedAt" label="Date and time of death *" error={errors.deceasedAt}>
            <Input
              id="deceasedAt"
              type="datetime-local"
              required
              value={form.deceasedAt}
              onChange={(e) => setForm((f) => ({ ...f, deceasedAt: e.target.value }))}
            />
          </Field>
        ) : null}
        <Field id="status-reason" label="Reason *" error={errors.reason} className="sm:col-span-2">
          <Input
            id="status-reason"
            required
            minLength={5}
            maxLength={500}
            placeholder={form.status === "deceased" ? "e.g. Death certificate seen" : "e.g. Moved abroad, asked to close the record"}
            value={form.reason}
            onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
          />
        </Field>
      </div>
      <Button type="submit" size="sm" variant={form.status === "deceased" ? "destructive" : "default"} className="self-start" disabled={pending}>
        {pending ? "Saving…" : `Mark ${label(form.status).toLowerCase()}`}
      </Button>
    </form>
  );
}

type Collection = "contacts" | "addresses" | "identifiers" | "relationships";

/** Removing an entry keeps it in the record's history; it needs a reason. */
export function RemoveEntry({ patientId, collection, recordId, what }: { patientId: string; collection: Collection; recordId: string; what: string }) {
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const { pending, submit } = useSubmit();
  if (!open) {
    return (
      <Button type="button" size="sm" variant="ghost" className="ml-auto" onClick={() => setOpen(true)}>
        Remove…
      </Button>
    );
  }
  return (
    <form
      className="flex w-full flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        submit(
          () => removeEntry(patientId, collection, recordId, reason),
          `${what} removed`,
          () => setOpen(false),
        );
      }}
    >
      <Field id={`remove-${recordId}`} label={`Why remove this ${what.toLowerCase()}?`} className="min-w-64 flex-1">
        <Input id={`remove-${recordId}`} required minLength={5} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <Button type="submit" size="sm" variant="destructive" disabled={pending}>
        {pending ? "Removing…" : "Remove"}
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
        Cancel
      </Button>
    </form>
  );
}

/** A collapsed "Add …" button that opens its form. */
function AddPanel({ title, children }: { title: string; children: (close: () => void) => React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  if (!open) {
    return (
      <Button type="button" size="sm" variant="outline" className="self-start" onClick={() => setOpen(true)}>
        {title}…
      </Button>
    );
  }
  return (
    <div className="flex flex-col gap-3 rounded-md border p-3">
      <p className="font-medium">{title}</p>
      {children(() => setOpen(false))}
    </div>
  );
}

function FormButtons({ pending, label: text, onCancel }: { pending: boolean; label: string; onCancel: () => void }) {
  return (
    <div className="flex gap-2">
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Saving…" : text}
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={pending}>
        Cancel
      </Button>
    </div>
  );
}

export function AddContactForm({ patientId }: { patientId: string }) {
  return <AddPanel title="Add a contact">{(close) => <ContactFields patientId={patientId} close={close} />}</AddPanel>;
}

function ContactFields({ patientId, close }: { patientId: string; close: () => void }) {
  const [form, setForm] = React.useState({ system: "mobile", value: "", use: "personal", isPrimary: true });
  const { pending, errors, submit } = useSubmit();
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit(() => addContact(patientId, form as Parameters<typeof addContact>[1]), "Contact added", close);
      }}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Field id="contact-system" label="Kind">
          <NativeSelect id="contact-system" value={form.system} onChange={(e) => setForm((f) => ({ ...f, system: e.target.value }))}>
            {CONTACT_SYSTEM_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {label(s)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="contact-value" label={form.system === "email" ? "Email *" : "Number *"} error={errors.value}>
          <Input
            id="contact-value"
            required
            type={form.system === "email" ? "email" : "tel"}
            placeholder={form.system === "mobile" ? "0917 123 4567" : undefined}
            value={form.value}
            onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))}
          />
        </Field>
        <Field id="contact-use" label="Use">
          <NativeSelect id="contact-use" value={form.use} onChange={(e) => setForm((f) => ({ ...f, use: e.target.value }))}>
            {CONTACT_USE_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {label(s)}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>
      <CheckField id="contact-primary" checked={form.isPrimary} onChange={(v) => setForm((f) => ({ ...f, isPrimary: v }))}>
        Make it the primary {form.system === "email" ? "email" : "number"} (reminders and notices go there)
      </CheckField>
      <FormButtons pending={pending} label="Add contact" onCancel={close} />
    </form>
  );
}

export function AddAddressForm({ patientId }: { patientId: string }) {
  return <AddPanel title="Add an address">{(close) => <AddressFields patientId={patientId} close={close} />}</AddPanel>;
}

function AddressFields({ patientId, close }: { patientId: string; close: () => void }) {
  const [form, setForm] = React.useState({ use: "home", line1: "", barangay: "", cityMunicipality: "", province: "", postalCode: "", isPrimary: true });
  const { pending, errors, submit } = useSubmit();
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [key]: e.target.value }));
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit(() => addAddress(patientId, form as Parameters<typeof addAddress>[1]), "Address added", close);
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="address-line1" label="House no., street, subdivision or sitio/purok" className="sm:col-span-2">
          <Input id="address-line1" value={form.line1} onChange={set("line1")} />
        </Field>
        <Field id="address-barangay" label="Barangay">
          <Input id="address-barangay" value={form.barangay} onChange={set("barangay")} />
        </Field>
        <Field id="address-city" label="City / municipality *" error={errors.cityMunicipality}>
          <Input id="address-city" required value={form.cityMunicipality} onChange={set("cityMunicipality")} />
        </Field>
        <Field id="address-province" label="Province">
          <Input id="address-province" value={form.province} onChange={set("province")} />
        </Field>
        <Field id="address-postal" label="Postal code" error={errors.postalCode}>
          <Input id="address-postal" inputMode="numeric" maxLength={4} value={form.postalCode} onChange={set("postalCode")} />
        </Field>
        <Field id="address-use" label="Use">
          <NativeSelect id="address-use" value={form.use} onChange={set("use")}>
            {ADDRESS_USE_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {label(s)}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>
      <CheckField id="address-primary" checked={form.isPrimary} onChange={(v) => setForm((f) => ({ ...f, isPrimary: v }))}>
        Make it the primary address
      </CheckField>
      <FormButtons pending={pending} label="Add address" onCancel={close} />
    </form>
  );
}

export function AddIdentifierForm({ patientId }: { patientId: string }) {
  return <AddPanel title="Add an ID">{(close) => <IdentifierFields patientId={patientId} close={close} />}</AddPanel>;
}

function IdentifierFields({ patientId, close }: { patientId: string; close: () => void }) {
  const [form, setForm] = React.useState({ type: "", value: "", issuer: "", validUntil: "" });
  const { pending, errors, submit } = useSubmit();
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [key]: e.target.value }));
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit(() => addIdentifier(patientId, form as Parameters<typeof addIdentifier>[1]), "ID added", close);
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="identifier-type" label="Kind of ID *" error={errors.type}>
          <NativeSelect id="identifier-type" required placeholder="Choose…" value={form.type} onChange={set("type")}>
            {IDENTIFIER_TYPE_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {label(s)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="identifier-value" label="Number *" error={errors.value}>
          <Input id="identifier-value" required className="font-mono" value={form.value} onChange={set("value")} />
        </Field>
        {IDENTIFIER_NEEDS_ISSUER.includes(form.type) || form.type === "other" ? (
          <Field
            id="identifier-issuer"
            label={IDENTIFIER_NEEDS_ISSUER.includes(form.type) ? "Issued by (HMO or facility) *" : "Issued by"}
            error={errors.issuer}
          >
            <Input id="identifier-issuer" value={form.issuer} onChange={set("issuer")} />
          </Field>
        ) : null}
        <Field id="identifier-until" label="Valid until" error={errors.validUntil}>
          <Input id="identifier-until" type="date" value={form.validUntil} onChange={set("validUntil")} />
        </Field>
      </div>
      <p className="text-meta text-muted-foreground">An ID already on another patient&apos;s record is refused: that may be a duplicate record.</p>
      <FormButtons pending={pending} label="Add ID" onCancel={close} />
    </form>
  );
}

export function AddRelationshipForm({ patientId }: { patientId: string }) {
  return <AddPanel title="Add an emergency contact or guardian">{(close) => <RelationshipFields patientId={patientId} close={close} />}</AddPanel>;
}

function RelationshipFields({ patientId, close }: { patientId: string; close: () => void }) {
  const [form, setForm] = React.useState({ relationship: "", name: "", contactNumber: "", isEmergencyContact: true, isLegalGuardian: false, notes: "" });
  const { pending, errors, submit } = useSubmit();
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [key]: e.target.value }));
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit(() => addRelationship(patientId, form as Parameters<typeof addRelationship>[1]), "Added", close);
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="relationship-name" label="Name *" error={errors.name}>
          <Input id="relationship-name" required value={form.name} onChange={set("name")} />
        </Field>
        <Field id="relationship-kind" label="Relationship to the patient *" error={errors.relationship}>
          <NativeSelect id="relationship-kind" required placeholder="Choose…" value={form.relationship} onChange={set("relationship")}>
            {RELATIONSHIP_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {label(s)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="relationship-number" label="Contact number" error={errors.contactNumber}>
          <Input id="relationship-number" type="tel" value={form.contactNumber} onChange={set("contactNumber")} />
        </Field>
        <Field id="relationship-notes" label="Notes" error={errors.notes}>
          <Input id="relationship-notes" maxLength={500} value={form.notes} onChange={set("notes")} />
        </Field>
      </div>
      <div className="flex flex-wrap gap-4">
        <CheckField id="relationship-emergency" checked={form.isEmergencyContact} onChange={(v) => setForm((f) => ({ ...f, isEmergencyContact: v }))}>
          Emergency contact
        </CheckField>
        <CheckField id="relationship-guardian" checked={form.isLegalGuardian} onChange={(v) => setForm((f) => ({ ...f, isLegalGuardian: v }))}>
          Legal guardian
        </CheckField>
      </div>
      <p className="text-meta text-muted-foreground">
        Recording a guardian here does not give them MyHealth access; use Guardians and caregivers on the patient record for that.
      </p>
      <FormButtons pending={pending} label="Add" onCancel={close} />
    </form>
  );
}

/** Which messages the patient agreed to receive by text, email and push; what is not recorded shows the default. */
export function PreferencesForm({ patientId, recorded }: { patientId: string; recorded: Array<{ channel: string; category: string; optedIn: boolean }> }) {
  const [chosen, setChosen] = React.useState(() => effectivePreferences(recorded));
  const { pending, submit } = useSubmit();
  const CATEGORY: Record<string, string> = { clinical: "Care", administrative: "Appointments and bills", outreach: "Optional reminders and news" };
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit(() => setPreferences(patientId, recorded, chosen), "Preferences saved");
      }}
    >
      <div className="grid gap-2">
        {COMMUNICATION_CATEGORY_OPTIONS.map((category) => (
          <fieldset key={category} className="flex flex-wrap items-center gap-4">
            <legend className="mb-1 w-full text-table font-medium">{CATEGORY[category]}</legend>
            {COMMUNICATION_CHANNEL_OPTIONS.map((channel) => {
              const key = `${channel}:${category}`;
              return (
                <CheckField key={key} id={`pref-${key}`} checked={chosen[key] ?? false} onChange={(v) => setChosen((c) => ({ ...c, [key]: v }))}>
                  {label(channel)}
                </CheckField>
              );
            })}
          </fieldset>
        ))}
      </div>
      <p className="text-meta text-muted-foreground">
        Record what the patient asked for. Without a recorded choice, care and appointment messages are sent and optional reminders are not. Patients can also
        change these themselves in MyHealth.
      </p>
      <Button type="submit" size="sm" className="self-start" disabled={pending}>
        {pending ? "Saving…" : "Save preferences"}
      </Button>
    </form>
  );
}
