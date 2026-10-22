"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2Icon, MinusCircleIcon, PencilIcon, ScissorsIcon } from "lucide-react";
import { AddSheet, Badge, Button, EmptyState, ResponsiveTable, toast, type ResponsiveColumn } from "@healthcare/ui/primitives";
import { updateProcedureDefinition } from "@/app/(staff)/clinic/procedure-actions";
import type { ProcedureDefinition } from "@/lib/api/types";
import { ProcedureForm } from "./procedure-form";

/** The catalogue as a table (cards on a phone). Adding and editing happen in a side sheet; the page header holds the "Add procedure" button. */
export function ProcedureCatalog({ definitions, canConfigure }: { definitions: ProcedureDefinition[]; canConfigure: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const toggle = (d: ProcedureDefinition) =>
    startTransition(async () => {
      const result = await updateProcedureDefinition({ id: d.id, version: d.version, status: d.status === "active" ? "inactive" : "active" });
      if (result.ok) {
        toast.success(`${d.name} ${result.data.status === "active" ? "is back in use" : "is no longer offered"}`);
        router.refresh();
      } else toast.error(result.message);
    });

  if (definitions.length === 0) {
    return (
      <EmptyState
        icon={ScissorsIcon}
        title="No procedures yet"
        description={
          canConfigure
            ? "Add the procedures your clinicians perform, such as suture repair or wound dressing. Once added they can be recorded on a visit and charged."
            : "Only clinic administrators can change the catalogue."
        }
        actions={
          canConfigure ? (
            <AddSheet label="Add procedure" description="Its own code is kept as written and never changes.">
              <ProcedureForm />
            </AddSheet>
          ) : undefined
        }
      />
    );
  }

  const columns: ResponsiveColumn<ProcedureDefinition>[] = [
    { key: "name", header: "Procedure", primary: true, cell: (d) => <span className="font-medium">{d.name}</span> },
    { key: "code", header: "Code", cell: (d) => <span className="font-mono text-meta">{d.code}</span> },
    {
      key: "other",
      header: "Other code",
      cell: (d) => <span className="font-mono text-meta">{d.externalCode ? `${d.codeSystem}|${d.externalCode}` : "—"}</span>,
    },
    { key: "site", header: "Body site", cell: (d) => <span className="text-meta">{d.requiresBodySite ? "Asked when recording" : "Optional"}</span> },
    {
      key: "consent",
      header: "Consent",
      cell: (d) => (
        <span className="text-meta">
          {d.consentRequired ? "Required" : "Optional"}
          {d.consentWording ? ` · wording v${d.consentWording.version}` : ""}
        </span>
      ),
    },
    { key: "outside", header: "Outside a consultation", cell: (d) => <span className="text-meta">{d.allowedOutsideConsultation ? "Allowed" : "No"}</span> },
    {
      key: "status",
      header: "Status",
      cell: (d) =>
        d.status === "active" ? (
          <Badge variant="success">
            <CheckCircle2Icon aria-hidden /> In use
          </Badge>
        ) : (
          <Badge variant="neutral">
            <MinusCircleIcon aria-hidden /> Not offered
          </Badge>
        ),
    },
    ...(canConfigure
      ? [
          {
            key: "actions",
            header: "Actions",
            actions: true,
            cell: (d: ProcedureDefinition) => (
              <span className="inline-flex gap-1">
                <AddSheet
                  label="Edit"
                  title={`Edit ${d.name}`}
                  description="A code never changes; stop offering an entry and add another instead."
                  trigger={
                    <Button size="sm" variant="ghost" aria-label={`Edit ${d.name}`}>
                      <PencilIcon aria-hidden /> Edit
                    </Button>
                  }
                >
                  <ProcedureForm editing={d} />
                </AddSheet>
                <Button size="sm" variant="ghost" disabled={pending} onClick={() => toggle(d)}>
                  {d.status === "active" ? "Stop offering" : "Offer again"}
                </Button>
              </span>
            ),
          } satisfies ResponsiveColumn<ProcedureDefinition>,
        ]
      : []),
  ];

  return (
    <div className="flex flex-col gap-3 p-2">
      <ResponsiveTable caption="Procedure catalogue" columns={columns} rows={definitions} getRowKey={(d) => d.id} />
      {canConfigure ? null : <p className="px-3 pb-2 text-table text-muted-foreground">Only clinic administrators can change the catalogue.</p>}
    </div>
  );
}
