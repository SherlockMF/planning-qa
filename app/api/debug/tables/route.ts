import { NextResponse } from "next/server";
import { listRagTables, rebuildAllRagTables } from "@/lib/db/ragTables";
import { writeAllTableDebug } from "@/lib/debug/tableDebug";

// 把当前 store 中全部 RagTable 导出为 debug/tables/{docId}/*.json|html|txt。
// 先用升级后的合成逻辑重建（应用页码清理/续写归并/告警），再导出供人工核查。
export async function POST() {
  await rebuildAllRagTables();
  const tables = await listRagTables();
  const count = writeAllTableDebug(tables);
  // 汇总各表告警，便于一眼定位问题表
  const withWarnings = tables
    .filter((t) => t.warnings.length > 0)
    .map((t) => ({
      tableId: t.tableId,
      docId: t.docId,
      tableTitle: t.tableTitle.slice(0, 40),
      tableType: t.tableType,
      confidence: t.confidence,
      warnings: t.warnings,
    }));
  return NextResponse.json({
    written: count,
    total: tables.length,
    dir: "debug/tables",
    tablesWithWarnings: withWarnings.length,
    warnings: withWarnings,
  });
}

export async function GET() {
  return POST();
}
