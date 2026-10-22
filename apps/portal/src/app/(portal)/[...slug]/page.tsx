import { notFound } from "next/navigation";

/**
 * Every MyHealth section is its own page, so an address that reaches this catch-all is one that does not exist:
 * answer with the real 404 (drawn inside MyHealth) rather than a "coming soon" page for any typo.
 */
export default function UnknownPage(): never {
  notFound();
}
