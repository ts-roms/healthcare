import * as React from "react";

export function PageHeader({ title, description, actions }: { title: string; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end gap-3 border-b bg-card px-4 py-3">
      <div className="min-w-0">
        <h1 className="text-page font-semibold tracking-tight">{title}</h1>
        {description ? <p className="text-table text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="ml-auto flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
