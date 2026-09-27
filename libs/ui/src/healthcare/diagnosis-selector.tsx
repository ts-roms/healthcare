"use client";

import * as React from "react";
import { SearchIcon, StarIcon, XIcon } from "lucide-react";
import type { Diagnosis } from "@healthcare/domain";
import { Badge } from "../primitives/badge";
import { cn } from "../lib/utils";

export interface DiagnosisSelectorProps {
  catalog: { code: string; display: string }[];
  value: Diagnosis[];
  onChange: (value: Diagnosis[]) => void;
  placeholder?: string;
  className?: string;
}

/**
 * ICD-10 picker: type code or text, arrow keys + Enter to add.
 * First selection becomes primary; click the star to change primary.
 */
export function DiagnosisSelector({ catalog, value, onChange, placeholder = "Search ICD-10 code or diagnosis…", className }: DiagnosisSelectorProps) {
  const [query, setQuery] = React.useState("");
  const [active, setActive] = React.useState(0);
  const listId = React.useId();

  const results = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return catalog
      .filter((d) => !value.some((v) => v.code === d.code))
      .filter((d) => d.code.toLowerCase().startsWith(q) || d.display.toLowerCase().includes(q))
      .slice(0, 8);
  }, [catalog, query, value]);

  const add = (d: { code: string; display: string }) => {
    onChange([...value, { ...d, primary: value.length === 0 }]);
    setQuery("");
    setActive(0);
  };
  const remove = (code: string) => {
    const next = value.filter((v) => v.code !== code);
    if (next.length && !next.some((v) => v.primary)) next[0] = { ...next[0]!, primary: true };
    onChange(next);
  };
  const makePrimary = (code: string) => onChange(value.map((v) => ({ ...v, primary: v.code === code })));

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {value.length > 0 ? (
        <ul className="flex flex-wrap gap-1" aria-label="Selected diagnoses">
          {value.map((d) => (
            <li key={d.code}>
              <Badge variant={d.primary ? "info" : "outline"} className="gap-1.5 py-0.5 text-table">
                <button type="button" onClick={() => makePrimary(d.code)} aria-label={d.primary ? "Primary diagnosis" : `Make ${d.display} primary`}>
                  <StarIcon className={cn("size-3", d.primary ? "fill-current" : "opacity-40")} aria-hidden />
                </button>
                <span className="font-mono">{d.code}</span>
                <span className="font-normal">{d.display}</span>
                <button type="button" onClick={() => remove(d.code)} aria-label={`Remove ${d.display}`}>
                  <XIcon className="size-3" aria-hidden />
                </button>
              </Badge>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <input
          role="combobox"
          aria-expanded={results.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={results[active] ? `${listId}-${results[active].code}` : undefined}
          value={query}
          placeholder={placeholder}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, results.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter" && results[active]) {
              e.preventDefault();
              add(results[active]);
            } else if (e.key === "Escape") {
              setQuery("");
            }
          }}
          className="h-8 w-full rounded-md border border-input bg-card pr-2.5 pl-8 text-body shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40"
        />
        {results.length > 0 ? (
          <ul id={listId} role="listbox" className="absolute inset-x-0 top-full z-20 mt-1 max-h-64 overflow-auto rounded-md border bg-popover p-1 shadow-md">
            {results.map((d, i) => (
              <li
                key={d.code}
                id={`${listId}-${d.code}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => {
                  e.preventDefault();
                  add(d);
                }}
                onMouseEnter={() => setActive(i)}
                className={cn("flex cursor-pointer items-baseline gap-2 rounded-sm px-2 py-1 text-body", i === active && "bg-accent")}
              >
                <span className="w-14 shrink-0 font-mono text-table text-muted-foreground">{d.code}</span>
                {d.display}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
