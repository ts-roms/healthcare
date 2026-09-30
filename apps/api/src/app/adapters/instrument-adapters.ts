import { Injectable } from "@nestjs/common";
import { InstrumentMessageError, parseInstrumentMessage } from "@healthcare/interoperability";
import type { InstrumentMessageReader, InstrumentProtocol, InstrumentReadOutcome, SpecimenIdField } from "@healthcare/laboratory";

/** The laboratory's analyzer message reader, over the interoperability layer's HL7 v2 / ASTM parsers. */
@Injectable()
export class AppInstrumentMessageReader implements InstrumentMessageReader {
  read(protocol: InstrumentProtocol, text: string, specimenField: SpecimenIdField): InstrumentReadOutcome {
    try {
      const message = parseInstrumentMessage(protocol, text, specimenField);
      return { ok: true, controlId: message.controlId, results: message.results };
    } catch (error) {
      if (error instanceof InstrumentMessageError) return { ok: false, code: error.code, detail: error.message };
      throw error;
    }
  }
}
