import Link from "next/link";
import { ArrowRightIcon, QrCodeIcon, SearchIcon, SearchXIcon, UserPlusIcon, UsersIcon } from "lucide-react";
import { ListPage, Pager } from "@healthcare/ui/layouts";
import { Badge, Button, Callout, Checkbox, DateInput, EmptyState, Input, Label, NativeSelect, ResponsiveTable } from "@healthcare/ui/primitives";
import type { ResponsiveColumn } from "@healthcare/ui/primitives";
import { clinicalDate, sexLabel } from "@healthcare/ui/healthcare";
import { NextLink } from "@/components/next-link";
import { api } from "@/lib/api/client";
import { ApiError, userMessage } from "@healthcare/web-session";
import { can, getSession } from "@/lib/api/session";
import type { Page, PatientSummary } from "@/lib/api/types";
import { initialsOf, label } from "@/lib/patient-mapping";
import { IDENTIFIER_TYPE_OPTIONS } from "@/lib/patient-edit";

export const metadata = { title: "Patients" };

const PAGE_SIZE = 25;

export default async function PatientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; birthDate?: string; idType?: string; idValue?: string; inactive?: string; page?: string }>;
}) {
  const { q = "", birthDate = "", idType: idTypeParam = "", idValue: idValueParam = "", inactive, page: pageParam } = await searchParams;
  const idType = (IDENTIFIER_TYPE_OPTIONS as readonly string[]).includes(idTypeParam) ? idTypeParam : "";
  const idValue = idType ? idValueParam.trim().slice(0, 64) : "";
  const includeInactive = inactive === "1";
  const session = await getSession();
  const canOpenWorkspace = can(session, "patient.read");
  const canRegister = can(session, "patient.register");
  const page = Math.max(1, Number(pageParam) || 1);
  const query = q.trim();
  const hasCriteria = query.length >= 2 || Boolean(birthDate) || Boolean(idValue);
  // Nothing typed: the list of all (active) patients, A–Z, 25 a page. A one-character name or an ID number without its kind asks for more.
  const browsing = !hasCriteria && query.length === 0 && !(idValueParam.trim() && !idType);

  let result: Page<PatientSummary> | undefined;
  let error: string | undefined;
  if (hasCriteria || browsing) {
    try {
      result = await api<Page<PatientSummary>>("/patients", {
        query: {
          q: query.length >= 2 ? query : undefined,
          birthDate: birthDate || undefined,
          identifierType: idValue ? idType : undefined,
          // PhilHealth PINs are stored without dashes.
          identifierValue: idValue ? (idType === "philhealth_pin" ? idValue.replace(/-/g, "") : idValue) : undefined,
          includeInactive: includeInactive ? "true" : undefined,
          page,
          pageSize: PAGE_SIZE,
        },
      });
    } catch (e) {
      error = e instanceof ApiError && e.status === 403 ? "You don't have permission to search patients." : userMessage(e);
    }
  }

  const pageHref = (p: number) =>
    `/patients?${new URLSearchParams({
      ...(query ? { q: query } : {}),
      ...(birthDate ? { birthDate } : {}),
      ...(idValue ? { idType, idValue } : {}),
      ...(includeInactive ? { inactive: "1" } : {}),
      page: String(p),
    })}`;

  const columns: ResponsiveColumn<PatientSummary>[] = [
    {
      key: "patient",
      header: "Patient",
      primary: true,
      cell: (p) => (
        <span className="flex items-center gap-3">
          <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-full bg-primary-subtle text-meta font-semibold text-primary-deep">
            {initialsOf(p.displayName)}
          </span>
          <span className="min-w-0">
            <Link href={`/patients/${p.id}`} className="font-semibold text-foreground hover:text-primary hover:underline">
              {p.displayName}
            </Link>
            {p.resolvedFrom ? (
              <span className="block text-meta font-normal whitespace-normal text-muted-foreground">
                Found through <span className="font-mono">{p.resolvedFrom.patientNumber}</span>, merged into this record
              </span>
            ) : null}
          </span>
        </span>
      ),
    },
    { key: "number", header: "Patient no.", cell: (p) => <span className="font-mono text-table">{p.patientNumber}</span> },
    { key: "age", header: "Age · sex", cell: (p) => `${p.age} · ${sexLabel(p.sex, true)}` },
    { key: "birth", header: "Birth date", cell: (p) => clinicalDate(p.birthDate) },
    { key: "mobile", header: "Mobile", cell: (p) => <span className="text-muted-foreground">{p.primaryMobileMasked ?? "—"}</span> },
    {
      key: "status",
      header: "Status",
      cell: (p) => (p.status === "active" ? <span className="text-muted-foreground">Active</span> : <Badge variant="warning">{label(p.status)}</Badge>),
    },
    {
      key: "actions",
      header: "Open",
      actions: true,
      cell: (p) => (
        <span className="inline-flex items-center gap-1">
          {canOpenWorkspace ? (
            <Button asChild variant="ghost" size="sm">
              <Link href={`/patients/${p.id}/360`} aria-label={`Patient 360 for ${p.displayName}`}>
                360
              </Link>
            </Button>
          ) : null}
          <Button asChild variant="outline" size="sm">
            <Link href={`/patients/${p.id}`} aria-label={`Open the record of ${p.displayName}`}>
              Open <ArrowRightIcon aria-hidden />
            </Link>
          </Button>
        </span>
      ),
    },
  ];

  const toolbar = (
    <form role="search" action="/patients" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="grid min-w-64 flex-1 gap-1">
          <Label htmlFor="patient-search">Name, patient no. or mobile</Label>
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input id="patient-search" name="q" defaultValue={query} placeholder="e.g. dela cruz juan" className="pl-8" autoFocus={!query} />
          </div>
        </div>
        <Button type="submit">
          <SearchIcon /> Search
        </Button>
      </div>
      <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
        <div className="grid gap-1">
          <Label htmlFor="patient-birth-date">Birth date</Label>
          <DateInput id="patient-birth-date" name="birthDate" defaultValue={birthDate} className="w-44" />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="patient-id-type">ID</Label>
          <NativeSelect id="patient-id-type" name="idType" defaultValue={idType} className="w-44">
            <option value="">Any (no ID)</option>
            {IDENTIFIER_TYPE_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {label(t)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="grid gap-1">
          <Label htmlFor="patient-id-value">ID number</Label>
          <Input id="patient-id-value" name="idValue" defaultValue={idValue} className="w-44 font-mono" maxLength={64} />
        </div>
        <div className="flex items-center gap-2 pb-1.5">
          <Checkbox id="patient-inactive" name="inactive" value="1" defaultChecked={includeInactive} />
          <Label htmlFor="patient-inactive" className="text-body font-normal">
            Include inactive records
          </Label>
        </div>
      </div>
    </form>
  );

  const registerButton = canRegister ? (
    <Button asChild>
      <Link href="/patients/new">
        <UserPlusIcon /> Register a new patient
      </Link>
    </Button>
  ) : undefined;

  return (
    <ListPage
      title="Patients"
      description="All patients A–Z, or look up by name, patient number, mobile number or an ID number, optionally with birth date."
      Link={NextLink}
      actions={
        <>
          {can(session, "patient.search") ? (
            <Button asChild variant="outline">
              <Link href="/patients/scan">
                <QrCodeIcon /> Scan QR code
              </Link>
            </Button>
          ) : null}
          {canRegister ? (
            <Button asChild>
              <Link href="/patients/new">
                <UserPlusIcon /> Register patient
              </Link>
            </Button>
          ) : null}
        </>
      }
      toolbar={toolbar}
      footer={
        result && result.items.length > 0 ? (
          <Pager page={result.page} hasMore={result.hasMore} previousHref={pageHref(result.page - 1)} nextHref={pageHref(result.page + 1)} Link={NextLink} />
        ) : undefined
      }
    >
      {!hasCriteria && !browsing ? (
        <EmptyState
          compact
          icon={SearchIcon}
          title={query.length === 1 ? "Enter at least 2 characters" : "Choose the kind of ID"}
          description={query.length === 1 ? "A one-letter name is too broad to search." : "Pick the kind of ID to search by its number."}
        />
      ) : error ? (
        <div className="p-4">
          <Callout tone="danger" title="The patient list could not be loaded">
            {error}
          </Callout>
        </div>
      ) : result && result.items.length === 0 ? (
        <EmptyState
          icon={browsing ? UsersIcon : SearchXIcon}
          title={browsing ? "No patients registered yet" : "No patients match"}
          description={
            browsing
              ? "Registered patients appear here."
              : `Check the spelling, or try the birth date or mobile number.${includeInactive ? "" : " Inactive records are left out unless you tick Include inactive records."}`
          }
          actions={registerButton}
        />
      ) : result ? (
        <ResponsiveTable caption="Patients" columns={columns} rows={result.items} getRowKey={(p) => p.id} className="px-2 pb-1" />
      ) : null}
    </ListPage>
  );
}
