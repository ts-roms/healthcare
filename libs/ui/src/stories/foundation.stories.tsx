import * as React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { FlaskConicalIcon, InboxIcon, PrinterIcon } from "lucide-react";
import { StatTile } from "../healthcare/stat-tile";
import { ModuleTabs } from "../layouts/module-tabs";
import { DashboardPage, DetailPage, ListPage, Pager, SettingsPage } from "../layouts/page-templates";
import { PageHeader } from "../layouts/page-header";
import {
  AddSheet,
  Badge,
  Button,
  Callout,
  Card,
  EmptyState,
  Explain,
  FormSection,
  Input,
  Label,
  NativeSelect,
  ResponsiveTable,
  SaveBar,
  SettingRow,
  Switch,
  useAddSheet,
  type ResponsiveColumn,
} from "../primitives";

/**
 * The redesign foundation: page header, module tabs, empty state, responsive table, settings building blocks, stat tiles,
 * callouts, "How this works" and the add-sheet pattern. Every story also has a Dark variant (`globals.theme`) and a
 * 390px Phone variant; the toolbar's theme switch works on all of them.
 */
const meta: Meta = { title: "Foundation/Redesign components", parameters: { layout: "padded" } };
export default meta;

type Story = StoryObj;

const dark = { theme: "dark" } as const;

