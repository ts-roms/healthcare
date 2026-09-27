import { AlertOctagonIcon, PhoneIcon } from "lucide-react";
import type { TelemedicineConsultation } from "@/lib/api/types";

/** The patient's pre-consult answers, red flags first. Their own words: not a triage decision. */
export function QuestionnaireSummary({ session }: { session: TelemedicineConsultation["session"] }) {
  const q = session.questionnaire;
  if (!q) return <p className="text-table text-muted-foreground">The patient has not answered the pre-consult questions yet.</p>;
  return (
    <div className="flex flex-col gap-2 text-table">
      {session.redFlagLabels.length ? (
        <div role="alert" className="flex gap-2 rounded-md border border-critical/50 bg-critical/5 p-2">
          <AlertOctagonIcon className="mt-0.5 size-4 shrink-0 text-critical" aria-hidden />
          <div>
            <p className="font-semibold">Red flags reported — consider in-person or emergency care</p>
            <ul className="list-disc pl-4">
              {session.redFlagLabels.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
            <p className="text-meta text-muted-foreground">The patient was told to call 911 or go to an emergency room.</p>
          </div>
        </div>
      ) : null}
      <dl className="grid grid-cols-[9rem_1fr] gap-x-3 gap-y-1">
        <dt className="text-muted-foreground">Reason</dt>
        <dd className="whitespace-pre-wrap">{q.reasonForVisit}</dd>
        {q.symptoms ? (
          <>
            <dt className="text-muted-foreground">Symptoms</dt>
            <dd className="whitespace-pre-wrap">
              {q.symptoms}
              {q.symptomDurationDays !== undefined ? ` (${q.symptomDurationDays} day${q.symptomDurationDays === 1 ? "" : "s"})` : ""}
            </dd>
          </>
        ) : null}
        {q.currentMedications ? (
          <>
            <dt className="text-muted-foreground">Current medicines</dt>
            <dd className="whitespace-pre-wrap">{q.currentMedications}</dd>
          </>
        ) : null}
        {q.newAllergies ? (
          <>
            <dt className="text-muted-foreground">New allergies</dt>
            <dd className="font-medium text-warning-foreground">{q.newAllergies} — record them before prescribing</dd>
          </>
        ) : null}
        <dt className="text-muted-foreground">Location</dt>
        <dd>{q.locationCity}</dd>
        <dt className="text-muted-foreground">Callback number</dt>
        <dd>
          <a href={`tel:${q.callbackNumber.replace(/[^+0-9]/g, "")}`} className="inline-flex items-center gap-1 text-primary hover:underline">
            <PhoneIcon className="size-3.5" aria-hidden /> {q.callbackNumber}
          </a>
        </dd>
      </dl>
      {session.consentAcknowledgedAt ? <p className="text-meta text-muted-foreground">The patient acknowledged how online consultations work.</p> : null}
    </div>
  );
}
