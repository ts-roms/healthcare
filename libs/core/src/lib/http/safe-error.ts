/**
 * What may be logged about an unexpected error. Query errors from the database layer put the statement and its bound
 * parameters (patient data) into `message`, so the message is dropped for them and the driver's own message (the
 * `cause`, which names the constraint or the failure but not the values) is kept. The stack frames are kept without
 * their leading message lines.
 */
export function safeErrorSummary(exception: unknown): string {
  if (!(exception instanceof Error)) return "non-error exception";
  const message = /^Failed query:/i.test(exception.message)
    ? `database query failed${exception.cause instanceof Error ? `: ${exception.cause.message}` : ""}`
    : exception.message;
  const frames = (exception.stack ?? "")
    .split("\n")
    .filter((line) => /^\s+at /.test(line))
    .join("\n");
  return `${exception.name}: ${message}${frames ? `\n${frames}` : ""}`;
}
