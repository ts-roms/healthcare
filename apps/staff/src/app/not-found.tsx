import Link from "next/link";
import { HomeIcon } from "lucide-react";
import { Button, ErrorState } from "@healthcare/ui/primitives";

export const metadata = { title: "Page not found" };

/** An address outside every section of the app (signed-in pages have their own, inside the shell). */
export default function RootNotFound() {
  return (
    <main className="grid min-h-dvh place-items-center bg-background p-4">
      <ErrorState
        as="h1"
        tone="notFound"
        title="Page not found"
        description="This address does not lead anywhere. Check it, or go to the start page."
        actions={
          <Button asChild size="sm">
            <Link href="/">
              <HomeIcon /> Go to the start page
            </Link>
          </Button>
        }
      />
    </main>
  );
}