/** A phone-width frame (390px, the redesign's reference width). */
function Phone({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-[390px] max-w-full overflow-hidden rounded-2xl border bg-background p-3">{children}</div>;
}

// ---- Page header -----------------------------------------------------------------------------------------------

function HeaderDemo({ variant }: { variant: "bar" | "plain" }) {
  return (
    <PageHeader
      variant={variant}
      title="Procedures"
      description="The procedures this clinic performs and records."
      breadcrumbs={[{ label: "Settings", href: "/admin" }, { label: "Clinic", href: "/clinic" }, { label: "Procedures" }]}
      badges={<Badge variant="success">Active</Badge>}
      actions={
        <>
          <Button variant="outline">
            <PrinterIcon /> Print
          </Button>
          <Button>Add procedure</Button>
        </>
      }
    />
  );
}
export const PageHeaderBar: Story = { render: () => <HeaderDemo variant="bar" /> };
export const PageHeaderPlain: Story = { render: () => <HeaderDemo variant="plain" /> };
export const PageHeaderPlainDark: Story = { globals: dark, render: () => <HeaderDemo variant="plain" /> };
export const PageHeaderPhone: Story = {
  render: () => (
    <Phone>
      <HeaderDemo variant="plain" />
    </Phone>
  ),
};

// ---- Module tabs ------------------------------------------------------------------------------------------------

const TABS = [
  { href: "/billing", label: "Cashier" },
  { href: "/billing/invoices", label: "Invoices", count: 3 },
  { href: "/billing/reports", label: "Reports" },
  { href: "/billing/claims", label: "Claims", count: 2, alert: true },
  { href: "/billing/settings", label: "Settings" },
];
export const ModuleTabsDefault: Story = { render: () => <ModuleTabs tabs={TABS} pathname="/billing/invoices/INV-1" label="Billing sections" /> };
export const ModuleTabsDark: Story = { globals: dark, render: () => <ModuleTabs tabs={TABS} pathname="/billing/claims" label="Billing sections" /> };
export const ModuleTabsPhone: Story = {
  render: () => (
    <Phone>
      <ModuleTabs tabs={TABS} pathname="/billing" label="Billing sections" />
    </Phone>
  ),
};

// ---- Empty state ------------------------------------------------------------------------------------------------

const empty = (
  <Card>
    <EmptyState
      icon={InboxIcon}
      title="No procedures yet"
      description="Add the procedures your clinic performs so they can be recorded and charged."
      actions={<Button>Add procedure</Button>}
    />
  </Card>
);
export const EmptyStateDefault: Story = { render: () => empty };
export const EmptyStateDark: Story = { globals: dark, render: () => empty };
export const EmptyStatePhone: Story = { render: () => <Phone>{empty}</Phone> };

// ---- Responsive table -------------------------------------------------------------------------------------------

interface Row {
  id: string;
  patient: string;
  test: string;
  status: string;
  stat: boolean;
  due: string;
}
const ROWS: Row[] = [
  { id: "1", patient: "DELA CRUZ, Juan", test: "Troponin I", status: "To collect", stat: true, due: "now" },
  { id: "2", patient: "SANTOS, Maria Reyes", test: "HbA1c", status: "To receive", stat: false, due: "11:30" },
  { id: "3", patient: "GARCIA, Jose Tan", test: "Lipid profile", status: "In progress", stat: false, due: "13:00" },
];
const COLUMNS: ResponsiveColumn<Row>[] = [
  { key: "patient", header: "Patient", primary: true, cell: (r) => r.patient },
  { key: "test", header: "Test", cell: (r) => r.test },
  { key: "status", header: "Status", cell: (r) => <Badge variant={r.stat ? "danger" : "info"}>{r.status}</Badge> },
  { key: "due", header: "Due", numeric: true, cell: (r) => r.due },
  {
    key: "actions",
    header: "Actions",
    actions: true,
    cell: () => (
      <Button size="sm" variant="outline">
        <FlaskConicalIcon /> Open
      </Button>
    ),
  },
];
const table = <ResponsiveTable caption="Laboratory worklist" columns={COLUMNS} rows={ROWS} getRowKey={(r) => r.id} urgent={(r) => r.stat} />;
export const ResponsiveTableDesktop: Story = { render: () => <Card className="p-2">{table}</Card> };
export const ResponsiveTableDark: Story = { globals: dark, render: () => <Card className="p-2">{table}</Card> };
/** Below `md` the same table is a list of cards. Shown inside a 390px frame; the real switch is the viewport, so resize to see it. */
export const ResponsiveTablePhone: Story = {
  parameters: { viewport: { defaultViewport: "mobile1" } },
  render: () => (
    <div className="max-w-[calc(768px-1px)] md:hidden">
      <Phone>{table}</Phone>
    </div>
  ),
};

// ---- Settings: FormSection, SettingRow, Switch, SaveBar ---------------------------------------------------------

function SettingsDemo() {
  const [online, setOnline] = React.useState(true);
  const [auto, setAuto] = React.useState(false);
  return (
    <form className="grid gap-4" onSubmit={(e) => e.preventDefault()}>
      <Card className="p-5">
        <FormSection title="Online booking" description="What patients can book from MyHealth.">
          <SettingRow title="Allow online booking" description="Patients choose from the open slots of a schedule." htmlFor="online">
            <Switch id="online" checked={online} onCheckedChange={setOnline} />
          </SettingRow>
          <SettingRow title="Automatic no-shows" description="Mark appointments that ended without a check-in." htmlFor="auto">
            <Switch id="auto" checked={auto} onCheckedChange={setAuto} />
          </SettingRow>
        </FormSection>
        <FormSection title="Notice" description="How far ahead patients may book.">
          <div className="grid gap-1.5">
            <Label htmlFor="lead">Minimum notice</Label>
            <Input id="lead" defaultValue="2 hours" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="horizon">Booking horizon</Label>
            <NativeSelect id="horizon" defaultValue="60">
              <option value="30">30 days</option>
              <option value="60">60 days</option>
            </NativeSelect>
          </div>
        </FormSection>
      </Card>
      <SaveBar message="You have unsaved changes.">
        <Button type="button" variant="ghost">
          Cancel
        </Button>
        <Button type="submit">Save changes</Button>
      </SaveBar>
    </form>
  );
}
export const SettingsDefault: Story = { render: () => <SettingsDemo /> };
export const SettingsDark: Story = { globals: dark, render: () => <SettingsDemo /> };
export const SettingsPhone: Story = {
  render: () => (
    <Phone>
      <SettingsDemo />
    </Phone>
  ),
};

// ---- Stat tile --------------------------------------------------------------------------------------------------

const tiles = (
  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
    <StatTile label="Waiting now" value={6} hint="Longest wait 24 min" href="/queue" />
    <StatTile label="STAT to collect" value={2} hint="Oldest 9 min" href="/laboratory/worklist?stage=collect" tone="alert" />
    <StatTile label="Collected today" value="₱18,450" hint="12 payments" />
    <StatTile label="Average turnaround" value={42} unit="min" hint="Last 7 days" />
  </div>
);
export const StatTiles: Story = { render: () => tiles };
export const StatTilesDark: Story = { globals: dark, render: () => tiles };
export const StatTilesPhone: Story = {
  render: () => (
    <Phone>
      <div className="grid gap-3">
        <StatTile label="Waiting now" value={6} hint="Longest wait 24 min" href="/queue" />
        <StatTile label="STAT to collect" value={2} hint="Oldest 9 min" tone="alert" />
      </div>
    </Phone>
  ),
};

// ---- Callout ----------------------------------------------------------------------------------------------------

const callouts = (
  <div className="grid gap-3">
    <Callout tone="info" title="Two-step verification is optional">
      Staff can turn it on under My account.
    </Callout>
    <Callout tone="warning" title="Allergies not recorded — ask the patient" actions={<Button size="sm">Record allergies</Button>} />
    <Callout tone="danger" title="2 critical results waiting for acknowledgement">
      Call the ordering doctor and record the call.
    </Callout>
    <Callout tone="success" title="Invoice paid in full" />
  </div>
);
export const Callouts: Story = { render: () => callouts };
export const CalloutsDark: Story = { globals: dark, render: () => callouts };
export const CalloutsPhone: Story = { render: () => <Phone>{callouts}</Phone> };

// ---- Explain ----------------------------------------------------------------------------------------------------

const explain = (
  <Explain>
    <p>Stock leaves a location by lot, first expiry first out. Expired lots are never used.</p>
    <p>Counts correct the balance with a reason; nothing is overwritten.</p>
  </Explain>
);
export const ExplainClosed: Story = { render: () => explain };
export const ExplainDark: Story = { globals: dark, render: () => explain };
export const ExplainPhone: Story = { render: () => <Phone>{explain}</Phone> };

// ---- Add sheet --------------------------------------------------------------------------------------------------

function ProcedureForm() {
  const { close } = useAddSheet();
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <div className="grid gap-1.5">
        <Label htmlFor="code">Code</Label>
        <Input id="code" placeholder="e.g. SUTURE-1" autoFocus />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="name">Name</Label>
        <Input id="name" placeholder="e.g. Wound suturing" />
      </div>
      <Button type="submit" className="justify-self-start">
        Save procedure
      </Button>
    </form>
  );
}
function AddSheetDemo() {
  return (
    <PageHeader
      variant="plain"
      title="Procedures"
      description="The procedures this clinic performs."
      actions={
        <AddSheet label="Add procedure" description="Its own code is kept as written and never changed.">
          <ProcedureForm />
        </AddSheet>
      }
    />
  );
}
export const AddSheetPattern: Story = { render: () => <AddSheetDemo /> };
export const AddSheetDark: Story = { globals: dark, render: () => <AddSheetDemo /> };
export const AddSheetPhone: Story = {
  render: () => (
    <Phone>
      <AddSheetDemo />
    </Phone>
  ),
};

