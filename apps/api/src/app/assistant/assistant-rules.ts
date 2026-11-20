import { Injectable } from "@nestjs/common";
import { type Actor, type RuleDefinition, type Suggestion, todayInPhilippines } from "@healthcare/core";
import { DAYS_OF_COVER_RULE, daysOfCoverSuggestions, InventoryAssistantQueries } from "@healthcare/inventory";

/**
 * A rule with the means to load what it reads. Rules are pure and live in their domain; this is where the API, the
 * composition root, connects them to that domain's read query (docs/architecture/heuristic-assistant.md).
 */
export interface RuleBinding {
  definition: RuleDefinition<unknown>;
  /** `parameters` is the stored setting, checked against the rule's schema by the service before it runs. */
  run(actor: Actor, facilityId: string, parameters: unknown): Promise<Suggestion[]>;
}

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class AssistantRules {
  readonly bindings: readonly RuleBinding[];

  constructor(inventory: InventoryAssistantQueries) {
    this.bindings = [
      {
        // The rule's parameters are typed in its own module; the binding hands them back through its schema.
        definition: DAYS_OF_COVER_RULE as RuleDefinition<unknown>,
        run: async (actor, facilityId, raw) => {
          const params = DAYS_OF_COVER_RULE.parametersSchema.parse(raw);
          const since = new Date(Date.now() - params.windowDays * DAY_MS);
          const inputs = await inventory.coverInputs(actor.organizationId, facilityId, since, todayInPhilippines());
          return daysOfCoverSuggestions(inputs, params);
        },
      },
    ];
  }

  find(ruleId: string): RuleBinding | undefined {
    return this.bindings.find((b) => b.definition.id === ruleId);
  }
}
