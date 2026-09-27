/** Shown by facility-scoped screens (queue, check-in) until a facility is selected in the top bar. */
export function FacilityRequired({ action }: { action: string }) {
  return (
    <p role="alert" className="m-4 rounded-md border border-warning/40 bg-warning-subtle px-3 py-2 text-warning-foreground">
      Select your facility in the top bar first. {action}
    </p>
  );
}
