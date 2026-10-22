import Link from "next/link";
import { ArrowLeftIcon, HomeIcon } from "lucide-react";
import { Button, ErrorState } from "@healthcare/ui/primitives";

export const metadata = { title: "Page not found" };

/** A page or record that does not exist, or that this account may not open (the two are not told apart). Drawn inside the staff shell. */
export default function StaffNotFound() {
  return (
    <ErrorState
      as="h1"
      tone="notFound"
      title="Page not found"
      description="The page or record you asked for does not exist, or you do not have access to it. Check the address, or use the menu to find it."
      actions={
        <>
          <Button asChild size="sm">
            <Link href="/">
              <HomeIcon /> Dashboard
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href="/patients">
              <ArrowLeftIcon /> Find a patient
            </Link>
          </Button>
        </>
      }
    />
  );
}
