import type { ImportedCode, ImportedItem, ImportedPatient } from "@/lib/api/types";

/** Readable form of one imported entry, as the sender stated it (dates exactly as sent). */
export function EntrySummary({ item }: { item: ImportedItem }) {
  switch (item.kind) {
    case "patient":
      return <ImportedPatientSummary patient={item} />;
    case "allergy":
      return (
        <Fields>
          <Field term="Substance">{item.substance ?? "—"}</Field>
          <Field term="Category">{item.category}</Field>
          <Field term="Criticality">{item.criticality.replace(/_/g, " ")}</Field>
          {item.severity ? <Field term="Severity">{item.severity}</Field> : null}
          {item.reaction ? <Field term="Reaction">{item.reaction}</Field> : null}
          <Field term="Status (sender)">{[item.clinicalStatus, item.verificationStatus].filter(Boolean).join(" · ") || "—"}</Field>
          {item.recordedDate ? <Field term="Recorded">{item.recordedDate}</Field> : null}
          <Codes codes={item.codes} />
        </Fields>
      );
    case "condition":
      return (
        <Fields>
          <Field term="Condition">{item.display ?? "—"}</Field>
          <Field term="Status (sender)">{[item.clinicalStatus, item.verificationStatus].filter(Boolean).join(" · ") || "—"}</Field>
          {item.onset ? <Field term="Onset">{item.onset}</Field> : null}
          {item.abatement ? <Field term="Abated">{item.abatement}</Field> : null}
          <Codes codes={item.codes} />
        </Fields>
      );
    case "observation":
      return (
        <Fields>
          <Field term={item.category === "laboratory" ? "Laboratory" : item.category === "vital-signs" ? "Vital sign" : "Observation"}>
            {item.display ?? "—"}
          </Field>
          <Field term="Value">
            {item.value ?? "—"}
            {item.interpretation ? ` (${item.interpretation})` : ""}
          </Field>
          {item.referenceRange ? <Field term="Reference range">{item.referenceRange}</Field> : null}
          <Field term="Status (sender)">{item.status}</Field>
          {item.effective ? <Field term="When">{item.effective}</Field> : null}
          <Codes codes={item.codes} />
        </Fields>
      );
    case "medication":
      return (
        <Fields>
          <Field term={item.statement === "request" ? "Prescribed elsewhere" : "Medication"}>{item.medication ?? "—"}</Field>
          {item.dosage ? <Field term="Dosage">{item.dosage}</Field> : null}
          <Field term="Status (sender)">{item.status}</Field>
          {item.date ? <Field term="Date">{item.date}</Field> : null}
          <Codes codes={item.codes} />
        </Fields>
      );
    case "document":
      return (
        <Fields>
          <Field term="Document">{item.description ?? item.type ?? "—"}</Field>
          {item.type ? <Field term="Type">{item.type}</Field> : null}
          {item.date ? <Field term="Date">{item.date}</Field> : null}
          <Field term="Files">
            {item.attachments
              .map(
                (a) =>
                  [a.title, a.contentType, a.size !== null ? `${Math.max(1, Math.round(a.size / 1024))} KB` : null].filter(Boolean).join(", ") || "Attachment",
              )
              .join("; ")}{" "}
            <span className="text-muted-foreground">(not imported)</span>
          </Field>
        </Fields>
      );
    case "immunization":
      return (
        <Fields>
          <Field term="Vaccine">{item.vaccine ?? "—"}</Field>
          <Field term="Given">{item.occurrence ?? (item.occurrenceText ? `"${item.occurrenceText}" (no date)` : "—")}</Field>
          <Field term="Status (sender)">
            {item.status}
            {item.notDoneReason ? ` — ${item.notDoneReason}` : ""}
          </Field>
          {item.doseNumber ? <Field term="Dose">{item.doseNumber}</Field> : null}
          {item.lotNumber ? (
            <Field term="Lot">{[item.lotNumber, item.expirationDate ? `expires ${item.expirationDate}` : null].filter(Boolean).join(", ")}</Field>
          ) : null}
          {item.route || item.site ? <Field term="Route / site">{[item.route, item.site].filter(Boolean).join(" · ")}</Field> : null}
          {item.performer || item.location ? <Field term="Given by / where">{[item.performer, item.location].filter(Boolean).join(", ")}</Field> : null}
          <Field term="Source">
            {item.primarySource === false ? `Reported to the sender${item.reportOrigin ? ` (${item.reportOrigin})` : ""}` : "The sender's own record"}
          </Field>
          <Codes codes={item.codes} />
        </Fields>
      );
    case "not_supported":
      return (
        <p className="text-table text-muted-foreground">{item.resourceType} is not supported for import. It is kept with the import but cannot be accepted.</p>
      );
  }
}

export function ImportedPatientSummary({ patient }: { patient: ImportedPatient }) {
  const name = [patient.familyName ? patient.familyName.toUpperCase() : null, patient.givenNames.join(" "), patient.suffix].filter(Boolean).join(", ");
  return (
    <Fields>
      <Field term="Name">{name || patient.nameText || "—"}</Field>
      <Field term="Birth date">{patient.birthDate ?? "—"}</Field>
      <Field term="Sex / gender">{patient.sex ?? patient.gender ?? "—"}</Field>
      {patient.identifiers.length ? (
        <Field term="Identifiers">
          {patient.identifiers.map((i) => (
            <div key={`${i.system}|${i.value}`}>
              <span className="font-mono">{i.value}</span>{" "}
              <span className="text-meta text-muted-foreground">{i.type ? i.type.replace(/_/g, " ") : (i.system ?? "no system")}</span>
            </div>
          ))}
        </Field>
      ) : null}
      {patient.telecom.length ? <Field term="Contacts">{patient.telecom.map((t) => t.value).join(", ")}</Field> : null}
      {patient.addresses.length ? (
        <Field term="Address">
          {patient.addresses.map((a, i) => (
            <div key={i}>{a.text ?? [...a.lines, a.city, a.district, a.state, a.postalCode].filter(Boolean).join(", ")}</div>
          ))}
        </Field>
      ) : null}
    </Fields>
  );
}

function Codes({ codes }: { codes: ImportedCode[] }) {
  const coded = codes.filter((c) => c.code);
  if (coded.length === 0) return null;
  return (
    <Field term="Codes">
      {coded.map((c) => (
        <div key={`${c.system}|${c.code}`} className="text-meta">
          <span className="font-mono">{c.code}</span> <span className="text-muted-foreground">{c.system ?? ""}</span>
        </div>
      ))}
    </Field>
  );
}

function Fields({ children }: { children: React.ReactNode }) {
  return <dl className="grid grid-cols-[9rem_1fr] gap-x-3 gap-y-1 text-body">{children}</dl>;
}

function Field({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{term}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </>
  );
}
