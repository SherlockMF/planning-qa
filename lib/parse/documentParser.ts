import type { Block } from "../types.ts";

export type DocumentParserBackend = "native" | "mineru";

export interface ParseDocumentInput {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
}

export interface ParseDocumentResult {
  blocks: Block[];
  backend: DocumentParserBackend;
}

export interface DocumentParser {
  readonly backend: DocumentParserBackend;
  parse(input: ParseDocumentInput): Promise<ParseDocumentResult>;
}

export class DocumentParserConfigurationError extends Error {
  readonly code = "document_parser_configuration_error";
  readonly configuredBackend: string;

  constructor(configuredBackend: string) {
    super(`Unsupported document parser backend: ${configuredBackend}`);
    this.name = "DocumentParserConfigurationError";
    this.configuredBackend = configuredBackend;
  }
}

export class DocumentParserUnavailableError extends Error {
  readonly code = "document_parser_unavailable";
  readonly backend: DocumentParserBackend;

  constructor(backend: DocumentParserBackend) {
    super(`Document parser backend is unavailable: ${backend}`);
    this.name = "DocumentParserUnavailableError";
    this.backend = backend;
  }
}
