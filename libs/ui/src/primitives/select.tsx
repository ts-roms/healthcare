import * as React from "react";
import { ChevronDownIcon } from "lucide-react";
import { cn } from "../lib/utils";

/** Default text shown by a select that has nothing to choose from. */
export const SELECT_EMPTY_TEXT = "No data available";

type OptionProps = { value?: unknown; disabled?: boolean; children?: React.ReactNode };

function optionValue(option: React.ReactElement<OptionProps>): string {
  return String(option.props.value ?? React.Children.toArray(option.props.children).join(""));
}

/** A disabled option with an empty value is a prompt ("Select a facility"), never a choice. */
function isPrompt(child: React.ReactNode): boolean {
  return React.isValidElement<OptionProps>(child) && child.type === "option" && !!child.props.disabled && optionValue(child) === "";
}

/**
 * True when the children hold at least one option a user can actually pick:
 * an `<option>` with a non-empty value (placeholders such as "Choose…" use
 * `value=""`). Fragments and `<optgroup>`s are looked into; any other element
 * is assumed to render options and counts as data.
 */
export function hasSelectableOptions(children: React.ReactNode): boolean {
  return React.Children.toArray(children).some((child) => {
    if (!React.isValidElement<OptionProps>(child)) return false;
    if (child.type === React.Fragment || child.type === "optgroup") return hasSelectableOptions(child.props.children);
    if (child.type !== "option") return true;
    return optionValue(child) !== "";
  });
}

type NativeSelectProps = React.ComponentProps<"select"> & {
  /** Prompt shown as the first option with an empty value (e.g. "Choose…"). Replaced by `emptyText` when there is nothing to choose. */
  placeholder?: string;
  /**
   * Shown as the only option when there are no options to choose from
   * (placeholder options with `value=""` do not count). Defaults to
   * "No data available".
   */
  emptyText?: string;
};

/**
 * Native select styled to match inputs. Native is faster for keyboard-heavy
 * staff workflows (type-ahead, no portal) and works everywhere.
 *
 * When there is nothing to choose (e.g. an API returned no rows) the select
 * says so with `emptyText`: it replaces the `placeholder` (or a disabled
 * empty-value prompt option) when there are no other options, and is added as a disabled line below options that carry a
 * meaning of their own with an empty value ("None", "All facilities"). The
 * field still submits "" and `required` still blocks submission.
 */
function NativeSelect({ className, children, placeholder, emptyText = SELECT_EMPTY_TEXT, ...props }: NativeSelectProps) {
  const empty = !hasSelectableOptions(children);
  const hasOwnOptions = React.Children.toArray(children).some((child) => !isPrompt(child));
  return (
    <div className={cn("relative inline-flex", className)}>
      <select
        data-slot="native-select"
        data-empty={empty || undefined}
        className="h-8 w-full appearance-none rounded-md border border-input bg-card py-1 pr-7 pl-2.5 text-body shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:opacity-50 data-[empty]:text-muted-foreground"
        {...props}
      >
        {empty && !hasOwnOptions ? (
          <option value="">{emptyText}</option>
        ) : (
          <>
            {placeholder !== undefined && <option value="">{empty ? emptyText : placeholder}</option>}
            {children}
            {empty && (
              <option value="" disabled>
                {emptyText}
              </option>
            )}
          </>
        )}
      </select>
      <ChevronDownIcon aria-hidden className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
}

export { NativeSelect };
