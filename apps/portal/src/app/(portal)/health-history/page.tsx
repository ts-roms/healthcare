import { ClipboardListIcon, HeartHandshakeIcon, InfoIcon, LockIcon, NotebookTextIcon, PillIcon, ScissorsIcon, StethoscopeIcon, UsersIcon } from "lucide-react";
import { portalApi } from "@/lib/api/client";
import { getMe } from "@/lib/api/session";
import type { PortalHealthHistory } from "@/lib/api/types";
import { CONDITION_STATUS_TEXT, familyStateText, historySourceText, medicationStatusText, pastDate } from "@/lib/health-history";
import { QuestionnaireForm } from "./questionnaire-form";
import { StopMedicine } from "./stop-medicine";

export const metadata = { title: "Health history" };

function Section({ icon: Icon, title, children }: { icon: typeof NotebookTextIcon; title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2 rounded-xl border bg-card p-4" aria-label={title}>
      <h2 className="flex items-center gap-2 font-semibold">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary-subtle text-primary">
          <Icon className="size-4" aria-hidden />
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

const SECTION_TEXT: Record<PortalHealthHistory["submissions"][number]["sections"][number], string> = {
  medication: "medicines",
  condition: "past illnesses",
  procedure: "operations",
  family: "family history",
  social: "daily life",
};

function submittedOn(value: string): string {
  return new Intl.DateTimeFormat("en-PH", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Manila" }).format(new Date(value));
}

/**
 * The patient's health history: what the clinic recorded and what the patient reported here (read-only once sent;
 * mistakes are corrected by the clinic), the questionnaire to tell the clinic more, and "I stopped taking this" for
 * medicines reported here. Substance use and sexual history are shown to the patient, never to someone acting for
 * them, and are not asked here. A guardian with view-only access reads but cannot answer.
 */
export default async function HealthHistoryPage() {
  const [history, me] = await Promise.all([portalApi<PortalHealthHistory>("/portal/health-history"), getMe()]);
  const acting = me.acting !== null;
  const canAnswer = !me.acting || me.acting.scopes.includes("act");
  const social = history.social;
  const socialRows: Array<[string, string | null, boolean?]> = social
    ? [
        ["Tobacco", social.tobacco],
        ["Alcohol", social.alcohol],
        ["Work", social.occupation],
        ["Exposures at work", social.occupationalExposures],
        ["Home and household", social.livingSituation],
        ["Physical activity", social.physicalActivity],
        ["Diet", social.diet],
        ["Other substance use", social.substanceUse, true],
        ["Sexual history", social.sexualHistory, true],
      ]
    : [];
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-page-lg font-semibold">Your health history</h1>
        <p className="text-body text-muted-foreground">
          What your clinic has recorded about your past health, your family and your daily life, and what you have told it here.
        </p>
      </div>
      <p className="flex items-start gap-2 rounded-xl bg-info-subtle p-3 text-body text-info-foreground">
        <InfoIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
        You can tell the clinic about medicines you take, past illnesses, operations, your family and your daily life below. Once sent, an entry cannot be
        changed here: if something is wrong, tell your clinic at your next visit or send them a message.
      </p>

      <Section icon={PillIcon} title="Medicines from elsewhere">
        <p className="text-meta text-muted-foreground">
          Medicines, vitamins and herbal remedies that the clinic did not prescribe. Prescriptions from the clinic are under Prescriptions.
        </p>
        {history.medications.length ? (
          <ul className="flex flex-col divide-y">
            {history.medications.map((m) => (
              <li key={m.id} className="flex flex-col gap-1 py-2">
                <p className="font-medium">
                  {m.medication}
                  {m.dose ? <span className="font-normal text-muted-foreground"> · {m.dose}</span> : null}
                </p>
                <p className="text-meta text-muted-foreground">
                  {[m.reason ? `For ${m.reason}` : null, m.prescribedBy, medicationStatusText(m), historySourceText(m.source, m.recordedVia)]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                {m.canStop && canAnswer ? <StopMedicine id={m.id} name={m.medication} /> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-body text-muted-foreground">None recorded.</p>
        )}
      </Section>

      <Section icon={StethoscopeIcon} title="Past illnesses">
        {history.conditions.length ? (
          <ul className="flex flex-col divide-y">
            {history.conditions.map((c) => (
              <li key={c.id} className="flex flex-col gap-0.5 py-2">
                <p className="font-medium">{c.description}</p>
                <p className="text-meta text-muted-foreground">
                  {[c.onset ? `Since ${pastDate(c.onset)}` : null, CONDITION_STATUS_TEXT[c.status], historySourceText(c.source, c.recordedVia)]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-body text-muted-foreground">None recorded.</p>
        )}
      </Section>

      <Section icon={ScissorsIcon} title="Operations and procedures">
        {history.procedures.length ? (
          <ul className="flex flex-col divide-y">
            {history.procedures.map((p) => (
              <li key={p.id} className="flex flex-col gap-0.5 py-2">
                <p className="font-medium">
                  {p.description}
                  {p.bodySite ? <span className="font-normal text-muted-foreground"> · {p.bodySite}</span> : null}
                </p>
                <p className="text-meta text-muted-foreground">
                  {[pastDate(p.performed), p.performer, historySourceText(p.source, p.recordedVia)].filter(Boolean).join(" · ")}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-body text-muted-foreground">None recorded.</p>
        )}
      </Section>

      <Section icon={UsersIcon} title="Family history">
        <p className="text-body">{familyStateText(history.family)}</p>
        {history.family.entries.length ? (
          <ul className="flex flex-col divide-y">
            {history.family.entries.map((f) => (
              <li key={f.id} className="flex flex-col gap-0.5 py-2">
                <p className="font-medium">
                  {f.relative}: {f.condition}
                </p>
                <p className="text-meta text-muted-foreground">
                  {[
                    f.onsetAge !== null ? `From age ${f.onsetAge}` : null,
                    f.deceased ? `Passed away${f.causeOfDeath ? ` (${f.causeOfDeath})` : ""}` : null,
                    historySourceText(f.source, f.recordedVia),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </li>
            ))}
          </ul>
        ) : null}
      </Section>

      <Section icon={HeartHandshakeIcon} title="Daily life">
        {social ? (
          <>
            <p className="text-meta text-muted-foreground">
              As of {pastDate(social.effectiveDate)}
              {social.recordedVia === "patient_portal" ? " · reported here in MyHealth" : ""}
            </p>
            <dl className="grid gap-x-4 gap-y-1 text-body sm:grid-cols-[max-content_1fr]">
              {socialRows
                .filter(([, value]) => value)
                .map(([label, value, sensitive]) => (
                  <div key={label} className="contents">
                    <dt className="flex items-center gap-1 text-muted-foreground">
                      {sensitive ? <LockIcon className="size-3.5" aria-hidden /> : null}
                      {label}
                      {sensitive ? <span className="text-meta">(private)</span> : null}
                    </dt>
                    <dd className="whitespace-pre-line">{value}</dd>
                  </div>
                ))}
            </dl>
            {social.sensitiveWithheld ? (
              <p className="flex items-center gap-1.5 text-meta text-muted-foreground">
                <LockIcon className="size-3.5" aria-hidden /> Some private details are shown only to the patient.
              </p>
            ) : null}
          </>
        ) : (
          <p className="text-body text-muted-foreground">Not recorded yet.</p>
        )}
      </Section>

      <Section icon={ClipboardListIcon} title="Tell the clinic about your health history">
        {history.submissions.length ? (
          <p className="text-meta text-muted-foreground">
            Sent before:{" "}
            {history.submissions
              .slice(0, 5)
              .map(
                (s) => `${submittedOn(s.submittedAt)} (${s.sections.map((x) => SECTION_TEXT[x]).join(", ")}${s.byProxy ? "; by someone acting for you" : ""})`,
              )
              .join("; ")}
            .
          </p>
        ) : null}
        {canAnswer ? (
          <>
            <p className="text-body text-muted-foreground">
              Fill in what applies and leave the rest blank. Your answers are kept as what you told the clinic — they are not a diagnosis — and your care team
              reads them at your next visit.
            </p>
            <QuestionnaireForm social={social} actingForSomeone={acting} />
          </>
        ) : (
          <p className="text-body text-muted-foreground">Your access to this person&apos;s MyHealth is view-only, so you cannot answer for them.</p>
        )}
      </Section>
    </div>
  );
}
