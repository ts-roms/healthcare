"use client";

import * as React from "react";
import { GlobeIcon, LockIcon } from "lucide-react";
import { Checkbox, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, toast } from "@healthcare/ui/primitives";
import type { VisitType } from "@/lib/api/types";
import { setOnlineBooking } from "../actions";

export function VisitTypeList({ visitTypes, canConfigure }: { visitTypes: VisitType[]; canConfigure: boolean }) {
  const [pending, startTransition] = React.useTransition();

  const toggle = (type: VisitType, onlineBooking: boolean) =>
    startTransition(async () => {
      const result = await setOnlineBooking({ visitTypeId: type.id, onlineBooking, version: type.version });
      if (result.ok) toast.success(`${type.name} is ${onlineBooking ? "open" : "closed"} for online booking`);
      else toast.error(result.message);
    });

  return (
    <div className="p-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Visit type</TableHead>
            <TableHead>Where</TableHead>
            <TableHead>Duration</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Online booking</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visitTypes.map((type) => (
            <TableRow key={type.id}>
              <TableCell className="font-medium">{type.name}</TableCell>
              <TableCell>{type.modality === "telemedicine" ? "Online (video)" : "In person"}</TableCell>
              <TableCell className="tabular-nums">{type.defaultDurationMinutes} min</TableCell>
              <TableCell>{type.status === "active" ? "Active" : "Inactive"}</TableCell>
              <TableCell>
                <label className="flex items-center gap-2">
                  <Checkbox
                    checked={type.onlineBooking}
                    disabled={!canConfigure || pending || type.status !== "active"}
                    onCheckedChange={(checked) => toggle(type, checked === true)}
                    aria-label={`Patients may book ${type.name} online`}
                  />
                  {type.onlineBooking ? (
                    <span className="flex items-center gap-1">
                      <GlobeIcon className="size-3.5" aria-hidden /> Patients can book
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <LockIcon className="size-3.5" aria-hidden /> Staff only
                    </span>
                  )}
                </label>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {!canConfigure ? <p className="mt-3 text-table text-muted-foreground">Only clinic administrators can change these settings.</p> : null}
    </div>
  );
}
