"use client";

import * as React from "react";

/** SSR-safe media query. `serverDefault` is used during SSR and hydration. */
export function useMediaQuery(query: string, serverDefault = true) {
  return React.useSyncExternalStore(
    (cb) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", cb);
      return () => mql.removeEventListener("change", cb);
    },
    () => window.matchMedia(query).matches,
    () => serverDefault,
  );
}
