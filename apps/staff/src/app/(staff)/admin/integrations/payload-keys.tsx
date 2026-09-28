import { CheckCircle2Icon, KeyRoundIcon, TriangleAlertIcon } from "lucide-react";
import { Badge, Card, CardContent, CardHeader, CardTitle, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@healthcare/ui/primitives";
import type { PayloadKeyOverview, PayloadKeyUsage } from "@/lib/api/types";

function KeyState({ k }: { k: PayloadKeyUsage }) {
  const inUse = k.queuedPayloads + k.importContents > 0;
  if (k.current)
    return (
      <Badge variant="success">
        <KeyRoundIcon aria-hidden /> Current
      </Badge>
    );
  if (!k.configured && inUse)
    return (
      <Badge variant="danger">
        <TriangleAlertIcon aria-hidden /> Missing — stored values cannot be opened
      </Badge>
    );
  if (inUse)
    return (
      <Badge variant="warning">
        <KeyRoundIcon aria-hidden /> Still needed
      </Badge>
    );
  return (
    <Badge variant="neutral">
      <CheckCircle2Icon aria-hidden /> Not needed — can be removed
    </Badge>
  );
}

/**
 * Integration payload keys across the platform (platform administrators): which key ids stored values still need,
 * checked before removing a key (docs/runbooks/integration-payload-key-rotation.md). Counts and key ids only.
 */
export function PayloadKeys({ overview }: { overview: PayloadKeyOverview }) {
  return (
    <Card className="py-0">
      <CardHeader className="pt-4">
        <CardTitle>Payload encryption keys</CardTitle>
        <p className="text-meta text-muted-foreground">
          Across all organizations. A key can be removed from the API and the integration worker once nothing still needs it. Values listed without a key id
          were sealed before key ids existed and open with any configured key.
        </p>
      </CardHeader>
      <CardContent className="px-0 pb-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Key id</TableHead>
              <TableHead>State</TableHead>
              <TableHead className="text-right">Queued payloads</TableHead>
              <TableHead className="text-right">Stored FHIR imports</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {overview.keys.map((k) => (
              <TableRow key={k.keyId ?? "(none)"}>
                <TableCell className="font-mono">{k.keyId ?? "— (before key ids)"}</TableCell>
                <TableCell>
                  <KeyState k={k} />
                </TableCell>
                <TableCell className="text-right tabular-nums">{k.queuedPayloads}</TableCell>
                <TableCell className="text-right tabular-nums">{k.importContents}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
