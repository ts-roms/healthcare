"use client";

import * as React from "react";
import Link from "next/link";
import { MessageCircleQuestionMarkIcon, StarIcon, XIcon } from "lucide-react";
import { Button, Callout, Checkbox, Input, Label } from "@healthcare/ui/primitives";
import type { ActionResult } from "@/lib/api/action-result";
import type { AskHistory, AskHistoryItem } from "@/lib/api/types";
import { hrefForEntry } from "@/lib/assistant-ask";
import { useServerAction } from "@/lib/use-server-action";
import { askQuestion, type AskFormState, changeAskedQuestion, clearAskedQuestions } from "./actions";

/**
 * The question box of the assistant's Ask. The words typed go to a server action in the request body and never into
 * the address; a question that was not recognised keeps them in the box so it can be asked another way.
 */
export function AskForm({ organization, allFacilities }: { organization: boolean; allFacilities: boolean }) {
  const [state, dispatch, pending] = React.useActionState(askQuestion, {} as AskFormState);
  // Dispatched by hand rather than as the form's action, so a question not recognised keeps its words and ticks.
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    React.startTransition(() => dispatch(data));
  };
  return (
    <form onSubmit={submit} className="grid gap-3">
      <div className="grid gap-1.5">
        <Label htmlFor="ask-text">Your question</Label>
        <div className="flex flex-wrap gap-2">
          <Input
            id="ask-text"
            name="text"
            maxLength={200}
            required
            autoComplete="off"
            placeholder="e.g. No-shows last week"
            aria-describedby="ask-hint"
            className="h-10 min-w-64 flex-1"
          />
          <Button type="submit" size="lg" disabled={pending}>
            <MessageCircleQuestionMarkIcon /> {pending ? "Reading…" : "Ask"}
          </Button>
        </div>
        <p id="ask-hint" className="text-meta text-muted-foreground">
          Ask about figures, not patients. Your words are read and dropped: only the question found and its dates are kept.
        </p>
      </div>
      {organization ? (
        <div className="flex items-center gap-2">
          <Checkbox id="ask-all-facilities" name="allFacilities" value="1" defaultChecked={allFacilities} />
          <Label htmlFor="ask-all-facilities" className="text-body font-normal">
            Answer for all facilities I report on
          </Label>
        </div>
      ) : null}
      {state.unrecognised ? (
        <Callout tone="info" title="I did not recognise that question.">
          Ask answers the questions listed below, asked in your own words. It does not look up patients: find a patient under Patients.
        </Callout>
      ) : null}
      {state.message ? (
        <Callout tone="warning" title="That question could not be read just now.">
          {state.message}
        </Callout>
      ) : null}
    </form>
  );
}

type HistoryState = { history: AskHistory; setHistory: (history: AskHistory) => void; unavailable: boolean };
const HistoryContext = React.createContext<HistoryState | null>(null);

function useAskHistory(): HistoryState {
  const value = React.useContext(HistoryContext);
  if (!value) throw new Error("useAskHistory needs AskHistoryProvider");
  return value;
}

/**
 * The person's questions, shared by the answer's Save button and "Your questions". Saving or removing changes this
 * list only: refreshing the page would ask the question on screen again (and audit it again).
 */
export function AskHistoryProvider({ initial, unavailable, children }: { initial: AskHistory; unavailable: boolean; children: React.ReactNode }) {
  const [history, setHistory] = React.useState(initial);
  // Another question asked brings the list as the server has it now.
  const [shown, setShown] = React.useState(initial);
  if (shown !== initial) {
    setShown(initial);
    setHistory(initial);
  }
  const value = React.useMemo(() => ({ history, setHistory, unavailable }), [history, unavailable]);
  return <HistoryContext.Provider value={value}>{children}</HistoryContext.Provider>;
}

