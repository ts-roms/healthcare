"use client";

import * as React from "react";
import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { ArrowUpIcon, Loader2Icon, Maximize2Icon, Minimize2Icon, SquarePenIcon, TriangleAlertIcon, XIcon } from "lucide-react";
import { AskAnswerCard } from "@healthcare/ui/healthcare";
import { cn } from "@healthcare/ui/lib/utils";
import { Button, Input, Popover, PopoverContent, PopoverTrigger } from "@healthcare/ui/primitives";
import { answerInChat, askInChat, type AskChatExample, type AskChatReply, loadAskExamples } from "@/app/(staff)/assistant/ask/actions";
import { ASK_HOME } from "@/lib/assistant-ask";
import { AssistantMark } from "./assistant-mark";
import { NextLink } from "./next-link";

type ChatMessage = { id: number; from: "you"; text: string } | { id: number; from: "ask"; reply: AskChatReply };
/** The examples: not asked for yet, on their way, loaded, or not loaded (asked for again at the next opening). */
type ExamplesState = AskChatExample[] | "loading" | "failed" | null;

/** Messages kept on screen; older ones drop off the top. */
const MAX_MESSAGES = 30;
/** Examples offered in an empty chat and after a question that was not recognised. */
const EXAMPLES_SHOWN = 6;
const COULD_NOT_REACH: AskChatReply = { kind: "error", message: "Ask could not be reached just now. Try again in a moment." };

/**
 * The assistant's Ask as a chat (docs/domains/assistant.md, "Ask"): a button at the bottom-right of every staff page
 * (from `md` up) that opens a conversation panel. Questions are read and answered by the same server actions and API
 * routes as the Ask page — the words go only to the reading, which keeps nothing, and each answer is asked by question id
 * and period, audited and kept among the person's questions. The conversation lives in this component's memory only:
 * it survives moving between pages, never browser storage, and is gone after a reload or **New chat**.
 */
