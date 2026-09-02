import type { DocumentParser } from "./documentParser.ts";
import { extractBlocksWithTables } from "./tablesSidecar.ts";

export const nativeDocumentParser: DocumentParser = {
  backend: "native",
  async parse(input) {
    return {
      blocks: await extractBlocksWithTables(input.buffer),
      backend: "native",
    };
  },
};
