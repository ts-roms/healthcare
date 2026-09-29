/**
 * Formats a failure of the database tools for the console.
 * On Windows `localhost` resolves to both ::1 and 127.0.0.1, so a refused connection
 * surfaces as an AggregateError with an empty message; list every attempt instead.
 */
export function describeError(error: unknown): string {
  const attempts = error instanceof AggregateError && error.errors.length > 0 ? (error.errors as unknown[]) : [error];
  const lines = attempts.map((attempt) => {
    if (!(attempt instanceof Error)) return String(attempt);
    const code = (attempt as NodeJS.ErrnoException).code;
    const message = attempt.message || attempt.name;
    return code && !message.includes(code) ? `${code}: ${message}` : message;
  });
  const text = attempts.length > 1 ? ["Could not connect to the database:", ...lines.map((line) => `  - ${line}`)].join("\n") : lines[0]!;
  const refused = attempts.some((attempt) => (attempt as NodeJS.ErrnoException | undefined)?.code === "ECONNREFUSED");
  return refused ? `${text}\nIs PostgreSQL running? Start it with: docker compose -f infrastructure/docker/docker-compose.yml up -d postgres` : text;
}