export function AskChat({ facilityName }: { facilityName: string | null }) {
  const pathname = usePathname();
  const [open, setOpen] = React.useState(false);
  /** Larger panel (the header's arrows): more room for an answer's table; kept until changed back. */
  const [expanded, setExpanded] = React.useState(false);
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [examples, setExamples] = React.useState<ExamplesState>(null);
  const [text, setText] = React.useState("");
  const [pending, startTransition] = React.useTransition();
  const nextId = React.useRef(0);
  const inputRef = React.useRef<HTMLInputElement>(null);

  // An answer's link opens another screen: the panel closes there and the conversation waits for the next opening.
  const [shownOn, setShownOn] = React.useState(pathname);
  if (shownOn !== pathname) {
    setShownOn(pathname);
    setOpen(false);
  }

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (next && (examples === null || examples === "failed")) {
      setExamples("loading");
      void loadAskExamples().then(
        (result) => setExamples(result.ok ? result.data : "failed"),
        () => setExamples("failed"),
      );
    }
  };

  const add = (message: { from: "you"; text: string } | { from: "ask"; reply: AskChatReply }) => {
    const id = nextId.current++;
    setMessages((current) => [...current, { ...message, id }].slice(-MAX_MESSAGES));
  };

  /** Shows what was asked as the person's message, then Ask's reply. */
  const ask = (said: string, send: () => Promise<AskChatReply>, typed = false) => {
    if (pending) return;
    add({ from: "you", text: said });
    startTransition(async () => {
      const reply = await send().catch(() => COULD_NOT_REACH);
      add({ from: "ask", reply });
      // Not recognised: the words go back in the box so the question can be asked another way.
      if (typed && reply.kind === "unrecognised") setText(said);
      inputRef.current?.focus();
    });
  };

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const said = text.trim();
    if (!said || pending || !facilityName) return;
    setText("");
    ask(said, () => askInChat(said), true);
  };

  const askExample = (example: AskChatExample) =>
    ask(example.text, () => answerInChat({ questionId: example.questionId, period: example.period, compare: example.compare }));

  // The Ask page is the same conversation on a whole screen: no button over its own question box.
  if (pathname === ASK_HOME) return null;

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          aria-label="Ask a question"
          title="Ask about your clinic's figures"
          className="fixed right-[max(1rem,env(safe-area-inset-right))] bottom-[max(1rem,env(safe-area-inset-bottom))] z-30 hidden h-11 gap-2 rounded-full pr-5 pl-2 text-section shadow-lg md:inline-flex"
        >
          <AssistantMark onPrimary />
          Ask
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        sideOffset={10}
        aria-labelledby="ask-chat-title"
        // A chat stays open while the page behind it is used; Escape, the close button or the launcher close it.
        onInteractOutside={(event) => event.preventDefault()}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          inputRef.current?.focus();
        }}
        className={cn(
          "flex flex-col overflow-hidden p-0 transition-[width,height] duration-200",
          expanded ? "h-[calc(100dvh-6.5rem)] w-[min(56rem,calc(100vw-2rem))]" : "h-[min(40rem,calc(100dvh-6.5rem))] w-[min(27rem,calc(100vw-2rem))]",
        )}
      >
        <header className="flex items-center gap-2.5 border-b px-3.5 py-2.5">
          <AssistantMark />
          <div className="min-w-0 flex-1 leading-tight">
            <h2 id="ask-chat-title" className="text-body font-semibold">
              Ask
            </h2>
            <p className="truncate text-meta text-muted-foreground">{facilityName ? `Figures at ${facilityName}` : "Select your facility first"}</p>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="New chat"
            title="New chat"
            disabled={messages.length === 0 || pending}
            onClick={() => {
              setMessages([]);
              setText("");
              inputRef.current?.focus();
            }}
          >
            <SquarePenIcon aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={expanded ? "Make the chat smaller" : "Make the chat larger"}
            title={expanded ? "Smaller" : "Larger"}
            onClick={() => {
              setExpanded((current) => !current);
              inputRef.current?.focus();
            }}
          >
            {expanded ? <Minimize2Icon aria-hidden /> : <Maximize2Icon aria-hidden />}
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Close Ask" title="Close" onClick={() => setOpen(false)}>
            <XIcon aria-hidden />
          </Button>
        </header>

        <Conversation messages={messages} pending={pending}>
          {messages.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 py-6 text-center">
              <AssistantMark size="lg" />
              <div className="grid gap-1">
                <p className="text-page-sm font-semibold">Ask</p>
                <p className="mx-auto max-w-xs text-table text-muted-foreground">
                  Ask about your clinic&apos;s figures in your own words: no-shows, waiting times, revenue, stock and more.
                </p>
              </div>
              {facilityName ? (
                <Examples examples={examples} disabled={pending} onPick={askExample} centered />
              ) : (
                <p className="text-table text-muted-foreground">Select your facility in the top bar: Ask answers for the facility you work in.</p>
              )}
            </div>
          ) : (
            messages.map((message) =>
              message.from === "you" ? (
                <YourMessage key={message.id} text={message.text} />
              ) : (
                <AskMessage key={message.id}>
                  <Reply id={message.id} reply={message.reply} examples={examples} disabled={pending} onAsk={ask} onPick={askExample} />
                </AskMessage>
              ),
            )
          )}
        </Conversation>

        <form onSubmit={submit} className="grid gap-1.5 border-t px-3.5 pt-3 pb-3">
          <div className="flex gap-2">
            <Input
              ref={inputRef}
              aria-label="Question for Ask"
              aria-describedby="ask-chat-hint"
              value={text}
              onChange={(event) => setText(event.target.value)}
              maxLength={200}
              autoComplete="off"
              disabled={!facilityName}
              placeholder="e.g. No-shows last week"
              className="h-10 flex-1"
            />
            <Button type="submit" size="icon" className="size-10" aria-label="Send" disabled={pending || !text.trim() || !facilityName}>
              <ArrowUpIcon aria-hidden />
            </Button>
          </div>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-meta text-muted-foreground">
            <p id="ask-chat-hint">Figures, never patients. Your words are read and dropped.</p>
            {/* The whole page: saved questions, and answers for all facilities. */}
            <Link href={ASK_HOME} className="inline-flex items-center gap-1 font-medium text-primary underline-offset-2 hover:underline">
              Open the Ask page
              <Opening />
            </Link>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}

/** A spinner beside the Ask page's link while it opens (the page asks the API first, and is compiled on first use in development). */
function Opening() {
  const { pending } = useLinkStatus();
  return <Loader2Icon aria-hidden className={cn("size-3 animate-spin transition-opacity", pending ? "opacity-100" : "opacity-0")} />;
}