// ---- Page templates ---------------------------------------------------------------------------------------------

const templateHeader = { title: "Patients", description: "All patients A–Z, or look up by name or number." };
const listRows = (
  <ResponsiveTable caption="Laboratory worklist" columns={COLUMNS} rows={ROWS} getRowKey={(r) => r.id} urgent={(r) => r.stat} className="px-2 pb-1" />
);
function ListTemplate() {
  return (
    <ListPage
      {...templateHeader}
      actions={<Button>Register patient</Button>}
      toolbar={
        <div className="flex flex-wrap items-end gap-2">
          <div className="grid min-w-56 flex-1 gap-1">
            <Label htmlFor="tpl-search">Name, patient no. or mobile</Label>
            <Input id="tpl-search" placeholder="e.g. dela cruz juan" />
          </div>
          <Button>Search</Button>
        </div>
      }
      footer={<Pager page={1} hasMore nextHref="#next" summary="Page 1" />}
    >
      {listRows}
    </ListPage>
  );
}
export const ListPageTemplate: Story = { parameters: { layout: "fullscreen" }, render: () => <ListTemplate /> };
export const ListPageTemplateDark: Story = { globals: dark, parameters: { layout: "fullscreen" }, render: () => <ListTemplate /> };
export const ListPageTemplatePhone: Story = {
  parameters: { layout: "fullscreen" },
  render: () => (
    <Phone>
      <ListTemplate />
    </Phone>
  ),
};

