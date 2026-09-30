import { DomainError } from "@healthcare/core";

/** A guardian's request to act for another person is refused: 403 with a code the MyHealth app acts on. */
export class ProxyRefusedError extends DomainError {
  readonly httpStatus = 403;
  constructor(
    message: string,
    readonly code: "proxy_not_allowed" | "proxy_view_only",
  ) {
    super(message);
  }
}
