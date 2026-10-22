"use client";

import * as React from "react";
import { CheckCircle2Icon, MinusCircleIcon, PencilIcon } from "lucide-react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Checkbox, Input, Label } from "@healthcare/ui/primitives";
import { RouteStopsEditor } from "@/components/route-stops-editor";
import type { RouteTemplate, ServicePoint, VisitType } from "@/lib/api/types";
import { routeSummary } from "@/lib/route-template";
import { useServerAction } from "@/lib/use-server-action";
import { createRouteTemplate, updateRouteTemplate } from "./actions";

interface Form {
  code: string;
  name: string;
  stops: string[];
  visitTypeIds: string[];
}

const EMPTY: Form = { code: "", name: "", stops: [], visitTypeIds: [] };

/**
 * The facility's route templates (migration 0116): a named list of service points a nurse applies to a visit's route
 * with one pick. A template is only a recipe — a route already planned is never changed by editing it — and the visit
 * types it is "offered for" are pre-selected at triage; the nurse can always change or clear them.
 */
export function RouteTemplates({
  facilityId,
  templates,
  servicePoints,
  visitTypes,
}: {
  facilityId: string;
  templates: RouteTemplate[];
  servicePoints: ServicePoint[];
  visitTypes: VisitType[];
}) {
  const [editing, setEditing] = React.useState<RouteTemplate | null>(null);
  const [form, setForm] = React.useState<Form>(EMPTY);
  const { pending, run } = useServerAction();
  const active = servicePoints.filter((s) => s.status === "active");
  const reset = () => {
    setEditing(null);
    setForm(EMPTY);
  };
  const visitTypeName = (id: string) => visitTypes.find((v) => v.id === id)?.name ?? "Visit type";

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editing) {
      run(
        () =>
          updateRouteTemplate(editing.id, {
            name: form.name,
            servicePointIds: form.stops,
            defaultForVisitTypeIds: form.visitTypeIds,
            version: editing.version,
          }),
        `${form.name.trim()} updated`,
        reset,
      );
    } else {
      run(
        () => createRouteTemplate({ facilityId, code: form.code, name: form.name, servicePointIds: form.stops, defaultForVisitTypeIds: form.visitTypeIds }),
        `${form.name.trim()} added`,
        reset,
      );
    }
  };
  const toggle = (t: RouteTemplate) =>
    run(
      () => updateRouteTemplate(t.id, { status: t.status === "active" ? "inactive" : "active", version: t.version }),
      t.status === "active" ? `${t.name} deactivated` : `${t.name} is in use again`,
    );

  return (
    <Card className="mx-4 mb-4">
      <CardHeader>
        <CardTitle>Route templates</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-meta text-muted-foreground">
          A route you plan again and again, e.g. an annual check-up: triage, laboratory, X-ray, then the doctor. At triage or on the queue, picking a template
          fills in the stops; the nurse can still change them. Editing a template never changes a route already planned.
        </p>
        {templates.length ? (
          <ul aria-label="Route templates" className="divide-y rounded-md border">
            {templates.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                <span className="font-medium">{t.name}</span>
                <span className="font-mono text-meta text-muted-foreground">{t.code}</span>
                {t.status === "active" ? (
                  <Badge variant="success">
                    <CheckCircle2Icon aria-hidden /> In use
                  </Badge>
                ) : (
                  <Badge variant="neutral">
                    <MinusCircleIcon aria-hidden /> Inactive
                  </Badge>
                )}
                {t.status === "active" && !t.usable ? <Badge variant="warning">A stop is no longer in use</Badge> : null}
                <span className="basis-full text-table text-muted-foreground">{routeSummary(t)}</span>
                {t.defaultForVisitTypeIds.length ? (
                  <span className="basis-full text-meta text-muted-foreground">
                    Offered first for: {t.defaultForVisitTypeIds.map(visitTypeName).join(", ")}
                  </span>
                ) : null}
                <span className="ml-auto flex gap-1">
                  <Button
                    size="xs"
                    variant="ghost"
                    disabled={pending}
                    onClick={() => {
                      setEditing(t);
                      setForm({ code: t.code, name: t.name, stops: t.steps.map((s) => s.id), visitTypeIds: t.defaultForVisitTypeIds });
                    }}
                  >
                    <PencilIcon aria-hidden /> Edit
                  </Button>
                  <Button size="xs" variant="ghost" disabled={pending} onClick={() => toggle(t)}>
                    {t.status === "active" ? "Deactivate" : "Reactivate"}
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground">No route templates yet.</p>
        )}

        {active.length > 0 ? (
          <form
            onSubmit={submit}
            className="grid gap-3 rounded-md border p-3 sm:grid-cols-2"
            aria-label={editing ? "Edit route template" : "Add a route template"}
          >
            <h3 className="text-body font-semibold sm:col-span-2">{editing ? `Edit ${editing.name}` : "Add a route template"}</h3>
            <div className="grid gap-1">
              <Label htmlFor="route-template-code">Code *</Label>
              <Input
                id="route-template-code"
                required
                disabled={!!editing}
                placeholder="e.g. annual-checkup"
                pattern="[a-z0-9][a-z0-9\-]{1,48}"
                maxLength={49}
                value={form.code}
                onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toLowerCase() }))}
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="route-template-name">Name *</Label>
              <Input
                id="route-template-name"
                required
                maxLength={120}
                placeholder="e.g. Annual check-up"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="grid gap-1 sm:col-span-2">
              <p className="text-table font-medium">Stops, in order *</p>
              <RouteStopsEditor
                id="route-template-stop"
                servicePoints={active}
                stops={form.stops}
                after={null}
                disabled={pending}
                onChange={(stops) => setForm((f) => ({ ...f, stops }))}
              />
              <p className="text-meta text-muted-foreground">The first stop is where the patient is sent; the others follow it. A stop cannot follow itself.</p>
            </div>
            {visitTypes.length ? (
              <fieldset className="grid gap-1 sm:col-span-2">
                <legend className="text-table font-medium">Offer first for these visit types (optional)</legend>
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {visitTypes.map((v) => (
                    <label key={v.id} className="flex items-center gap-2 text-body">
                      <Checkbox
                        checked={form.visitTypeIds.includes(v.id)}
                        onCheckedChange={(checked) =>
                          setForm((f) => ({ ...f, visitTypeIds: checked === true ? [...f.visitTypeIds, v.id] : f.visitTypeIds.filter((id) => id !== v.id) }))
                        }
                      />
                      {v.name}
                    </label>
                  ))}
                </div>
                <p className="text-meta text-muted-foreground">
                  A visit type has one template offered first at the facility; choosing it here moves it from another.
                </p>
              </fieldset>
            ) : null}
            <div className="flex gap-2 sm:col-span-2">
              <Button
                type="submit"
                size="sm"
                disabled={pending || form.name.trim().length < 1 || form.stops.length < 1 || (!editing && form.code.trim().length < 2)}
              >
                {editing ? "Save changes" : "Add route template"}
              </Button>
              {editing ? (
                <Button type="button" size="sm" variant="ghost" onClick={reset} disabled={pending}>
                  Cancel
                </Button>
              ) : null}
            </div>
          </form>
        ) : (
          <p className="text-meta text-muted-foreground">Add service points first: a template is a list of them.</p>
        )}
      </CardContent>
    </Card>
  );
}
