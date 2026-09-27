"use client";

import * as React from "react";
import { markMessagesRead } from "./actions";

/** Once the page has been shown, marks the new messages as read and refreshes the unread badge. */
export function MarkRead({ ids }: { ids: string[] }) {
  const key = ids.join(",");
  React.useEffect(() => {
    if (key) void markMessagesRead(key.split(","));
  }, [key]);
  return null;
}
