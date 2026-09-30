import { cookies } from "next/headers";
import { portalApi } from "@/lib/api/client";
import { getMe } from "@/lib/api/session";
import type { PortalDependent, PortalGuardian } from "@/lib/api/types";
import { ACTING_COOKIE } from "@/lib/proxy-access";
import { backToMyself } from "./actions";
import { PeopleList } from "./people-list";
import { Button } from "@healthcare/ui/primitives";

export const metadata = { title: "People" };

export default async function PeoplePage({ searchParams }: { searchParams: Promise<{ own?: string; ended?: string }> }) {
  const params = await searchParams;
  const [me, dependents, guardians, jar] = await Promise.all([
    getMe(),
    portalApi<PortalDependent[]>("/portal/proxy/dependents"),
    portalApi<PortalGuardian[]>("/portal/proxy/guardians"),
    cookies(),
  ]);
  const acting = Boolean(jar.get(ACTING_COOKIE)?.value) && me.acting !== null;
  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-page-lg font-semibold">People</h1>
      {params.own ? (
        <p role="status" className="rounded-lg border bg-muted p-3 text-body">
          Sign-in security, notification settings and consents belong to your own account. Go back to your own MyHealth to change them.
        </p>
      ) : null}
      {params.ended ? (
        <p role="status" className="rounded-lg border bg-muted p-3 text-body">
          You can no longer act for that person. You are back in your own MyHealth.
        </p>
      ) : null}
      {acting ? (
        <form action={backToMyself}>
          <Button type="submit" variant="outline">
            Back to my own MyHealth
          </Button>
        </form>
      ) : null}
      <PeopleList dependents={dependents} guardians={guardians} timeZone={me.timeZone} />
    </div>
  );
}
