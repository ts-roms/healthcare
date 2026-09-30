import { AlertTriangleIcon } from "lucide-react";
import { DateInput, Input, Label } from "@healthcare/ui/primitives";

export function FormError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger-subtle p-3 text-body text-danger-foreground">
      <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
      {message}
    </p>
  );
}

type FieldProps = React.ComponentProps<typeof Input> & { name: string; label: string; hint?: string; error?: string };

/** A labelled input with its hint and error announced to screen readers. */
export function Field({ name, label, hint, error, ...input }: FieldProps) {
  const described = [hint ? `${name}-hint` : null, error ? `${name}-error` : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={name} className="text-body">
        {label}
      </Label>
      {input.type === "date" ? (
        <DateInput
          id={name}
          name={name}
          aria-invalid={error ? true : undefined}
          aria-describedby={described}
          className="h-11 text-section"
          {...{ ...input, type: undefined, min: undefined, max: undefined }}
        />
      ) : (
        <Input id={name} name={name} aria-invalid={error ? true : undefined} aria-describedby={described} className="h-11 text-section" {...input} />
      )}
      {hint ? (
        <p id={`${name}-hint`} className="text-meta text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${name}-error`} className="flex items-center gap-1 text-meta font-medium text-danger-foreground">
          <AlertTriangleIcon className="size-3.5" aria-hidden />
          {error}
        </p>
      ) : null}
    </div>
  );
}
