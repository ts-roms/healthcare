import type * as React from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { MessagesSquareIcon, PlusIcon } from "lucide-react";
import { AskAnswerCard } from "@healthcare/ui/healthcare";
import { Button, Callout, Card, CardContent, CardHeader, CardTitle } from "@healthcare/ui/primitives";
import { FacilityRequired } from "@/components/facility-required";
import { ModulePage } from "@/components/module-page";
import { NextLink } from "@/components/next-link";
import { actionResult, type ActionResult } from "@/lib/api/action-result";
import { api } from "@/lib/api/client";
import { can, getSelectedFacility, getSession } from "@/lib/api/session";
import type { AskAnswer, AskHistory, AskQuestion } from "@/lib/api/types";
import { ASSISTANT_HOME } from "@/lib/assistant-areas";
import { ASK_HOME, askAnswerView, askHref, readAskParams, readChoice } from "@/lib/assistant-ask";
import { AskForm, AskHistoryProvider, YourQuestions } from "./ask-client";

export const metadata = { title: "Ask" };

const DETAILS = [
  "Ask matches your question to a fixed list of questions with built-in word rules. No AI model is used, and nothing leaves this system.",
  "Each answer comes from the screen that already shows that figure, with that screen's permissions: when your role cannot open it, the answer is not shown. The link under an answer opens the full figures.",
  "The words you type are read and dropped. Your questions keep only the question found, its dates, comparison and facility; remove any of them when you like.",
  "Ask never answers about one patient. To find a patient, use Patients.",
];

const NO_HISTORY: AskHistory = { saved: [], recent: [] };

/**
 * The assistant's Ask (docs/domains/assistant.md, "Ask"; ADR-0019): a question typed or chosen, answered from the
 * figures the person may already open. The address names the catalogue question and its period, never the words typed.
 */
