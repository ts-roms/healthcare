import Link from "next/link";
import { redirect } from "next/navigation";
import { clinicalDate } from "@healthcare/ui/healthcare";
import { Button, Card, CardContent, CardHeader, CardTitle, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@healthcare/ui/primitives";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api/client";
import { can, getSession } from "@/lib/api/session";
import type { RetentionOverview, RetentionReview } from "@/lib/api/types";
import { DOCUMENT_CATEGORY_LABEL } from "@/lib/records-mapping";
import { EndPolicyButton, RetentionPolicyForm } from "./retention-forms";

export const metadata = { title: "Document retention" };

const label = (category: string) => DOCUMENT_CATEGORY_LABEL[category] ?? category;

/**
 * Document retention: the organization's own period per document category and the documents older than it. Nothing is
 * deleted by the platform; a document is archived from the patient record with a reason, as any document.
 */
export default async function RetentionPage({ searchParams }: { searchParams: Promise<{ category?: string }> }) {
  const [params, session] = await Promise.all([searchParams, getSession()]);
  if (!can(session, "document.retention.manage")) redirect("/");
  const overview = await api<RetentionOverview>("/document-retention");
  const selected = params.category && overview.policies.some((p) => p.category === params.category) ? params.category : undefined;
  const review = selected ? await api<RetentionReview>("/document-retention/review", { query: { category: selected } }) : null;
  return (
    <>
      <PageHeader
        title="Document retention"
        description="How long your organization keeps each kind of document, and which documents are now older than that."
      />
      <div className="flex flex-col gap-4 p-4">
        <p className="rounded-md border border-dashed p-3 text-meta text-muted-foreground">
          No retention period is built in and nothing is ever deleted automatically. Set each period from your organization&apos;s own retention schedule, have
          your Data Protection Officer check it, and record the review under Admin → Compliance. What happens to a document past its period (archiving, disposal
          of the file) follows your own procedure.
        </p>
        <Card>
          <CardHeader>
            <CardTitle>Retention periods</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {overview.policies.length === 0 ? (
              <p className="text-body text-muted-foreground">No retention periods set.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Category</TableHead>
                    <TableHead>Keep for</TableHead>
                    <TableHead>Basis</TableHead>
                    <TableHead>Past the period</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {overview.policies.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">{label(p.category)}</TableCell>
                      <TableCell>
                        {p.retainYears} year{p.retainYears === 1 ? "" : "s"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{p.basisNote}</TableCell>
                      <TableCell>
                        {p.pastPeriod ? (
                          <Link className="text-primary hover:underline" href={`/records/retention?category=${p.category}`}>
                            {p.pastPeriod} document{p.pastPeriod === 1 ? "" : "s"}
                          </Link>
                        ) : (
                          "None"
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <EndPolicyButton category={p.category} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            <RetentionPolicyForm />
          </CardContent>
        </Card>
        {review?.policy ? (
          <Card>
            <CardHeader>
              <CardTitle>
                {label(review.policy.category)} older than {review.policy.retainYears} year{review.policy.retainYears === 1 ? "" : "s"}
              </CardTitle>
              <Button asChild size="xs" variant="ghost" className="ml-auto">
                <Link href="/records/retention">Close</Link>
              </Button>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Stored</TableHead>
                    <TableHead>Document</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {review.documents.map((d) => (
                    <TableRow key={d.id}>
                      <TableCell className="whitespace-nowrap">{clinicalDate(d.uploadedAt)}</TableCell>
                      <TableCell>
                        {d.title} <span className="text-meta text-muted-foreground">· {d.fileName}</span>
                      </TableCell>
                      <TableCell className="text-right">
                        {d.patientId ? (
                          <Link className="text-primary hover:underline" href={`/patients/${d.patientId}`}>
                            Patient record
                          </Link>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {review.more ? <p className="text-meta text-muted-foreground">Showing the oldest 200.</p> : null}
            </CardContent>
          </Card>
        ) : null}
      </div>
    </>
  );
}
