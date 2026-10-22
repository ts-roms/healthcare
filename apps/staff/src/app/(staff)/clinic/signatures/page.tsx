import { redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@healthcare/ui/primitives";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api/client";
import { can, getSession } from "@/lib/api/session";
import type { PractitionerSignatureSetting } from "@/lib/api/types";
import { SignatureSetting } from "./signature-setting";

export const metadata = { title: "Signatures on documents" };

/** Whether medical certificates and referral letters print the issuing practitioner's own signature (off unless turned on). */
export default async function SignaturesPage() {
  const session = await getSession();
  if (!can(session, "clinic.configure")) redirect("/clinic/encounters");
  const setting = await api<PractitionerSignatureSetting>("/clinic/practitioner-signature/settings");
  return (
    <>
      <PageHeader title="Signatures on documents" description="For the whole organization. Changes are audited." />
      <div className="p-4">
        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle>Practitioners&apos; signatures</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-table">
            <p className="text-muted-foreground">
              Each practitioner draws their own signature under <strong>My account</strong>. When this is on, the medical certificates and referral letters they
              issue from then on print it above their name. It is a mark on the page, not a digital or legally qualified signature: who issued each document is
              recorded either way. Documents already issued keep what they printed. Whether your organization wants signatures on its documents is its decision.
            </p>
            <SignatureSetting setting={setting} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
