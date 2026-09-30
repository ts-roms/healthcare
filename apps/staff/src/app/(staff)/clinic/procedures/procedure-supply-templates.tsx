"use client";

import { SupplyTemplates } from "@/components/supply-templates";
import type { ProcedureDefinition, ProcedureSupplyOptions } from "@/lib/api/types";
import { saveProcedureSupplyTemplate } from "../procedure-actions";

/** The supplies each active catalogue entry usually uses (prefilled when staff record what a procedure used). */
export function ProcedureSupplyTemplates({
  options,
  definitions,
  canConfigure,
}: {
  options: ProcedureSupplyOptions;
  definitions: ProcedureDefinition[];
  canConfigure: boolean;
}) {
  return (
    <div className="px-4 pb-4">
      <SupplyTemplates
        options={options}
        procedures={definitions.filter((d) => d.status === "active").map((d) => ({ id: d.id, name: `${d.name} (${d.code})` }))}
        templateOf={(id) => options.templates.find((t) => t.definitionId === id)?.items ?? []}
        canManage={canConfigure}
        onSave={async (id, items) => {
          const result = await saveProcedureSupplyTemplate(id, items);
          return result.ok ? { ok: true } : { ok: false, message: result.message };
        }}
      />
    </div>
  );
}
