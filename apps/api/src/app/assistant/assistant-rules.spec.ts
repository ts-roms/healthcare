import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AssistantRules } from "./assistant-rules";

/**
 * The rule registry as the API binds it (docs/domains/assistant.md, "Rules"). Every rule says what it reads and when it
 * can be wrong (phase 4: documented false positives), its starting values pass its own schema, and the domain notes list
 * it, so no rule ships undocumented. The bindings only close over the read queries, so building them reads nothing.
 */
const rules = new AssistantRules(...(Array.from({ length: 13 }, () => ({})) as unknown as ConstructorParameters<typeof AssistantRules>));
const definitions = rules.bindings.map((binding) => binding.definition);

/** A plain sentence: a capital first, a full stop last. */
const SENTENCE = /^[A-Z].*\.$/s;

describe("assistant rule registry", () => {
  it("binds each rule once, under an id the database accepts", () => {
    expect(definitions.length).toBeGreaterThan(0);
    const ids = definitions.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9][a-z0-9.-]{1,80}$/);
    for (const d of definitions) expect(Number.isInteger(d.version) && d.version >= 1).toBe(true);
  });

  it.each(definitions.map((d) => [d.id, d] as const))("%s: its starting values pass its schema and each has a label", (_id, definition) => {
    expect(definition.parametersSchema.safeParse(definition.defaultParameters).success).toBe(true);
    const defaults = Object.keys(definition.defaultParameters as Record<string, unknown>).sort();
    expect(Object.keys(definition.parameterLabels as Record<string, unknown>).sort()).toEqual(defaults);
  });

  it.each(definitions.map((d) => [d.id, d] as const))("%s: says what it reads, its known false positives and what it does not see", (_id, definition) => {
    expect(definition.reads).toMatch(SENTENCE);
    expect(definition.reads.length).toBeLessThanOrEqual(400);
    for (const list of [definition.knownFalsePositives, definition.blindSpots]) {
      expect(list.length).toBeGreaterThanOrEqual(1);
      expect(list.length).toBeLessThanOrEqual(6);
      expect(new Set(list).size).toBe(list.length);
      for (const item of list) {
        expect(item).toMatch(SENTENCE);
        expect(item.length).toBeLessThanOrEqual(240);
      }
    }
  });

  it("has a row in the domain notes' rules table for every rule", () => {
    const notes = readFileSync(join(__dirname, "../../../../../docs/domains/assistant.md"), "utf8");
    const missing = definitions.map((d) => d.id).filter((id) => !new RegExp(`^\\|\\s*\`${id.replace(/\./g, "\\.")}\``, "m").test(notes));
    expect(missing).toEqual([]);
  });
});
