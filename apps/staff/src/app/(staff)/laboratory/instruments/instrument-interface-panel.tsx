"use client";

import * as React from "react";
import { CableIcon } from "lucide-react";
import {
  Badge,
  Button,
  Checkbox,
  Input,
  Label,
  NativeSelect,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from "@healthcare/ui/primitives";
import type { InstrumentProtocol, LabInstrumentInterfaceSettings, LabTest } from "@/lib/api/types";
import { PROTOCOL_LABEL, SPECIMEN_FIELDS } from "@/lib/instrument-results";
import { configureInterface, loadInterfaceSettings, setAnalyzerCode } from "../instrument-interface-actions";

/**
 * The instrument's analyzer interface: its protocol, where its messages carry the specimen's barcode, whether messages
 * are accepted, and which analyzer test code is which catalog test. Results it sends wait under Instrument results.
 */
export function InstrumentInterfacePanel({ instrumentId, tests, canManage }: { instrumentId: string; tests: LabTest[]; canManage: boolean }) {
  const [settings, setSettings] = React.useState<LabInstrumentInterfaceSettings | null>(null);
  const [pending, start] = React.useTransition();
  const [form, setForm] = React.useState<{ protocol: InstrumentProtocol; specimenIdField: string; enabled: boolean }>({
    protocol: "hl7v2",
    specimenIdField: "OBR-2",
    enabled: true,
  });
  const [code, setCode] = React.useState({ analyzerCode: "", testId: "" });

  const apply = (next: LabInstrumentInterfaceSettings) => {
    setSettings(next);
    if (next.interface) setForm({ protocol: next.interface.protocol, specimenIdField: next.interface.specimenIdField, enabled: next.interface.enabled });
  };
  React.useEffect(() => {
    let active = true;
    void loadInterfaceSettings(instrumentId).then((result) => {
      if (!active) return;
      if (result.ok) apply(result.data);
      else toast.error(result.message);
    });
    return () => {
      active = false;
    };
  }, [instrumentId]);

  const call = (action: () => Promise<{ ok: true; data: LabInstrumentInterfaceSettings } | { ok: false; message: string }>, done: string, after?: () => void) =>
    start(async () => {
      const result = await action();
      if (result.ok) {
        apply(result.data);
        toast.success(done);
        after?.();
      } else toast.error(result.message);
    });

  if (!settings) return <p className="p-1 text-table text-muted-foreground">Loading the interface…</p>;
  const current = settings.interface;

  return (
    <section aria-label="Analyzer interface" className="flex flex-col gap-3 border-t p-1 pt-3">
      <h3 className="flex items-center gap-2 font-medium">
        <CableIcon className="size-4 text-muted-foreground" aria-hidden /> Analyzer interface
        {current ? (
          <Badge variant={current.enabled ? "success" : "neutral"}>{current.enabled ? `On · ${PROTOCOL_LABEL[current.protocol]}` : "Off"}</Badge>
        ) : (
          <Badge variant="neutral">Not set up</Badge>
        )}
      </h3>
      {canManage ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            call(
              () => configureInterface({ instrumentId, ...form, specimenIdField: form.specimenIdField as "OBR-2", version: current?.version }),
              "Interface saved",
            );
          }}
        >
          <div className="grid gap-1">
            <Label htmlFor={`protocol-${instrumentId}`}>Protocol</Label>
            <NativeSelect
              id={`protocol-${instrumentId}`}
              value={form.protocol}
              onChange={(e) => {
                const protocol = e.target.value as InstrumentProtocol;
                setForm({ ...form, protocol, specimenIdField: SPECIMEN_FIELDS[protocol][0]!.value });
              }}
            >
              {(Object.keys(PROTOCOL_LABEL) as InstrumentProtocol[]).map((p) => (
                <option key={p} value={p}>
                  {PROTOCOL_LABEL[p]}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="grid gap-1">
            <Label htmlFor={`specimen-${instrumentId}`}>Specimen barcode in</Label>
            <NativeSelect id={`specimen-${instrumentId}`} value={form.specimenIdField} onChange={(e) => setForm({ ...form, specimenIdField: e.target.value })}>
              {SPECIMEN_FIELDS[form.protocol].map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </NativeSelect>
          </div>
          <label className="flex h-9 items-center gap-2 text-body">
            <Checkbox checked={form.enabled} onCheckedChange={(v) => setForm({ ...form, enabled: v === true })} /> Accept messages
          </label>
          <Button type="submit" size="sm" disabled={pending}>
            Save
          </Button>
        </form>
      ) : current ? (
        <p className="text-table text-muted-foreground">Specimen barcode in {current.specimenIdField}.</p>
      ) : null}

      <div className="flex flex-col gap-2">
        <h4 className="text-table font-medium">Analyzer test codes</h4>
        {settings.testCodes.length === 0 ? (
          <p className="text-table text-muted-foreground">No codes mapped: results the analyzer sends stay unmatched until their code is mapped here.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Analyzer code</TableHead>
                <TableHead>Test</TableHead>
                {canManage ? <TableHead /> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {settings.testCodes.map((c) => (
                <TableRow key={c.analyzerCode}>
                  <TableCell className="font-mono">{c.analyzerCode}</TableCell>
                  <TableCell>
                    {c.testName} <span className="text-meta text-muted-foreground">· {c.testCode}</span>
                  </TableCell>
                  {canManage ? (
                    <TableCell className="text-right">
                      <Button
                        size="xs"
                        variant="ghost"
                        disabled={pending}
                        onClick={() => call(() => setAnalyzerCode({ instrumentId, analyzerCode: c.analyzerCode, testId: null }), `${c.analyzerCode} unmapped`)}
                      >
                        Remove
                      </Button>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {canManage && tests.length ? (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              call(
                () => setAnalyzerCode({ instrumentId, analyzerCode: code.analyzerCode, testId: code.testId }),
                `${code.analyzerCode.trim()} mapped`,
                () => setCode({ analyzerCode: "", testId: "" }),
              );
            }}
          >
            <div className="grid gap-1">
              <Label htmlFor={`code-${instrumentId}`}>Analyzer code</Label>
              <Input
                id={`code-${instrumentId}`}
                className="w-32"
                value={code.analyzerCode}
                maxLength={60}
                onChange={(e) => setCode({ ...code, analyzerCode: e.target.value })}
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor={`test-${instrumentId}`}>Test</Label>
              <NativeSelect id={`test-${instrumentId}`} value={code.testId} onChange={(e) => setCode({ ...code, testId: e.target.value })}>
                <option value="">Choose a test…</option>
                {tests.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <Button type="submit" size="sm" disabled={pending || !code.analyzerCode.trim() || !code.testId}>
              Map
            </Button>
          </form>
        ) : null}
      </div>
      <p className="text-meta text-muted-foreground">
        Messages arrive through the instrument gateway&apos;s integration account. Every result waits under Instrument results until someone accepts it; the
        analyzer&apos;s own flags and status codes are shown as sent, never interpreted.
      </p>
    </section>
  );
}
