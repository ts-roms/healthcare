import { createElement as h, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { hasSelectableOptions, NativeSelect } from "./select";

const options = (select: string) =>
  [...select.matchAll(/<option([^>]*)>([^<]*)<\/option>/g)].map(([, attrs, text]) => ({ text, disabled: attrs.includes("disabled") }));
const render = (props: Record<string, unknown>, ...children: unknown[]) =>
  renderToStaticMarkup(h(NativeSelect, { value: "", onChange: () => undefined, ...props }, ...(children as [])));

describe("hasSelectableOptions", () => {
  it("does not count options with an empty value", () => {
    expect(hasSelectableOptions([h("option", { key: "p", value: "" }, "Choose…")])).toBe(false);
    expect(hasSelectableOptions([])).toBe(false);
  });

  it("counts options with a value, inside fragments and groups too", () => {
    expect(hasSelectableOptions(h("option", { value: "a" }, "A"))).toBe(true);
    expect(hasSelectableOptions(h(Fragment, null, h("optgroup", { label: "G" }, h("option", { value: "a" }, "A"))))).toBe(true);
    expect(hasSelectableOptions(h("option", null, "Label as value"))).toBe(true);
  });
});

describe("NativeSelect", () => {
  it("shows the placeholder before the options when there are some", () => {
    expect(options(render({ placeholder: "Choose…" }, h("option", { key: "a", value: "a" }, "A")))).toEqual([
      { text: "Choose…", disabled: false },
      { text: "A", disabled: false },
    ]);
  });

  it("says there is no data instead of the placeholder when the list is empty", () => {
    expect(options(render({ placeholder: "Choose…" }, []))).toEqual([{ text: "No data available", disabled: false }]);
  });

  it("replaces a disabled prompt option when the list is empty", () => {
    expect(options(render({}, h("option", { key: "p", value: "", disabled: true }, "Select a facility"), []))).toEqual([
      { text: "No data available", disabled: false },
    ]);
  });

  it("keeps an empty-value choice with a meaning of its own and adds the empty text below it", () => {
    expect(options(render({ emptyText: "--No records--" }, h("option", { key: "n", value: "" }, "None"), []))).toEqual([
      { text: "None", disabled: false },
      { text: "--No records--", disabled: true },
    ]);
  });

  it("marks an empty select for styling", () => {
    expect(render({}, [])).toContain("data-empty");
    expect(render({}, h("option", { key: "a", value: "a" }, "A"))).not.toContain("data-empty");
  });
});
