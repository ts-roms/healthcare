/** Groups permission keys by their first segment ("lab.result.read" → "lab"), in catalog order. */
export function permissionGroups(permissions: readonly string[]): Array<{ area: string; permissions: string[] }> {
  const groups = new Map<string, string[]>();
  for (const permission of permissions) {
    const area = permission.split(".")[0] ?? permission;
    groups.set(area, [...(groups.get(area) ?? []), permission]);
  }
  return [...groups].map(([area, list]) => ({ area, permissions: list }));
}