function DetailTemplate() {
  return (
    <DetailPage
      identity={
        <div className="flex flex-col gap-1">
          <p className="text-table text-muted-foreground">Patients › Maria Reyes Santos</p>
          <h1 className="text-page font-semibold">Maria Reyes Santos</h1>
          <Badge variant="success">Active</Badge>
        </div>
      }
      notices={<Callout tone="warning" title="Allergies not recorded — ask the patient" />}
      tabs={<ModuleTabs tabs={TABS} pathname="/billing/invoices" label="Sections of the record" />}
      rail={
        <Card className="p-4">
          <p className="font-semibold">Clinical summary</p>
          <p className="text-table text-muted-foreground">No active problems recorded.</p>
        </Card>
      }
    >
      <Card className="p-4">Demographics</Card>
      <Card className="p-4">Recent activity</Card>
    </DetailPage>
  );
}
export const DetailPageTemplate: Story = { parameters: { layout: "fullscreen" }, render: () => <DetailTemplate /> };
export const DetailPageTemplateDark: Story = { globals: dark, parameters: { layout: "fullscreen" }, render: () => <DetailTemplate /> };

function SettingsTemplate() {
  return (
    <SettingsPage
      title="Procedures"
      description="The procedures your clinic performs."
      breadcrumbs={[{ label: "Settings", href: "/admin" }, { label: "Clinical" }]}
      actions={
        <AddSheet label="Add procedure">
          <ProcedureForm />
        </AddSheet>
      }
      explain={<Explain summary="How procedures work">Codes are your organization&apos;s own.</Explain>}
    >
      <Card>
        <EmptyState icon={InboxIcon} title="No procedures yet" description="Add the procedures your clinicians perform." />
      </Card>
    </SettingsPage>
  );
}
export const SettingsPageTemplate: Story = { parameters: { layout: "fullscreen" }, render: () => <SettingsTemplate /> };
export const SettingsPageTemplateDark: Story = { globals: dark, parameters: { layout: "fullscreen" }, render: () => <SettingsTemplate /> };

function DashboardTemplate() {
  return (
    <DashboardPage
      title="Good morning, Dr. Santos"
      description="Thursday, 22 October · Main Clinic"
      actions={<Button>Check in patient</Button>}
      alert={
        <Callout
          tone="danger"
          title="2 STAT lab samples are not yet collected"
          actions={
            <Button size="sm" variant="destructive">
              Open worklist
            </Button>
          }
        />
      }
      tiles={tiles.props.children}
    >
      {callouts}
    </DashboardPage>
  );
}
export const DashboardPageTemplate: Story = { parameters: { layout: "fullscreen" }, render: () => <DashboardTemplate /> };
export const DashboardPageTemplateDark: Story = { globals: dark, parameters: { layout: "fullscreen" }, render: () => <DashboardTemplate /> };

/** Everything on one page, for a quick visual pass. */
export const Everything: Story = {
  render: () => (
    <div className="grid gap-6">
      <HeaderDemo variant="plain" />
      <ModuleTabs tabs={TABS} pathname="/billing/invoices" label="Billing sections" />
      {tiles}
      {callouts}
      <Card className="p-2">{table}</Card>
      {empty}
      {explain}
    </div>
  ),
};
