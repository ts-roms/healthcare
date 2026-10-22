import * as React from "react";
import { cn } from "../lib/utils";
import { Button } from "../primitives/button";
import { Card } from "../primitives/card";
import { DefaultLink, type LinkComponent } from "./link";
import { PageHeader, type Breadcrumb } from "./page-header";

/**
 * Page templates: one composition per kind of screen, so screens of a kind look and behave the same.
 *
 *   ListPage       header + primary action, a card with a filter toolbar, the rows and a pager.
 *   DetailPage     an identity card, section tabs, then the main column with an optional side rail.
 *   SettingsPage   header + one-line description (+ "How this works"), optional tabs, the sections.
 *   DashboardPage  greeting header, an urgent callout, a row of stat tiles, then cards in a grid.
 *
 * They are layout only: the data, the permission checks and the server actions stay in the page.
 */

const WIDTH = {
  /** Lists, dashboards, records, boards: the whole working width, no cap. */
  wide: "max-w-none",
  /** Settings pages: a readable column beside the settings menu. */
  medium: "max-w-5xl",
  /** One short form. */
  narrow: "max-w-3xl",
} as const;

/** The page column: the redesign's width, padding and vertical rhythm. Wrap a page's content in it. */
export function PageShell({ width = "wide", className, children }: { width?: keyof typeof WIDTH; className?: string; children: React.ReactNode }) {
  return <div className={cn("mx-auto flex w-full flex-col gap-4 p-4 md:p-6", WIDTH[width], className)}>{children}</div>;
}

interface HeaderProps {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  breadcrumbs?: Breadcrumb[];
  badges?: React.ReactNode;
  Link?: LinkComponent;
}

/** A list screen: the toolbar (filters) and the pager belong to the card that holds the rows. */
export function ListPage({
  title,
  description,
  actions,
  breadcrumbs,
  badges,
  Link,
  explain,
  notice,
  toolbar,
  footer,
  children,
  width = "wide",
}: HeaderProps & {
  /** A "How this works" disclosure under the header. */
  explain?: React.ReactNode;
  /** A callout or banner above the list (an error, a status). */
  notice?: React.ReactNode;
  /** Search and filters, above the rows. */
  toolbar?: React.ReactNode;
  /** The pager, below the rows. */
  footer?: React.ReactNode;
  /** The rows (a table or `ResponsiveTable`), or an `EmptyState` when there are none. */
  children: React.ReactNode;
  width?: keyof typeof WIDTH;
}) {
  return (
    <PageShell width={width}>
      <PageHeader variant="plain" title={title} description={description} actions={actions} breadcrumbs={breadcrumbs} badges={badges} Link={Link} />
      {explain}
      {notice}
      <Card className="gap-0 overflow-hidden">
        {toolbar ? <div className="border-b px-4 py-3">{toolbar}</div> : null}
        {children}
        {footer ? <div className="border-t px-4 py-2.5">{footer}</div> : null}
      </Card>
    </PageShell>
  );
}

/** Previous / Next for a list that pages through the API: links, so it works in a server component. */
export function Pager({
  page,
  hasMore,
  previousHref,
  nextHref,
  summary,
  Link = DefaultLink,
}: {
  page: number;
  hasMore: boolean;
  previousHref?: string;
  nextHref?: string;
  /** What is shown, e.g. "Showing 26–50"; defaults to "Page N". */
  summary?: React.ReactNode;
  Link?: LinkComponent;
}) {
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-3 text-table">
      <span className="text-muted-foreground">{summary ?? `Page ${page}`}</span>
      <span className="flex gap-2">
        {page > 1 && previousHref ? (
          <Button asChild variant="outline" size="sm">
            <Link href={previousHref}>Previous</Link>
          </Button>
        ) : null}
        {hasMore && nextHref ? (
          <Button asChild variant="outline" size="sm">
            <Link href={nextHref}>Next</Link>
          </Button>
        ) : null}
      </span>
    </nav>
  );
}

/**
 * A record: the identity card on top (who it is, status, the main actions), banners, the section tabs and the sections.
 * Give `rail` for a fixed-width side column (a summary) beside the main column.
 */
export function DetailPage({
  identity,
  notices,
  tabs,
  rail,
  children,
  width = "wide",
}: {
  identity: React.ReactNode;
  /** Banners about the record itself (merged, inactive, stale visits). */
  notices?: React.ReactNode;
  tabs?: React.ReactNode;
  rail?: React.ReactNode;
  children: React.ReactNode;
  width?: keyof typeof WIDTH;
}) {
  return (
    <PageShell width={width}>
      <Card className="px-4 py-4 md:px-5">{identity}</Card>
      {notices}
      {tabs}
      {rail ? (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="flex min-w-0 flex-col gap-4">{children}</div>
          <aside className="flex min-w-0 flex-col gap-4">{rail}</aside>
        </div>
      ) : (
        <div className="flex min-w-0 flex-col gap-4">{children}</div>
      )}
    </PageShell>
  );
}

/** A settings page: header, an optional "How this works", optional tabs, then the sections (cards, tables, forms). */
export function SettingsPage({
  title,
  description,
  actions,
  breadcrumbs,
  badges,
  Link,
  explain,
  tabs,
  children,
  width = "wide",
}: HeaderProps & { explain?: React.ReactNode; tabs?: React.ReactNode; children: React.ReactNode; width?: keyof typeof WIDTH }) {
  return (
    <PageShell width={width}>
      <PageHeader variant="plain" title={title} description={description} actions={actions} breadcrumbs={breadcrumbs} badges={badges} Link={Link} />
      {explain}
      {tabs}
      <div className="flex min-w-0 flex-col gap-4">{children}</div>
    </PageShell>
  );
}

/** A dashboard: the greeting header, what is urgent, a row of stat tiles, then the cards (the page lays them out). */
export function DashboardPage({
  title,
  description,
  actions,
  Link,
  alert,
  tiles,
  children,
  width = "wide",
}: Omit<HeaderProps, "breadcrumbs" | "badges"> & {
  /** The urgent thing, a danger `Callout` (STAT orders, critical results). */
  alert?: React.ReactNode;
  tiles?: React.ReactNode;
  children: React.ReactNode;
  width?: keyof typeof WIDTH;
}) {
  return (
    <PageShell width={width}>
      <PageHeader variant="plain" title={title} description={description} actions={actions} Link={Link} />
      {alert}
      {tiles ? (
        <section aria-label="Today in figures" className="grid grid-cols-2 gap-3 lg:grid-cols-[repeat(auto-fit,minmax(11rem,1fr))]">
          {tiles}
        </section>
      ) : null}
      {children}
    </PageShell>
  );
}
