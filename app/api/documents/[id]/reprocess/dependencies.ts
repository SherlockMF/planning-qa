import { getDocument } from "@/lib/db/documents";
import { getStore } from "@/lib/db/store";
import {
  canManageDocumentInManagement,
  resolveKnowledgeUser,
} from "@/lib/knowledge/permissions";
import { getTableReprocess } from "@/lib/reprocess/tableReprocess";
import type { TableReprocessApiDependencies } from "@/lib/reprocess/tableReprocessApi";
import {
  prepareDocumentTableReprocess,
  publishDocumentTableReprocess,
} from "@/lib/reprocess/tableReprocessRuntime";

export const tableReprocessApiDependencies: TableReprocessApiDependencies = {
  getDocument,
  getSourceBuffer: (id) => getStore().rawBuffers[id],
  resolveUser: (userId) => resolveKnowledgeUser({ userId }),
  canManage: canManageDocumentInManagement,
  prepare: prepareDocumentTableReprocess,
  get: getTableReprocess,
  publish: publishDocumentTableReprocess,
};