/** Runs a change to the person's questions and keeps the list it answers. */
function useHistoryChange() {
  const { setHistory } = useAskHistory();
  const { pending, run } = useServerAction({ refresh: () => undefined });
  const change = (call: () => Promise<ActionResult<AskHistory>>, success: string) =>
    run(async () => {
      const result = await call();
      if (result.ok) setHistory(result.data);
      return result;
    }, success);
  return { pending, change };
}

const SAVED = "Question saved.";
const UNSAVED = "Removed from your saved questions.";

/** Saves the question answered on screen among the person's questions, or stops saving it. */
export function SaveAnswer({ entryId }: { entryId: string }) {
  const { history } = useAskHistory();
  const { pending, change } = useHistoryChange();
  const saved = history.saved.some((e) => e.id === entryId);
  // Removed from the list meanwhile: nothing to save.
  if (!saved && !history.recent.some((e) => e.id === entryId)) return null;
  return (
    <Button
      size="sm"
      variant="outline"
      aria-label={saved ? "Saved: stop saving this question" : "Save this question"}
      disabled={pending}
      onClick={() => change(() => changeAskedQuestion({ id: entryId, change: saved ? "unsave" : "save" }), saved ? UNSAVED : SAVED)}
    >
      <StarIcon className={saved ? "fill-current" : undefined} aria-hidden /> {saved ? "Saved" : "Save"}
    </Button>
  );
}

/** "Your questions": saved ones, then recent ones, each asked again by its link. Never the words typed. */
export function YourQuestions() {
  const { history, unavailable } = useAskHistory();
  const { pending, change } = useHistoryChange();
  if (unavailable) return <p className="text-table text-muted-foreground">Your questions could not be loaded just now.</p>;
  if (history.saved.length === 0 && history.recent.length === 0) {
    return (
      <p className="text-table text-muted-foreground">
        Questions you ask appear here. Only the question, its dates and facility are kept, never the words you typed.
      </p>
    );
  }
  return (
    <div className="grid gap-4">
      {history.saved.length > 0 ? (
        <section aria-labelledby="ask-saved" className="grid gap-1">
          <h3 id="ask-saved" className="text-table font-medium text-muted-foreground">
            Saved
          </h3>
          <QuestionList entries={history.saved} pending={pending} change={change} />
        </section>
      ) : null}
      {history.recent.length > 0 ? (
        <section aria-labelledby="ask-recent" className="grid gap-1">
          <div className="flex items-center justify-between gap-2">
            <h3 id="ask-recent" className="text-table font-medium text-muted-foreground">
              Recent
            </h3>
            <Button size="xs" variant="ghost" disabled={pending} onClick={() => change(() => clearAskedQuestions(), "Recent questions cleared.")}>
              Clear recent
            </Button>
          </div>
          <QuestionList entries={history.recent} pending={pending} change={change} />
        </section>
      ) : null}
    </div>
  );
}

function QuestionList({ entries, pending, change }: { entries: AskHistoryItem[]; pending: boolean; change: ReturnType<typeof useHistoryChange>["change"] }) {
  return (
    <ul className="grid gap-0.5">
      {entries.map((entry) => {
        const saved = entry.savedAt !== null;
        return (
          <li key={entry.id} className="flex items-start gap-1 rounded-md hover:bg-muted/60">
            {/* Never prefetched: opening an answer asks its question again (audited). */}
            <Link href={hrefForEntry(entry)} prefetch={false} className="min-w-0 flex-1 px-2 py-1.5 text-body hover:underline">
              {entry.label}
            </Link>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={saved ? `Stop saving ${entry.label}` : `Save ${entry.label}`}
              disabled={pending}
              onClick={() => change(() => changeAskedQuestion({ id: entry.id, change: saved ? "unsave" : "save" }), saved ? UNSAVED : SAVED)}
            >
              <StarIcon className={saved ? "fill-current" : undefined} aria-hidden />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={`Remove ${entry.label}`}
              disabled={pending}
              onClick={() => change(() => changeAskedQuestion({ id: entry.id, change: "remove" }), "Question removed.")}
            >
              <XIcon aria-hidden />
            </Button>
          </li>
        );
      })}
    </ul>
  );
}
