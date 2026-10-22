import Link from "next/link";
import { HomeIcon } from "lucide-react";
import { Button, ErrorState } from "@healthcare/ui/primitives";

export const metadata = { title: "Page not found" };

/** An address outside every section of MyHealth (signed-in pages have their own, inside the menu). */
export default function RootNotFound() {
  return (
    <main className="grid min-h-dvh place-items-center bg-background p-4">
      <ErrorState
        as="h1"
        tone="notFound"
        title="We can't find that page"
        description="This address does not lead anywhere. Check the link, or go to MyHealth."
        actions={
          <Button asChild>
            <Link href="/">
              <HomeIcon /> Go to MyHealth
            </Link>
          </Button>
        }
      />
    </main>
  );
}
