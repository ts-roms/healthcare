"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BookOpenIcon, CommandIcon, LayoutGridIcon, SearchIcon, UserRoundIcon } from "lucide-react";
import { Button, Dialog, DialogContent, DialogDescription, DialogTitle, Input, searchManual, type ManualSection } from "@healthcare/ui/primitives";
import { findPatientsForCommand } from "@/app/(staff)/command-actions";
import { todayIn } from "@/lib/clinic-mapping";
import { commandItems, commandScreens, parseCommand, type CommandGroup, type CommandItem, type CommandPatient } from "@/lib/command-bar";

const GROUP_ICON: Record<CommandGroup, typeof SearchIcon> = { Patients: UserRoundIcon, Screens: LayoutGridIcon, Help: BookOpenIcon, Search: SearchIcon };

/** Wait this long after typing stops before searching patients (each search is audited). */
const SEARCH_DELAY_MS = 400;

const EXAMPLES = ["book Reyes tomorrow", "lab verify", "appointments friday", "Santos billing", "stock expiring"];

/**
 * The command bar (Ctrl+K or ⌘K, or the top bar's button): type where to go or what to do — a screen, a patient's name or
 * number, an action and a day — and open the result. The words are read by `lib/command-bar.ts` (fixed word lists); only
 * screens and actions the person may open are offered, and every item is a link.
 */
export function CommandBar({
  permissions,
  platformAdmin = false,
  timeZone,
  manualSections,
}: {
  permissions: readonly string[];
  platformAdmin?: boolean;
  /** The facility's, for "today" and "tomorrow". */
  timeZone: string | null;
  manualSections: readonly ManualSection[];
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [text, setText] = React.useState("");
  const [active, setActive] = React.useState(0);
  const [found, setFound] = React.useState<{ query: string; patients: CommandPatient[] } | null>(null);
  const [searching, setSearching] = React.useState<string | null>(null);
  const latest = React.useRef(0);
  const listId = React.useId();

  const screens = React.useMemo(() => commandScreens(permissions, { platformAdmin }), [permissions, platformAdmin]);
  const parsed = React.useMemo(() => parseCommand(text, todayIn(timeZone ?? "Asia/Manila"), screens), [text, timeZone, screens]);
  const help = React.useMemo(() => (text.trim().length >= 3 ? searchManual(manualSections, text, 2) : []), [text, manualSections]);
  const query = permissions.includes("patient.search") && parsed.patientQuery.length >= 3 ? parsed.patientQuery : "";

  // Patients, once typing pauses; a newer search makes an older answer moot.
  React.useEffect(() => {
    if (!open || !query || found?.query === query) return;
    const request = ++latest.current;
    const timer = setTimeout(() => {
      setSearching(query);
      void findPatientsForCommand(query).then((result) => {
        if (request !== latest.current) return;
        setSearching(null);
        setFound({ query, patients: result.ok ? result.data : [] });
      });
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [open, query, found?.query]);

  const patients = found && found.query === query ? found.patients : [];
  const items = text.trim() ? commandItems(parsed, { screens, patients, help, permissions }) : [];
  const current = items.length ? Math.min(active, items.length - 1) : -1;

  // Ctrl+K or ⌘K anywhere opens it (and closes it again).
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const reset = () => {
    setText("");
    setActive(0);
  };
  const close = () => {
    setOpen(false);
    reset();
  };
  const go = (item: CommandItem) => {
    close();
    router.push(item.href);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!items.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((current + 1) % items.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((current - 1 + items.length) % items.length);
    } else if (e.key === "Enter" && items[current]) {
      e.preventDefault();
      go(items[current]);
    }
  };

  const optionId = (i: number) => `${listId}-option-${i}`;

  return (
    <>
      <Button variant="ghost" size="icon" aria-label="Go to a screen or patient (Ctrl+K)" title="Go to… (Ctrl+K, ⌘K on a Mac)" onClick={() => setOpen(true)}>
        <CommandIcon />
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) reset();
        }}
      >
        <DialogContent className="top-[10%] translate-y-0 gap-0 p-0 sm:max-w-xl">
          <DialogTitle className="sr-only">Go to</DialogTitle>
          <DialogDescription className="sr-only">
            Type a screen, a patient&apos;s name or number, or what to do and when, such as book Reyes tomorrow. Use the arrow keys to choose and Enter to open.
          </DialogDescription>
          <div className="flex items-center gap-2 border-b py-2 pr-10 pl-3">
            <SearchIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <Input
              role="combobox"
              aria-label="Go to"
              aria-expanded={items.length > 0}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={current >= 0 ? optionId(current) : undefined}
              autoFocus
              autoComplete="off"
              spellCheck={false}
              value={text}
              placeholder="Where to, or what to do?"
              className="h-9 border-0 px-0 shadow-none focus-visible:ring-0"
              onChange={(e) => {
                setText(e.target.value);
                setActive(0);
              }}
              onKeyDown={onKeyDown}
            />
          </div>
          <div id={listId} role="listbox" aria-label="Results" className="max-h-[60vh] overflow-y-auto p-2">
            {items.map((item, i) => {
              // A heading where a group starts.
              const header = items[i - 1]?.group !== item.group ? item.group : null;
              const Icon = GROUP_ICON[item.group];
              return (
                <React.Fragment key={item.id}>
                  {header ? (
                    <div aria-hidden className="px-2 pt-2 pb-1 text-meta font-semibold tracking-wide text-muted-foreground uppercase">
                      {header}
                    </div>
                  ) : null}
                  <Link
                    id={optionId(i)}
                    role="option"
                    aria-selected={i === current}
                    tabIndex={-1}
                    href={item.href}
                    onClick={close}
                    onMouseMove={() => setActive(i)}
                    className={`flex items-start gap-2 rounded-md px-2 py-1.5 text-table outline-none ${i === current ? "bg-accent text-accent-foreground" : ""}`}
                  >
                    <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="min-w-0">
                      <span className="block truncate">{item.label}</span>
                      {item.detail ? <span className="block truncate text-meta text-muted-foreground">{item.detail}</span> : null}
                    </span>
                  </Link>
                </React.Fragment>
              );
            })}
            {!text.trim() ? (
              <p className="px-2 py-3 text-table text-muted-foreground">
                Try:{" "}
                {EXAMPLES.map((e, i) => (
                  <React.Fragment key={e}>
                    {i ? ", " : ""}
                    <span className="font-mono text-foreground">{e}</span>
                  </React.Fragment>
                ))}
                .
              </p>
            ) : items.length === 0 ? (
              <p className="px-2 py-3 text-table text-muted-foreground">
                {searching ? "Looking for patients…" : "Nothing matches. Try a patient's name or number, or a screen such as “billing”."}
              </p>
            ) : null}
          </div>
          <p aria-live="polite" className="border-t px-3 py-1.5 text-meta text-muted-foreground">
            {searching ? `Looking for patients matching “${searching}”… ` : ""}↑ ↓ to choose · Enter to open · Esc to close
          </p>
        </DialogContent>
      </Dialog>
    </>
  );
}
