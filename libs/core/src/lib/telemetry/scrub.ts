import type { Span } from "@opentelemetry/sdk-trace-base";
import type { ReadableSpan, SpanProcessor } from "@opentelemetry/sdk-trace-base";

/**
 * Span attributes that can carry a patient's or a person's data and are therefore never exported
 * (docs/architecture/observability.md): a URL holds record ids, a query string holds search terms, headers hold
 * tokens, and the client address and user agent identify a person. The route template, method and status stay.
 */
const DROPPED_ATTRIBUTES = new Set([
  // URL and query: the ids and search terms a request carries.
  "http.url",
  "http.target",
  "url.full",
  "url.path",
  "url.query",
  "http.host",
  // Who the client is.
  "net.peer.ip",
  "net.peer.name",
  "net.peer.port",
  "client.address",
  "client.port",
  "network.peer.address",
  "network.peer.port",
  "net.host.ip",
  "http.client_ip",
  "user_agent.original",
  "http.user_agent",
  // Redis commands name keys that can contain an address (throttle:*) or a session id.
  "db.query.text",
]);

/** Prefixes of attributes that are never exported (request and response headers, Redis command arguments). */
const DROPPED_PREFIXES = ["http.request.header.", "http.response.header.", "db.query.parameter."];

export function isDroppedAttribute(key: string): boolean {
  return DROPPED_ATTRIBUTES.has(key) || DROPPED_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/** Removes the attributes above from a span, in place. Returns which keys were removed (for tests). */
export function scrubSpanAttributes(span: Pick<ReadableSpan, "attributes">): string[] {
  const removed: string[] = [];
  const attributes = span.attributes as Record<string, unknown>;
  for (const key of Object.keys(attributes)) {
    if (!isDroppedAttribute(key)) continue;
    delete attributes[key];
    removed.push(key);
  }
  return removed;
}

/**
 * A span processor that scrubs every span before it reaches the exporter. Registered before the batch processor,
 * so what the exporter sees never had the attributes.
 */
export class ScrubbingSpanProcessor implements SpanProcessor {
  onStart(_span: Span): void {
    // Nothing: attributes are added during the span's life and scrubbed once it ends.
  }

  onEnd(span: ReadableSpan): void {
    scrubSpanAttributes(span);
  }

  async shutdown(): Promise<void> {
    // Nothing to release.
  }

  async forceFlush(): Promise<void> {
    // Nothing buffered.
  }
}
