import Link from "next/link";
import { CalendarIcon, HomeIcon } from "lucide-react";
import { Button, ErrorState } from "@healthcare/ui/primitives";

export const metadata = { title: "Page not found" };

/** A MyHealth page or record that does not exist, or that this account may not open (the two are not told apart). */
export default function PortalNotFound() {
  return (
    <ErrorState
      as="h1"
      tone="notFound"
      title="We can't find that page"
      description="It may have moved, or the link may be wrong. Use the menu, or go back to your home page."
      actions={
        <>
          <Button asChild>
            <Link href="/">
              <HomeIcon /> Home
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/appointments">
              <CalendarIcon /> My appointments
            </Link>
          </Button>
        </>
      }
    />
  );
}
