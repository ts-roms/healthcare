"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowRightIcon, BellIcon, CheckIcon } from "lucide-react";
import { clinicalDateTime } from "@healthcare/ui/healthcare";
import { Badge, Button, Card, CardContent, toast } from "@healthcare/ui/primitives";
import type { StaffNotice } from "@/lib/api/types";
import { markNoticeRead } from "./actions";

export function NoticeList({ notices }: { notices: StaffNotice[] }) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  if (notices.length === 0) {
    return (
      <p className="flex items-center gap-2 p-4 text-body text-muted-foreground">
        <BellIcon aria-hidden className="size-4" /> No notifications.
      </p>
    );
  }
  // Marks the message read, then opens the page it is about (if any) or refreshes the list and the top bar's count.
  const act = (notice: StaffNotice, open: boolean) =>
    start(async () => {
      if (!notice.readAt) {
        const result = await markNoticeRead(notice.id);
        if (!result.ok) {
          toast.error(result.message);
          return;
        }
      }
      if (open && notice.href) router.push(notice.href);
      else router.refresh();
    });
  return (
    <ul className="flex flex-col gap-2 p-4">
      {notices.map((n) => (
        <li key={n.id}>
          <Card className={n.readAt ? "opacity-80" : "border-primary/40"}>
            <CardContent className="flex flex-wrap items-start justify-between gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-table font-medium">
                  {n.readAt ? null : (
                    <Badge variant="info">
                      <BellIcon aria-hidden /> New
                    </Badge>
                  )}
                  {n.subject ?? "Message"}
                </p>
                <p className="mt-1 text-table">{n.text}</p>
                <p className="mt-1 text-meta text-muted-foreground">{clinicalDateTime(n.createdAt)}</p>
              </div>
              <div className="flex shrink-0 gap-2">
                {n.href ? (
                  <Button size="sm" variant="outline" disabled={pending} onClick={() => act(n, true)}>
                    Open <ArrowRightIcon />
                  </Button>
                ) : null}
                {n.readAt ? null : (
                  <Button size="sm" variant="ghost" disabled={pending} onClick={() => act(n, false)}>
                    <CheckIcon /> Mark read
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </li>
      ))}
    </ul>
  );
}