/** The scrolling list of messages; a new reply is scrolled to its start, so a long answer is read from the top. */
function Conversation({ messages, pending, children }: { messages: ChatMessage[]; pending: boolean; children: React.ReactNode }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const last = messages.at(-1);
  React.useEffect(() => {
    const list = ref.current;
    if (!list) return;
    const item = list.lastElementChild as HTMLElement | null;
    if (last?.from === "ask" && !pending && item) list.scrollTo({ top: item.offsetTop - 12 });
    else list.scrollTo({ top: list.scrollHeight });
  }, [last?.id, last?.from, pending]);
  return (
    <div ref={ref} role="log" aria-label="Conversation with Ask" className="relative flex flex-1 flex-col gap-3 overflow-y-auto px-3.5 py-3">
      {children}
      {pending ? (
        <AskMessage>
          <p className="inline-flex items-center gap-1.5 rounded-2xl rounded-tl-md bg-muted px-3 py-2 text-table text-muted-foreground">
            Reading your question
            <span className="inline-flex gap-0.5" aria-hidden>
              <span className="size-1 animate-bounce rounded-full bg-current [animation-delay:-0.3s]" />
              <span className="size-1 animate-bounce rounded-full bg-current [animation-delay:-0.15s]" />
              <span className="size-1 animate-bounce rounded-full bg-current" />
            </span>
          </p>
        </AskMessage>
      ) : null}
    </div>
  );
}

function YourMessage({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <p className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-3 py-2 text-body break-words text-primary-foreground">
        <span className="sr-only">You: </span>
        {text}
      </p>
    </div>
  );
}

function AskMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <AssistantMark size="xs" className="mt-0.5" />
      <div className="grid min-w-0 flex-1 justify-items-start gap-2">{children}</div>
    </div>
  );
}

function Bubble({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-1 rounded-2xl rounded-tl-md bg-muted px-3 py-2 text-table">{children}</div>;
}

function Reply({
  id,
  reply,
  examples,
  disabled,
  onAsk,
  onPick,
}: {
  id: number;
  reply: AskChatReply;
  examples: ExamplesState;
  disabled: boolean;
  onAsk: (said: string, send: () => Promise<AskChatReply>) => void;
  onPick: (example: AskChatExample) => void;
}) {
  switch (reply.kind) {
    case "answer":
      return <AskAnswerCard answer={reply.answer} Link={NextLink} id={`ask-chat-${id}`} className="w-full p-3" />;
    case "choose":
      return (
        <>
          <Bubble>
            <p>Which did you mean?</p>
          </Bubble>
          <div className="flex flex-wrap gap-1.5">
            {reply.candidates.map((c) => (
              <Button
                key={c.id}
                size="sm"
                variant="outline"
                disabled={disabled}
                onClick={() => onAsk(c.title, () => answerInChat({ questionId: c.id, ...reply.reading }))}
              >
                {c.title}
              </Button>
            ))}
          </div>
        </>
      );
    case "unrecognised":
      return (
        <>
          <Bubble>
            <p className="font-medium">I did not recognise that question.</p>
            <p className="text-muted-foreground">
              Ask answers questions about your clinic&apos;s figures, in your own words. It does not look up patients: find a patient under Patients.
            </p>
          </Bubble>
          <Examples examples={examples} disabled={disabled} onPick={onPick} />
        </>
      );
    case "error":
      return (
        <Bubble>
          <p className="flex items-start gap-1.5">
            <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0 text-warning-foreground" aria-hidden />
            {reply.message}
          </p>
        </Bubble>
      );
  }
}

/** Example questions as chips; each asks its question directly (never the words, only its id and period). */
function Examples({
  examples,
  disabled,
  onPick,
  centered = false,
}: {
  examples: ExamplesState;
  disabled: boolean;
  onPick: (example: AskChatExample) => void;
  centered?: boolean;
}) {
  if (examples === "loading" || examples === null) return <p className="text-meta text-muted-foreground">Loading examples…</p>;
  if (examples === "failed") return <p className="text-meta text-muted-foreground">The examples could not be loaded just now; type your question below.</p>;
  if (examples.length === 0) return <p className="text-meta text-muted-foreground">None of Ask&apos;s questions read figures your role can open.</p>;
  return (
    <ul aria-label="Questions you can ask" className={`flex flex-wrap gap-1.5 ${centered ? "justify-center" : ""}`}>
      {examples.slice(0, EXAMPLES_SHOWN).map((example) => (
        <li key={example.questionId}>
          <Button size="sm" variant="outline" className="rounded-full" title={example.title} disabled={disabled} onClick={() => onPick(example)}>
            {example.text}
          </Button>
        </li>
      ))}
    </ul>
  );
}
