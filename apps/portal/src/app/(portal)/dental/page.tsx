import {
  AlertCircleIcon,
  BanIcon,
  CheckCircle2Icon,
  ClipboardListIcon,
  EyeIcon,
  HourglassIcon,
  InfoIcon,
  MinusCircleIcon,
  SmileIcon,
  SparklesIcon,
  ThumbsUpIcon,
  XCircleIcon,
  type LucideIcon,
} from "lucide-react";
import { ApiError } from "@healthcare/web-session";
import { EmptyState } from "@/components/empty-state";
import { portalApi } from "@/lib/api/client";
import type { PortalDentalPlan, PortalDentalRecord } from "@/lib/api/types";
import {
  chartRows,
  conditionsText,
  PLAN_STATUS_TEXT,
  planItemState,
  surfacesText,
  TOOTH_TONE_TEXT,
  toothText,
  toothTone,
  type ItemTone,
  type ToothTone,
} from "@/lib/dental";
import { formatCalendarDate } from "@/lib/greeting";
import { toothLabel } from "@healthcare/domain";
import { DentalImages } from "./dental-images";
import { PlanDecision } from "./plan-decision";

export const metadata = { title: "Dental" };

const TOOTH: Record<ToothTone, { icon: LucideIcon; className: string }> = {
  healthy: { icon: CheckCircle2Icon, className: "bg-success-subtle text-success-foreground" },
  treated: { icon: SparklesIcon, className: "bg-info-subtle text-info-foreground" },
  attention: { icon: AlertCircleIcon, className: "bg-warning-subtle text-warning-foreground" },
  watch: { icon: EyeIcon, className: "bg-secondary text-secondary-foreground" },
  missing: { icon: MinusCircleIcon, className: "bg-muted text-muted-foreground" },
};

const ITEM: Record<ItemTone, { icon: LucideIcon; className: string }> = {
  awaiting: { icon: HourglassIcon, className: "bg-warning-subtle text-warning-foreground" },
  agreed: { icon: ThumbsUpIcon, className: "bg-info-subtle text-info-foreground" },
  done: { icon: CheckCircle2Icon, className: "bg-success-subtle text-success-foreground" },
  declined: { icon: XCircleIcon, className: "bg-muted text-muted-foreground" },
  cancelled: { icon: BanIcon, className: "bg-muted text-muted-foreground" },
};

