import type * as React from "react";
import Link from "next/link";
import { ShieldAlertIcon } from "lucide-react";
import { Button, Card, CardContent } from "@healthcare/ui/primitives";
import { ApiError } from "@healthcare/web-session";

/**
 * The API refuses platform routes to an administrator without two-step verification (`platform_admin_mfa_required`):
 * say so and point to My account instead of failing the page. Any other error is thrown on.
 */
export function platformAccessProblem(error: unknown): React.ReactNode {
  if (error instanceof ApiError && error.code === "platform_admin_mfa_required") {
    return (
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 py-4">
          <ShieldAlertIcon className="size-5 text-warning-foreground" aria-hidden />
          <p className="flex-1 text-body">The platform console needs two-step verification on your account. Turn it on first, then sign in again.</p>
          <Button asChild size="sm" variant="outline">
            <Link href="/account">My account</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }
  throw error;
}
