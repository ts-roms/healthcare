"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BellIcon, CheckCheckIcon } from "lucide-react";
import { clinicalDateTime } from "@healthcare/ui/healthcare";
import { Button, Popover, PopoverContent, PopoverTrigger, toast } from "@healthcare/ui/primitives";
import { markNoticesRead, recentNotices } from "@/app/(staff)/notifications/actions";
import type { StaffNotice } from "@/lib/api/types";

/**
 * The top bar's bell: the number of unread in-app notices, and a dropdown with the latest ones. Opening a notice marks it
 * read and goes to the page it is about; **Mark all read** clears the ones shown. The full list, and this browser's push
 * settings, stay at Notifications. The notices are fetched when the dropdown opens.
 */
export function NotificationBell({ unread }: { unread: number }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [notices, setNotices] = React.useState<StaffNotice[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  const load = () =>
    startTransition(async () => {
      const result = await recentNotices();
      if (result.ok) {
        setNotices(result.data);
        setError(null);
      } else setError(result.message);
    });
  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) load();
  };
  // Marks the notice read, then opens the page it is about (if any).
  const openNotice = (notice: StaffNotice) =>
    startTransition(async () => {
      if (!notice.readAt) {
        const result = await markNoticesRead([notice.id]);
        if (!result.ok) {
          toast.error(result.message);
          return;
        }
      }
      setOpen(false);
      if (notice.href) router.push(notice.href);
      router.refresh();
    });
  const markAllRead = () => {
    const ids = (notices ?? []).filter((n) => !n.readAt).map((n) => n.id);
    if (ids.length === 0) return;
    startTransition(async () => {
      const result = await markNoticesRead(ids);
      if (result.ok) {
        setNotices((current) => (current ?? []).map((n) => (n.readAt ? n : { ...n, readAt: new Date().toISOString() })));
        router.refresh();
      } else toast.error(result.message);
    });
  };

  const unreadShown = (notices ?? []).filter((n) => !n.readAt).length;
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
          aria-haspopup="dialog"
        >
          <BellIcon />
          {unread ? (
            <span className="absolute -top-0.5 -right-0.5 min-w-4 rounded-full bg-primary px-1 text-center text-[10px] leading-4 font-semibold text-primary-foreground tabular-nums">
              {unread > 99 ? "99+" : unread}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[26rem] max-w-[calc(100vw-1rem)] p-0">
        <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
          <h2 className="text-table font-semibold">Notifications</h2>
          <Button type="button" size="xs" variant="ghost" disabled={pending || unreadShown === 0} onClick={markAllRead}>
            <CheckCheckIcon aria-hidden /> Mark all read
          </Button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto" aria-busy={pending}>
          {error ? (
            <p role="alert" className="p-3 text-table text-danger-foreground">
              {error}
            </p>
          ) : notices === null ? (
            <p className="p-3 text-table text-muted-foreground">Loading…</p>
          ) : notices.length === 0 ? (
            <p className="p-3 text-table text-muted-foreground">No notifications.</p>
          ) : (
            <ul className="divide-y">
              {notices.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => openNotice(n)}
                    className="flex w-full items-start gap-2 px-3 py-2.5 text-left transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none disabled:opacity-60"
                  >
                    <span
                      aria-hidden
                      className={n.readAt ? "mt-1.5 size-2 shrink-0 rounded-full border border-border" : "mt-1.5 size-2 shrink-0 rounded-full bg-primary"}
                    />
                    <span className="min-w-0 flex-1">
                      <span className={n.readAt ? "block truncate text-table" : "block truncate text-table font-semibold"}>
                        {n.readAt ? null : <span className="sr-only">Unread: </span>}
                        {n.subject ?? "Message"}
                      </span>
                      <span className="line-clamp-2 text-meta text-muted-foreground">{n.text}</span>
                      <span className="mt-0.5 block text-meta text-muted-foreground">{clinicalDateTime(n.createdAt)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="border-t px-3 py-2">
          <Link href="/notifications" onClick={() => setOpen(false)} className="text-table text-primary hover:underline">
            See all notifications
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