/** The patient's dental record, when the clinic shares it: plans, treatments done and the tooth chart. */
export default async function DentalPage() {
  let record: PortalDentalRecord;
  try {
    record = await portalApi<PortalDentalRecord>("/portal/dental/record");
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) {
      return (
        <div className="flex flex-col gap-5">
          <Header />
          <EmptyState icon={SmileIcon} title="Dental records are not available in MyHealth">
            Your clinic does not share dental records here. Ask the clinic if you need a copy.
          </EmptyState>
        </div>
      );
    }
    throw e;
  }
  const empty = !record.plans.length && !record.procedures.length && !record.chart.length && !record.images.length;
  const acknowledgement = record.decisions.enabled ? record.decisions.acknowledgement : null;
  return (
    <div className="flex flex-col gap-6">
      <Header />
      {empty ? (
        <EmptyState icon={SmileIcon} title="Nothing here yet">
          After a dental visit, your treatment plans, treatments done and tooth chart appear here.
        </EmptyState>
      ) : (
        <>
          <section className="flex flex-col gap-3">
            <h2 className="text-section-lg font-semibold">Treatment plans</h2>
            {record.plans.length ? (
              record.plans.map((plan) => <Plan key={plan.id} plan={plan} notation={record.notation} acknowledgement={acknowledgement} />)
            ) : (
              <EmptyState icon={ClipboardListIcon} title="No treatment plans">
                If your dentist proposes treatment, the plan appears here.
              </EmptyState>
            )}
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-section-lg font-semibold">Treatments done</h2>
            {record.procedures.length ? (
              <ul className="flex flex-col gap-2">
                {record.procedures.map((p) => (
                  <li key={p.id} className="flex flex-col gap-0.5 rounded-xl border bg-card p-3">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="font-semibold">{p.procedureName}</span>
                      <span className="shrink-0 text-meta text-muted-foreground">{formatCalendarDate(p.performedOn)}</span>
                    </span>
                    <Site tooth={p.tooth} surfaces={p.surfaces} notation={record.notation} />
                    <span className="text-meta text-muted-foreground">{[p.dentistName, p.facilityName].filter(Boolean).join(" · ")}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon={CheckCircle2Icon} title="No treatments recorded yet">
                Treatments your dentist records appear here.
              </EmptyState>
            )}
          </section>

          <Chart record={record} />

          {record.images.length ? (
            <section className="flex flex-col gap-2">
              <div>
                <h2 className="text-section-lg font-semibold">X-rays and photos</h2>
                <p className="text-meta text-muted-foreground">Images your dentist shared with you. Ask your dentist to explain what they show.</p>
              </div>
              <DentalImages images={record.images} notation={record.notation} />
            </section>
          ) : null}
        </>
      )}
      <p className="flex items-start gap-2 text-meta text-muted-foreground">
        <InfoIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
        Your dentist&apos;s notes are not shown here, X-rays and photos only when your dentist shares them, and fees are not part of a plan — ask the clinic. If
        something looks wrong, tell your dentist at your next visit.
      </p>
    </div>
  );
}

function Header() {
  return (
    <div>
      <h1 className="text-page-lg font-semibold">Your dental record</h1>
      <p className="text-body text-muted-foreground">Treatment your dentist planned with you, what has been done, and your teeth at your last visit.</p>
    </div>
  );
}

function Site({
  tooth,
  surfaces,
  notation,
}: {
  tooth: string | null;
  surfaces: PortalDentalPlan["items"][number]["surfaces"];
  notation: PortalDentalRecord["notation"];
}) {
  if (!tooth) return <span className="text-body">Whole mouth</span>;
  const where = surfacesText(tooth, surfaces);
  return (
    <span className="text-body">
      Tooth {toothText(tooth, notation)}
      {where ? <span className="text-muted-foreground"> — {where}</span> : null}
    </span>
  );
}

function Plan({ plan, notation, acknowledgement }: { plan: PortalDentalPlan; notation: PortalDentalRecord["notation"]; acknowledgement: string | null }) {
  const phases = [...new Set(plan.items.map((i) => i.phase))];
  return (
    <article className="flex flex-col gap-3 rounded-xl border bg-card p-4">
      <div className="flex flex-col gap-0.5">
        <h3 className="font-semibold">{plan.title}</h3>
        <p className="text-meta text-muted-foreground">
          {PLAN_STATUS_TEXT[plan.status]} · proposed {formatCalendarDate(plan.proposedOn)}
          {plan.decidedOn ? `, decided ${formatCalendarDate(plan.decidedOn)}${plan.decidedIn === "myhealth" ? " by you in MyHealth" : ""}` : ""}
        </p>
        <p className="text-meta text-muted-foreground">{[plan.dentistName, plan.facilityName].filter(Boolean).join(" · ")}</p>
      </div>
      {phases.map((phase) => (
        <div key={phase} className="flex flex-col gap-2">
          {phases.length > 1 ? <p className="text-meta font-semibold text-muted-foreground">Step {phase}</p> : null}
          <ul className="flex flex-col gap-2">
            {plan.items
              .filter((i) => i.phase === phase)
              .map((item) => {
                const state = planItemState(item.status);
                const { icon: Icon, className } = ITEM[state.tone];
                return (
                  <li key={item.id} className="flex flex-col gap-1 border-t pt-2 first:border-t-0 first:pt-0">
                    <span className="font-medium">{item.procedureName}</span>
                    <Site tooth={item.tooth} surfaces={item.surfaces} notation={notation} />
                    <span className={`inline-flex w-fit items-center gap-1.5 rounded-lg px-2 py-1 text-meta font-medium ${className}`}>
                      <Icon className="size-4 shrink-0" aria-hidden />
                      {state.text}
                    </span>
                  </li>
                );
              })}
          </ul>
        </div>
      ))}
      {plan.canDecide && acknowledgement ? (
        <PlanDecision plan={plan} acknowledgement={acknowledgement} />
      ) : plan.items.some((i) => i.decision === "awaiting") ? (
        <p className="text-meta text-muted-foreground">To decide, talk to your dentist or the clinic — decisions are recorded at the clinic.</p>
      ) : null}
    </article>
  );
}

function Chart({ record }: { record: PortalDentalRecord }) {
  const byTooth = new Map(record.chart.map((t) => [t.tooth, t]));
  const noted = record.chart.filter((t) => t.conditions.length);
  const tones = [...new Set(record.chart.map(toothTone))];
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-section-lg font-semibold">Your teeth</h2>
        <p className="text-meta text-muted-foreground">As your dentist last charted them. You face the chart: your right side is on the left.</p>
      </div>
      {record.chart.length ? (
        <>
          <div className="flex flex-col gap-3 rounded-xl border bg-card p-3">
            {chartRows(record.chart).map((row) => (
              <div key={row.label} className="flex flex-col gap-1">
                <p className="text-meta text-muted-foreground">{row.label}</p>
                <ul className="grid gap-0.5" style={{ gridTemplateColumns: `repeat(${row.teeth.length}, minmax(0, 1fr))` }}>
                  {row.teeth.map((code) => {
                    const tooth = byTooth.get(code);
                    const label = toothLabel(code, record.notation);
                    if (!tooth) {
                      return (
                        <li
                          key={code}
                          aria-label={`Tooth ${label}: not charted`}
                          className="flex flex-col items-center rounded-md border border-dashed py-1 text-[10px] text-muted-foreground"
                        >
                          {label}
                          <span className="size-3" aria-hidden />
                        </li>
                      );
                    }
                    const tone = toothTone(tooth);
                    const { icon: Icon, className } = TOOTH[tone];
                    return (
                      <li
                        key={code}
                        aria-label={`Tooth ${toothText(code, record.notation)}: ${conditionsText(tooth)}`}
                        title={`${TOOTH_TONE_TEXT[tone]}: ${conditionsText(tooth)}`}
                        className={`flex flex-col items-center rounded-md py-1 text-[10px] font-medium ${className}`}
                      >
                        {label}
                        <Icon className="size-3" aria-hidden />
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
            <ul className="flex flex-wrap gap-x-3 gap-y-1 border-t pt-2" aria-label="Key">
              {tones.map((tone) => {
                const { icon: Icon, className } = TOOTH[tone];
                return (
                  <li key={tone} className="flex items-center gap-1 text-meta">
                    <span className={`flex size-5 items-center justify-center rounded ${className}`}>
                      <Icon className="size-3" aria-hidden />
                    </span>
                    {TOOTH_TONE_TEXT[tone]}
                  </li>
                );
              })}
              <li className="flex items-center gap-1 text-meta text-muted-foreground">
                <span className="size-5 rounded border border-dashed" aria-hidden />
                Not charted
              </li>
            </ul>
          </div>
          {noted.length ? (
            <ul className="flex flex-col gap-2" aria-label="Teeth with something noted">
              {noted.map((t) => {
                const tone = toothTone(t);
                const { icon: Icon, className } = TOOTH[tone];
                return (
                  <li key={t.tooth} className="flex items-start gap-3 rounded-xl border bg-card p-3">
                    <span className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${className}`}>
                      <Icon className="size-4" aria-hidden />
                    </span>
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="font-semibold">Tooth {toothText(t.tooth, record.notation)}</span>
                      <span className="text-body">
                        <span className="font-medium">{TOOTH_TONE_TEXT[tone]}:</span> {conditionsText(t)}
                      </span>
                      <span className="text-meta text-muted-foreground">Updated {formatCalendarDate(t.updatedOn)}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-body text-muted-foreground">Your dentist noted no problems on the teeth charted.</p>
          )}
        </>
      ) : (
        <EmptyState icon={SmileIcon} title="No tooth chart yet">
          After your dentist checks your teeth, the chart appears here.
        </EmptyState>
      )}
    </section>
  );
}
