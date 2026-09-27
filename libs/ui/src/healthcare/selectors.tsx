"use client";

import * as React from "react";
import type { Facility, Provider } from "@healthcare/domain";
import { NativeSelect } from "../primitives/select";

type SelectProps = Omit<React.ComponentProps<typeof NativeSelect>, "children" | "onChange"> & {
  value?: string;
  onValueChange?: (id: string) => void;
};

export function ProviderSelector({ providers, value, onValueChange, ...props }: SelectProps & { providers: Provider[] }) {
  return (
    <NativeSelect aria-label="Provider" value={value} onChange={(e) => onValueChange?.(e.target.value)} {...props}>
      {providers.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name} — {p.specialty}
        </option>
      ))}
    </NativeSelect>
  );
}

export function FacilitySelector({ facilities, value, onValueChange, ...props }: SelectProps & { facilities: Facility[] }) {
  return (
    <NativeSelect aria-label="Facility" value={value} onChange={(e) => onValueChange?.(e.target.value)} {...props}>
      {facilities.map((f) => (
        <option key={f.id} value={f.id}>
          {f.name}
        </option>
      ))}
    </NativeSelect>
  );
}