export default async function AskPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [search, session, facility] = await Promise.all([searchParams, getSession(), getSelectedFacility()]);
  if (!can(session, "assistant.ask")) redirect(can(session, "assistant.use") ? ASSISTANT_HOME : "/");
  if (!facility) {
    return (
      <ModulePage title="Ask">
        <FacilityRequired action="Ask answers for the facility you work in." />
      </ModulePage>
    );
  }

  const asked = readAskParams(search);
  const choice = readChoice(search);
  const [questions, { answer, history }] = await Promise.all([
    actionResult(() => api<AskQuestion[]>("/assistant/ask/questions")),
    // The answer first: it adds itself to the person's questions, read next.
    (async () => {
      const answer = asked ? await actionResult(() => api<AskAnswer>("/assistant/ask/answer", { method: "POST", body: asked })) : null;
      return { answer, history: await actionResult(() => api<AskHistory>("/assistant/ask/history")) };
    })(),
  ]);

  const catalogue = questions.ok ? questions.data : [];
  const titles = new Map(catalogue.map((q) => [q.id, q.title]));
  const offered = catalogue.filter((q) => q.allowed);
  const notOffered = catalogue.length - offered.length;
  const choices = choice.questionIds.filter((id) => titles.has(id));

  // The answer on screen, when it was kept among the person's questions (withheld and unavailable answers are not).
  const entryId = answer?.ok ? (answer.data.entry?.id ?? null) : null;

  return (
    <ModulePage
      title="Ask"
      description={`Ask about figures you can already open at ${facility.name}. Built-in rules read your question: nothing leaves this system, and your words are not kept.`}
      details={DETAILS}
    >
      <AskHistoryProvider initial={history.ok ? history.data : NO_HISTORY} unavailable={!history.ok}>
        {/* Like a conversation: your questions on the left; examples, the answer and the question box on the right. */}
        <div className="grid items-start gap-4 lg:grid-cols-[17rem_minmax(0,1fr)]">
          <Card aria-labelledby="ask-yours" className="order-last lg:order-first">
            <CardHeader className="border-b-0 px-4 pt-4 pb-1">
              <CardTitle id="ask-yours" className="text-section">
                Your questions
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 px-4 pb-4">
              <Button asChild variant="outline" className="w-full">
                <Link href={ASK_HOME}>
                  <PlusIcon aria-hidden /> New question
                </Link>
              </Button>
              <YourQuestions />
            </CardContent>
          </Card>

          <Card className="min-w-0">
            <CardContent className="flex min-h-[32rem] flex-col gap-5 p-4 sm:p-5">
              <section aria-label="Questions you can ask" className="grid gap-2.5">
                {!questions.ok ? (
                  <p className="text-table text-muted-foreground">The list of questions could not be loaded just now.</p>
                ) : offered.length === 0 ? (
                  <p className="text-table text-muted-foreground">None of Ask&apos;s questions read figures your role can open.</p>
                ) : (
                  <>
                    <p className="text-body text-muted-foreground">Ask about your clinic&apos;s figures in your own words. Try one of these:</p>
                    <ul className="flex flex-wrap gap-2">
                      {offered.map((q) => {
                        const example = q.examples[0];
                        return (
                          <li key={q.id}>
                            <Button asChild variant="outline">
                              <AnswerLink
                                href={askHref({ questionId: q.id, period: example?.period, compare: example?.compare })}
                                title={example ? q.title : undefined}
                              >
                                {example?.text ?? q.title}
                              </AnswerLink>
                            </Button>
                          </li>
                        );
                      })}
                    </ul>
                  </>
                )}
                {notOffered > 0 ? (
                  <p className="text-table text-muted-foreground">
                    {notOffered === 1 ? "One more question reads" : `${notOffered} more questions read`} figures your role cannot open, so{" "}
                    {notOffered === 1 ? "it is" : "they are"} not offered.
                  </p>
                ) : null}
              </section>

              <div className="flex flex-1 flex-col gap-4">
                {choices.length > 0 ? (
                  <section aria-labelledby="ask-choose" className="grid gap-2 rounded-lg border border-border/70 p-4">
                    <h2 id="ask-choose" className="text-body font-semibold">
                      Which did you mean?
                    </h2>
                    <div className="flex flex-wrap gap-2">
                      {choices.map((id) => (
                        <Button key={id} asChild size="sm" variant="outline">
                          <AnswerLink href={askHref({ questionId: id, ...choice.reading })}>{titles.get(id)}</AnswerLink>
                        </Button>
                      ))}
                    </div>
                  </section>
                ) : null}
                {answer ? <Answer answer={answer} /> : null}
                {!answer && choices.length === 0 ? (
                  <div className="grid flex-1 place-items-center px-4 py-10 text-center">
                    <p className="flex max-w-sm flex-col items-center gap-2 text-table text-muted-foreground">
                      <MessagesSquareIcon className="size-6" aria-hidden />
                      Your answer appears here, with the dates, the facility and how the figures were worked out.
                    </p>
                  </div>
                ) : null}
              </div>

              {/* A new question asked starts the box afresh. */}
              <AskForm
                key={JSON.stringify(search)}
                organization={offered.some((q) => q.organization)}
                allFacilities={asked?.scope === "organization" || choice.reading.scope === "organization"}
                entryId={entryId}
              />
            </CardContent>
          </Card>
        </div>
      </AskHistoryProvider>
    </ModulePage>
  );
}

/**
 * A link to an answer of Ask, never prefetched: opening an answer asks its question (audited and kept among the
 * person's questions), which only following the link should do.
 */
function AnswerLink(props: { href: string; className?: string; title?: string; children?: React.ReactNode }) {
  return <Link {...props} prefetch={false} />;
}

/** The answer asked for in the address, or why it could not be given. */
function Answer({ answer }: { answer: ActionResult<AskAnswer> }) {
  if (!answer.ok) {
    return (
      <Callout tone="warning" title={answer.code === "not_found" ? "Ask does not answer that question." : "That question could not be answered just now."}>
        {answer.code === "not_found" ? "Choose one of the questions below." : answer.message}
      </Callout>
    );
  }
  return <AskAnswerCard answer={askAnswerView(answer.data)} Link={NextLink} />;
}
