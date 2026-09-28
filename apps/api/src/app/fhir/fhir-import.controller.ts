import { Body, Controller, Headers, Post, Req, Res, UseFilters } from "@nestjs/common";
import { ApiBearerAuth, ApiConsumes, ApiHeader, ApiOperation, ApiProduces, ApiTags } from "@nestjs/swagger";
import { type Actor, CurrentActor, RequirePermissions } from "@healthcare/core";
import { FhirImportService, type OperationOutcome } from "@healthcare/interoperability";
import type { Request, Response } from "express";
import { FhirExceptionFilter } from "./fhir-exception.filter";

/**
 * FHIR R4 inbound (docs/interoperability/fhir.md, "Inbound"): a Bundle (collection, document, searchset) or a single
 * resource is received into a review queue — never written into the record. Staff review it at /api/v1/fhir-imports.
 * Requires interop.fhir.import; errors are OperationOutcome resources.
 */
@ApiTags("fhir")
@ApiBearerAuth()
@ApiConsumes("application/fhir+json", "application/json")
@ApiProduces("application/fhir+json")
@UseFilters(FhirExceptionFilter)
@RequirePermissions("interop.fhir.import")
@Controller({ path: "fhir/r4", version: "1" })
export class FhirImportReceiveController {
  constructor(private readonly imports: FhirImportService) {}

  @Post("imports")
  @ApiHeader({ name: "Idempotency-Key", required: false, description: "Required unless the Bundle has an identifier" })
  @ApiOperation({ summary: "Submit FHIR R4 content for staff review (201 new, 200 when the same key and content were received before)" })
  async receive(
    @CurrentActor() actor: Actor,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyKey?: string,
  ): Promise<OperationOutcome> {
    const received = await this.imports.receive(actor, body, idempotencyKey);
    const location = `${request.protocol}://${request.get("host")}/api/v1/fhir-imports/${received.id}`;
    response
      .status(received.replayed ? 200 : 201)
      .type("application/fhir+json")
      .setHeader("Location", location);
    const types = Object.entries(received.resourceCounts)
      .map(([type, n]) => `${n} ${type}`)
      .join(", ");
    return {
      resourceType: "OperationOutcome",
      issue: [
        {
          severity: "information",
          code: "informational",
          details: {
            coding: [{ system: `${request.protocol}://${request.get("host")}/api/v1/fhir-imports`, code: received.id }],
            text: `Import ${received.id}`,
          },
          diagnostics: `${received.replayed ? "Already received" : "Received"} for review as import ${received.id} (${received.status}): ${types}. Nothing is added to the record until staff accept it.`,
        },
        ...(received.notSupported > 0
          ? [
              {
                severity: "warning" as const,
                code: "not-supported" as const,
                diagnostics: `${received.notSupported} entr${received.notSupported === 1 ? "y is" : "ies are"} of a type not supported for import; kept and shown to reviewers as such.`,
              },
            ]
          : []),
      ],
    };
  }
}
