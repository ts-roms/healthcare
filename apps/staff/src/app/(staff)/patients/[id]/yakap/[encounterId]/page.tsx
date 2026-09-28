import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";
import { ApiError } from "@healthcare/web-session";
import { Button } from "@healthcare/ui/primitives";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api/client";
import { can, getSession } from "@/lib/api/session";
import type { YakapPackagePreview } from "@/lib/api/types";
import { YakapPackage } from "./yakap-package";

// Never put patient names in the tab title.
export const metadata = { title: "YAKAP encounter package" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The YAKAP encounter package of one consultation, reached from the patient record's PhilHealth YAKAP card: what the
 * platform can prepare from its own records, what is still missing, and earlier submissions. Viewing it is audited.
 */
export default async function YakapPackagePage({ params }: { params: Promise<{ id: string; encounterId: string }> }) {
  const [{ id, encounterId }, session] = await Promise.all([params, getSession()]);
  if (!can(session, "philhealth.claim.submit")) redirect(`/patients/${id}`);
  if (!UUID.test(id) || !UUID.test(encounterId)) notFound();
  const preview = await api<YakapPackagePreview>(`/philhealth/yakap/encounters/${encounterId}`).catch((error: unknown) => {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  });
  if (preview.patientId !== id) notFound();
  return (
    <>
      <PageHeader
        title="YAKAP encounter package"
        description="Prepared from this platform's records. Not a PhilHealth form."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href={`/patients/${id}`}>
              <ArrowLeftIcon aria-hidden /> Patient record
            </Link>
          </Button>
        }
      />
      <div className="p-4">
        <YakapPackage preview={preview} />
      </div>
    </>
  );
}
