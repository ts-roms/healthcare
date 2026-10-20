"use client";

import { usePathname, useRouter } from "next/navigation";
import { Label, NativeSelect } from "@healthcare/ui/primitives";
import type { ServicePoint } from "@/lib/api/types";
import { SERVICE_POINT_KIND_LABEL } from "@/lib/clinic-mapping";

/**
 * Which service point the board shows (migration 0113). The choice lives in the URL (`?servicePoint=`), so the live
 * refreshes of the board keep it and a bookmarked link opens one service point's queue — say, the emergency room's.
 */
export function ServicePointSwitcher({ servicePoints, selectedId }: { servicePoints: ServicePoint[]; selectedId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  return (
    <div className="flex items-center gap-2 px-4 pt-4">
      <Label htmlFor="queue-service-point">Service point</Label>
      <NativeSelect
        id="queue-service-point"
        className="w-64"
        value={selectedId}
        emptyText="No service points set up"
        onChange={(e) => router.push(e.target.value ? `${pathname}?servicePoint=${e.target.value}` : pathname)}
      >
        <option value="">All service points</option>
        {servicePoints.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name} · {SERVICE_POINT_KIND_LABEL[s.kind]}
          </option>
        ))}
      </NativeSelect>
    </div>
  );
}
