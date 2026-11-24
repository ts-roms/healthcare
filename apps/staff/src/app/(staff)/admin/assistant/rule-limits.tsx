import type { AssistantRuleLimits } from "@/lib/api/types";

/**
 * What a rule reads and when it can be wrong, as documented with the rule (docs/domains/assistant.md, "Known false
 * positives"): shown where an administrator decides to turn it on and where they review it. Plain text from the rule's
 * definition; the organization's own findings are its reviews.
 */
export function RuleLimits({ limits }: { limits: AssistantRuleLimits }) {
  return (
    <div className="grid gap-3 text-table">
      <div>
        <p className="font-medium text-foreground">What it reads</p>
        <p>{limits.reads}</p>
      </div>
      <div>
        <p className="font-medium text-foreground">Known false positives</p>
        <p className="text-meta text-muted-foreground">It may speak though nothing needs doing:</p>
        <ul className="mt-1 list-disc space-y-1 pl-5">
          {limits.knownFalsePositives.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
      <div>
        <p className="font-medium text-foreground">What it does not see</p>
        <p className="text-meta text-muted-foreground">No suggestion does not mean all is well:</p>
        <ul className="mt-1 list-disc space-y-1 pl-5">
          {limits.blindSpots.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
