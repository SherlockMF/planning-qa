import {
  DocumentParserConfigurationError,
  DocumentParserUnavailableError,
  type DocumentParser,
  type ParseDocumentInput,
  type ParseDocumentResult,
} from "./documentParser.ts";
import { nativeDocumentParser } from "./nativeDocumentParser.ts";

export interface ParseDocumentOptions {
  backend?: string;
  parser?: DocumentParser;
}

export function resolveDocumentParser(
  configuredBackend: string | undefined,
  nativeParser: DocumentParser = nativeDocumentParser
): DocumentParser {
  const backend = (configuredBackend ?? "native").trim().toLowerCase() || "native";
  if (backend === "native") return nativeParser;
  if (backend === "mineru") {
    throw new DocumentParserUnavailableError("mineru");
  }
  throw new DocumentParserConfigurationError(configuredBackend ?? backend);
}

export async function parseDocument(
  input: ParseDocumentInput,
  options: ParseDocumentOptions = {}
): Promise<ParseDocumentResult> {
  const parser =
    options.parser ??
    resolveDocumentParser(options.backend ?? process.env.DOCUMENT_PARSER);
  return parser.parse(input);
}
