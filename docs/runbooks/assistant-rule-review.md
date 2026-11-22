# Assistant rule review: every quarter, and after a rule changes

The heuristic assistant's rules ([assistant](../domains/assistant.md), ADR-0018) are off until an organization turns
them on, with thresholds the organization chooses. This runbook is the organization's periodic check that each rule it
turned on still helps: what staff did with its suggestions, what they said was wrong, and a recorded decision — keep it,
adjust it, or retire it. The platform decides nothing here; it counts and records.

**Who:** an organization administrator (`assistant.configure` and `assistant.insights.read`) with the people who use
each rule: a physician or the medical director for the consultation, prescribing and online-consultation rules, the
laboratory head for laboratory rules, the pharmacist for pharmacy rules, the dentist for dental rules, the operations
or billing lead for the others, and the Data Protection Officer for the record-access and outreach rules.

**When:** every three months, and whenever a release raises a rule's version (the release notes say so; a review made on
an earlier version no longer counts). A rule turned on and never reviewed, reviewed over 92 days ago or reviewed on an
earlier version shows **Review due**.

## What is counted

| Figure     | Means                                                                                                                 |
| ---------- | --------------------------------------------------------------------------------------------------------------------- |
| Shown      | Each time one of the rule's suggestions appeared on a screen (a suggestion seen on five page loads counts five times) |
| Followed   | Each time someone opened a suggestion's link                                                                          |
| Dismissed  | Answers "Dismiss" (hidden from that person for 14 days)                                                               |
| Not useful | Answers "Not useful" (hidden from that person for 14 days), often with the person's own words: **What staff said**    |

**Mostly dismissed** appears once a rule has at least 20 answers and 70% or more were dismissals or "not useful". The
counts are the organization's (every facility together); suggestions themselves are never stored, and no patient or
finding appears on these pages.

## Steps

1. Open **Settings → Assistant → Open insights and reviews** (`/admin/assistant/insights`) and choose the period (90
   days for a quarterly review). Rules due for review and mostly dismissed rules are listed first.
2. For each rule that is on, open it. Read the counts, **When it can be wrong** (what the rule reads, its known false
   positives and what it does not see, documented with the rule for every organization) and **What staff said**. Ask
   the people who use it:
   - Do its suggestions point at something they would want to know, early enough to act?
   - Which suggestions were wrong, and is there a pattern (a kind of item, patient, test, time of day)? That pattern is a
     **false positive**: write it down.
   - Is it shown so often that people stopped reading it (many shown, few followed or answered)?
3. If the thresholds look wrong, open **Rule settings** (`/admin/assistant`), change the values on the rule's card and
   select **Try these values**: it says how often the rule would have spoken on each of the last 14 days with them. Save
   only when the new values look right, for the organization or the facility that works differently.
4. Record the decision on the rule's insights page, **Record a review**:
   - **Keep it as it is** — useful at its thresholds.
   - **Adjust its thresholds** — after step 3; say what changed and why.
   - **Retire it** — it does not suit how the organization works. The rule is turned off at once wherever it is on
     (the organization and every facility with its own setting), keeping its values; it can be turned on again later.
     Write what was decided and why, the false positives found (no patient names or details), and the date. A review is
     kept as written and cannot be changed; record a new one to correct it. Each review is in the audit log
     (`assistant.rule-review`, with the outcome only).
5. For a clinical rule (consultation, prescribing, laboratory, dental, online consultation or the pharmacy's expiry
   check), the review is also the clinical sign-off the compliance register asks for
   ([compliance dependencies](../security/compliance-dependencies.md), "Assistant clinical decision support"): name the
   clinician who validated it in the note.
6. Rules that are off and were never turned on need no review. A rule retired earlier can be turned on again after a new
   review that says why.

## When a rule is wrong for everyone

A false positive that is a fault in the rule itself (not a threshold the organization can change) is reported to the
platform team with the rule's id and version (on the rule's insights page and under **Why?** on each suggestion) and the
pattern, never a patient's details. The team adds the pattern to the rule's known false positives (its definition's
`knownFalsePositives`, shown under **When it can be wrong** and on its settings card for every organization; see
[assistant](../domains/assistant.md), "Known false positives") and raises the rule's version only when it changes the
rule's logic, which makes every organization's review of it due again. A pattern already listed there needs no report:
record it in the review if it matters to your organization.
