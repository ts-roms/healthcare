/**
 * `@healthcare/core/telemetry`: the OpenTelemetry bootstrap. Imported first in each process's `main.ts`, before
 * `@healthcare/core` or anything that loads `http`, `express`, `@nestjs/core`, `pg` or `ioredis`, so the
 * instrumentations see those modules being loaded. This entry imports no other part of the library for that reason.
 */
export * from "./lib/telemetry/start-telemetry";
export * from "./lib/telemetry/scrub";
