"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EvaluationItem, EvaluationStats } from "@/lib/types";
import { KNOWLEDGE_USERS, userLabel } from "@/lib/knowledge/permissions";
import {
  parseEvaluationImport,
  parseRowsToEvaluation,
  type ImportResult,
} from "@/lib/evaluation/importParser";
import { downloadEvaluationXlsx } from "@/lib/evaluation/exportResults";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { EvaluationStatsPanel } from "@/components/EvaluationTable";
import {
  Play,
  Loader2,
  Plus,
  Save,
  Pencil,
  Trash2,
  Eye,
  RotateCcw,
  Upload,
  Download,
  ShieldCheck,
} from "lucide-react";

/** 纯客户端统计（与服务端 computeStats 等价），用于本地编辑后实时更新面板。 */
function computeStatsLocal(items: EvaluationItem[]): EvaluationStats {
  const ran = items.filter((i) => i.answerScore !== undefined);
  const scored = ran.map((i) => i.answerScore as number);
  const errorReasonSummary: Record<string, number> = {};
  for (const i of items) {
    if (i.errorReason) {
      errorReasonSummary[i.errorReason] =
        (errorReasonSummary[i.errorReason] ?? 0) + 1;
    }
  }
  return {
    total: items.length,
    inTop5Count: items.filter((i) => i.inTop5 === true).length,
    citationCorrectCount: items.filter((i) => i.citationCorrect === true).length,
    averageScore:
      scored.length > 0
        ? Number((scored.reduce((a, b) => a + b, 0) / scored.length).toFixed(2))
        : 0,
    refusedCorrectlyCount: items.filter(
      (i) => i.shouldRefuse && i.refusedCorrectly === true
    ).length,
    errorReasonSummary,
  };
}

const EMPTY_ITEM = (): EvaluationItem => ({
  id: `eval-custom-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  question: "",
  standardAnswer: "",
  correctFile: "",
  correctArticle: "",
  correctPage: "",
  shouldRefuse: false,
  scenario: "",
  userId: "",
  expectedBehavior: "",
});

export function EvaluationManager() {
  const [items, setItems] = useState<EvaluationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  // 编辑/新增对话框
  const [draft, setDraft] = useState<EvaluationItem | null>(null);
  const [isNew, setIsNew] = useState(false);
  // 查看系统回答
  const [viewing, setViewing] = useState<EvaluationItem | null>(null);
  // 多选
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // 导入题库
  const [importOpen, setImportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  const stats = useMemo(() => computeStatsLocal(items), [items]);

  const allSelected = items.length > 0 && selected.size === items.length;

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected((prev) =>
      prev.size === items.length ? new Set() : new Set(items.map((i) => i.id))
    );
  }

  function deleteSelected() {
    if (selected.size === 0) return;
    if (!confirm(`确定删除所选 ${selected.size} 道题目？`)) return;
    setItems((arr) => arr.filter((it) => !selected.has(it.id)));
    setSelected(new Set());
    setDirty(true);
  }

  function importItems(newItems: EvaluationItem[]) {
    setItems((arr) => [...arr, ...newItems]);
    setDirty(true);
  }

  const load = useCallback(async () => {
    const res = await fetch("/api/evaluation", { cache: "no-store" });
    const data = await res.json();
    setItems(data.items ?? []);
    setLoading(false);
    setDirty(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function patchItem(id: string, patch: Partial<EvaluationItem>) {
    setItems((arr) => arr.map((it) => (it.id === id ? { ...it, ...patch } : it)));
    setDirty(true);
  }

  function removeItem(id: string) {
    if (!confirm("确定删除该题目？")) return;
    setItems((arr) => arr.filter((it) => it.id !== id));
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setDirty(true);
  }

  function openAdd() {
    setDraft(EMPTY_ITEM());
    setIsNew(true);
  }
  function openEdit(it: EvaluationItem) {
    setDraft({ ...it });
    setIsNew(false);
  }
  function saveDraft() {
    if (!draft) return;
    if (!draft.question.trim()) {
      alert("请填写问题");
      return;
    }
    setItems((arr) =>
      isNew ? [...arr, draft] : arr.map((it) => (it.id === draft.id ? draft : it))
    );
    setDirty(true);
    setDraft(null);
  }

  async function persist() {
    setSaving(true);
    try {
      const res = await fetch("/api/evaluation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      const data = await res.json();
      setItems(data.items ?? items);
      setDirty(false);
    } finally {
      setSaving(false);
    }
  }

  async function reset() {
    if (!confirm("将题库重置为内置示例题库？当前编辑内容会被覆盖。")) return;
    setSaving(true);
    try {
      const res = await fetch("/api/evaluation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reset" }),
      });
      const data = await res.json();
      setItems(data.items ?? []);
      setDirty(false);
    } finally {
      setSaving(false);
    }
  }

  async function addEnterpriseSamples() {
    setSaving(true);
    try {
      const res = await fetch("/api/evaluation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "add-enterprise-samples" }),
      });
      const data = await res.json();
      setItems(data.items ?? []);
      setDirty(false);
    } finally {
      setSaving(false);
    }
  }

  async function run(runIds?: string[]) {
    setRunning(true);
    try {
      // 把当前（含新增/编辑）的题库一并提交；runIds 非空时仅运行所选题
      const res = await fetch("/api/evaluation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "run", items, runIds }),
      });
      const data = await res.json();
      setItems(data.items ?? []);
      setDirty(false);
    } finally {
      setRunning(false);
    }
  }

  async function exportResults(targets?: EvaluationItem[]) {
    const list = targets ?? items;
    if (!list.length) {
      alert("暂无题目可导出");
      return;
    }
    setExporting(true);
    try {
      await downloadEvaluationXlsx(list);
    } catch (e) {
      alert(e instanceof Error ? e.message : "导出失败");
    } finally {
      setExporting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        加载题库…
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <EvaluationStatsPanel stats={stats} />

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" onClick={openAdd}>
          <Plus className="h-4 w-4" />
          新增题目
        </Button>
        <Button variant="outline" onClick={() => setImportOpen(true)}>
          <Upload className="h-4 w-4" />
          导入题库
        </Button>
        <Button
          variant="outline"
          onClick={addEnterpriseSamples}
          disabled={saving || running}
        >
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ShieldCheck className="h-4 w-4" />
          )}
          加入企业知识库测试题
        </Button>
        <Button
          variant="outline"
          onClick={() => exportResults()}
          disabled={exporting || items.length === 0}
        >
          {exporting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
          导出结果
        </Button>
        <Button variant="outline" onClick={persist} disabled={saving || !dirty}>
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          保存{dirty ? "（有改动）" : ""}
        </Button>
        <Button onClick={() => run()} disabled={running}>
          {running ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Play className="h-4 w-4" />
          )}
          运行全部（自动判分）
        </Button>
        <Button variant="ghost" onClick={reset} disabled={saving || running}>
          <RotateCcw className="h-4 w-4" />
          重置示例题库
        </Button>
        <span className="text-xs text-muted-foreground">
          运行后会自动回填系统回答与建议分数；可在表格中手动调整得分/判定后再「保存」。
        </span>
      </div>

      {/* 多选操作条 */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
          <span className="text-muted-foreground">已选 {selected.size} 道</span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => run([...selected])}
            disabled={running}
          >
            {running ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
            运行所选
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              exportResults(items.filter((it) => selected.has(it.id)))
            }
            disabled={exporting}
          >
            {exporting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
            导出所选
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={deleteSelected}
            className="text-destructive hover:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" />
            删除所选
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            取消选择
          </Button>
        </div>
      )}

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <input
                  type="checkbox"
                  className="h-4 w-4 cursor-pointer accent-primary"
                  checked={allSelected}
                  ref={(el) => {
                    if (el)
                      el.indeterminate =
                        selected.size > 0 && !allSelected;
                  }}
                  onChange={toggleSelectAll}
                  aria-label="全选"
                />
              </TableHead>
              <TableHead className="w-14">序号</TableHead>
              <TableHead className="min-w-[190px]">问题 / 标准答案</TableHead>
              <TableHead className="min-w-[130px]">正确文件 / 条款 / 页码</TableHead>
              <TableHead>应拒答</TableHead>
              <TableHead>进Top5</TableHead>
              <TableHead>引用正确</TableHead>
              <TableHead>正确拒答</TableHead>
              <TableHead>答案得分</TableHead>
              <TableHead className="w-20">耗时</TableHead>
              <TableHead className="w-20">Token</TableHead>
              <TableHead className="min-w-[110px]">错误原因</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((it, idx) => (
              <TableRow
                key={it.id}
                className={selected.has(it.id) ? "bg-primary/5" : undefined}
              >
                <TableCell className="align-top">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 cursor-pointer accent-primary"
                    checked={selected.has(it.id)}
                    onChange={() => toggleSelect(it.id)}
                    aria-label="选择该题"
                  />
                </TableCell>
                <TableCell className="align-top text-xs text-muted-foreground">
                  {it.seq || idx + 1}
                </TableCell>
                <TableCell className="align-top text-sm text-slate-800">
                  {it.question || <span className="text-muted-foreground">（空）</span>}
                  {(it.scenario || it.userId) && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {it.scenario && (
                        <Badge variant="secondary">{it.scenario}</Badge>
                      )}
                      {it.userId && (
                        <Badge variant="outline">{formatEvaluationUser(it.userId)}</Badge>
                      )}
                    </div>
                  )}
                  <p className="mt-1 text-xs text-muted-foreground">
                    标准：{it.standardAnswer || "—"}
                  </p>
                  {it.expectedBehavior && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      预期：{it.expectedBehavior}
                    </p>
                  )}
                </TableCell>
                <TableCell className="align-top text-xs text-muted-foreground">
                  <div>{it.correctFile || "—"}</div>
                  <div>
                    {(it.correctArticle || "—")}　第{it.correctPage || "—"}页
                  </div>
                </TableCell>
                <TableCell className="align-top">
                  <Badge variant={it.shouldRefuse ? "warning" : "secondary"}>
                    {it.shouldRefuse ? "是" : "否"}
                  </Badge>
                </TableCell>
                <TableCell className="align-top">
                  <TriBadge value={it.inTop5} />
                </TableCell>
                <TableCell className="align-top">
                  <TriBadge value={it.citationCorrect} />
                </TableCell>
                <TableCell className="align-top">
                  {it.shouldRefuse ? (
                    <Select
                      value={triToStr(it.refusedCorrectly)}
                      onChange={(e) =>
                        patchItem(it.id, {
                          refusedCorrectly: strToTri(e.target.value),
                        })
                      }
                      className="h-7 w-16 text-xs"
                    >
                      <option value="">—</option>
                      <option value="true">是</option>
                      <option value="false">否</option>
                    </Select>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="align-top">
                  <Select
                    value={it.answerScore === undefined ? "" : String(it.answerScore)}
                    onChange={(e) =>
                      patchItem(it.id, {
                        answerScore:
                          e.target.value === ""
                            ? undefined
                            : (Number(e.target.value) as 0 | 1 | 2),
                      })
                    }
                    className="h-7 w-16 text-xs"
                  >
                    <option value="">—</option>
                    <option value="0">0</option>
                    <option value="1">1</option>
                    <option value="2">2</option>
                  </Select>
                </TableCell>
                <TableCell className="align-top text-xs tabular-nums text-muted-foreground">
                  {formatDuration(it.answerDurationMs)}
                </TableCell>
                <TableCell className="align-top text-xs tabular-nums text-muted-foreground">
                  {formatTokens(it.tokensUsed)}
                </TableCell>
                <TableCell className="align-top">
                  <Input
                    value={it.errorReason ?? ""}
                    onChange={(e) =>
                      patchItem(it.id, { errorReason: e.target.value })
                    }
                    placeholder="—"
                    className="h-7 text-xs"
                  />
                </TableCell>
                <TableCell className="align-top text-right">
                  <div className="flex justify-end gap-1">
                    {it.systemAnswer && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setViewing(it)}
                        title="查看系统回答"
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => openEdit(it)}
                      title="编辑题目"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => removeItem(it.id)}
                      className="text-destructive hover:text-destructive"
                      title="删除题目"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {items.length === 0 && (
              <TableRow>
                <TableCell colSpan={13} className="py-8 text-center text-sm text-muted-foreground">
                  暂无题目，点击「新增题目」录入，或「导入题库」批量导入。
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* 新增/编辑对话框 */}
      <Dialog open={!!draft} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{isNew ? "新增题目" : "编辑题目"}</DialogTitle>
          </DialogHeader>
          {draft && (
            <div className="space-y-3">
              <Field label="问题">
                <Textarea
                  value={draft.question}
                  onChange={(e) => setDraft({ ...draft, question: e.target.value })}
                  rows={2}
                />
              </Field>
              <Field label="标准答案">
                <Textarea
                  value={draft.standardAnswer}
                  onChange={(e) =>
                    setDraft({ ...draft, standardAnswer: e.target.value })
                  }
                  rows={2}
                />
              </Field>
              <div className="grid grid-cols-3 gap-3">
                <Field label="场景">
                  <Input
                    value={draft.scenario ?? ""}
                    onChange={(e) =>
                      setDraft({ ...draft, scenario: e.target.value })
                    }
                  />
                </Field>
                <Field label="模拟账号">
                  <Select
                    value={draft.userId ?? ""}
                    onChange={(e) =>
                      setDraft({ ...draft, userId: e.target.value })
                    }
                  >
                    <option value="">默认账号</option>
                    {KNOWLEDGE_USERS.map((user) => (
                      <option key={user.id} value={user.id}>
                        {userLabel(user)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="正确文件">
                  <Input
                    value={draft.correctFile}
                    onChange={(e) =>
                      setDraft({ ...draft, correctFile: e.target.value })
                    }
                  />
                </Field>
                <Field label="正确条款">
                  <Input
                    value={draft.correctArticle}
                    onChange={(e) =>
                      setDraft({ ...draft, correctArticle: e.target.value })
                    }
                  />
                </Field>
                <Field label="正确页码">
                  <Input
                    value={draft.correctPage}
                    onChange={(e) =>
                      setDraft({ ...draft, correctPage: e.target.value })
                    }
                  />
                </Field>
              </div>
              <Field label="预期行为">
                <Textarea
                  value={draft.expectedBehavior ?? ""}
                  onChange={(e) =>
                    setDraft({ ...draft, expectedBehavior: e.target.value })
                  }
                  rows={2}
                />
              </Field>
              <Field label="该题是否应当拒答">
                <Select
                  value={draft.shouldRefuse ? "true" : "false"}
                  onChange={(e) =>
                    setDraft({ ...draft, shouldRefuse: e.target.value === "true" })
                  }
                >
                  <option value="false">否（应作答）</option>
                  <option value="true">是（应拒答）</option>
                </Select>
              </Field>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)}>
              取消
            </Button>
            <Button onClick={saveDraft}>确定</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 导入题库 */}
      <ImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImport={importItems}
      />

      {/* 查看系统回答 */}
      <Dialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-base">系统回答</DialogTitle>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-auto rounded-md bg-muted/40 p-4">
            <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-slate-800">
              {viewing?.systemAnswer}
            </pre>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ImportDialog({
  open,
  onClose,
  onImport,
}: {
  open: boolean;
  onClose: () => void;
  onImport: (items: EvaluationItem[]) => void;
}) {
  const [text, setText] = useState("");
  const [shouldRefuse, setShouldRefuse] = useState(false);
  // XLSX 解析结果（二进制无法走文本框，单独保存）
  const [xlsxResult, setXlsxResult] = useState<ImportResult | null>(null);
  const [xlsxName, setXlsxName] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // 优先使用 XLSX 结果；否则解析文本框内容
  const result: ImportResult | null = useMemo(() => {
    if (xlsxResult) return xlsxResult;
    return text.trim() ? parseEvaluationImport(text) : null;
  }, [text, xlsxResult]);

  function reset() {
    setText("");
    setShouldRefuse(false);
    setXlsxResult(null);
    setXlsxName(null);
    setFileError(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileError(null);
    const isExcel = /\.(xlsx|xls)$/i.test(file.name);
    if (isExcel) {
      try {
        // 按需加载 SheetJS，避免增大主包体积
        const XLSX = await import("xlsx");
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array" });

        // 扫描所有工作表，选用能解析出最多题目的那个
        // （兼容数据不在第一个 sheet、或前面有空白/说明 sheet 的情况）
        let best: { name: string; result: ImportResult } | null = null;
        for (const name of wb.SheetNames) {
          const sheet = wb.Sheets[name];
          if (!sheet) continue;
          const rows = XLSX.utils.sheet_to_json<string[]>(sheet, {
            header: 1,
            blankrows: false,
            defval: "",
            raw: false,
          });
          const result = parseRowsToEvaluation(rows);
          if (!best || result.rows.length > best.result.rows.length) {
            best = { name, result };
          }
        }

        setText("");
        if (!best || best.result.rows.length === 0) {
          setXlsxResult(null);
          setXlsxName(null);
          setFileError(
            `未从 Excel 解析到题目。工作表：${wb.SheetNames.join("、")}。` +
              `请确认数据所在表含「问题」列且非空。`
          );
        } else {
          setXlsxName(
            wb.SheetNames.length > 1
              ? `${file.name}（工作表：${best.name}）`
              : file.name
          );
          setXlsxResult(best.result);
        }
      } catch (err) {
        setXlsxResult(null);
        setXlsxName(null);
        setFileError(
          "Excel 解析失败：" + (err instanceof Error ? err.message : String(err))
        );
      }
    } else {
      // 文本类文件走文本框（可继续编辑）
      const content = await file.text();
      setXlsxResult(null);
      setXlsxName(null);
      setText(content);
    }
  }

  function confirmImport() {
    if (!result || result.rows.length === 0) return;
    const items: EvaluationItem[] = result.rows.map((r, i) => ({
      id: `eval-import-${Date.now()}-${i}-${Math.random()
        .toString(36)
        .slice(2, 6)}`,
      seq: r.seq,
      question: r.question,
      standardAnswer: r.standardAnswer,
      correctFile: r.correctFile,
      correctArticle: "",
      correctPage: "",
      shouldRefuse,
    }));
    onImport(items);
    reset();
    onClose();
  }

  const FIELD_LABEL: Record<string, string> = {
    seq: "序号",
    question: "问题",
    standardAnswer: "标准答案",
    correctFile: "答案来源",
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          reset();
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>导入题库</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            支持上传 Excel(XLSX/XLS) / CSV / TSV / TXT / Markdown 表格，或直接粘贴。系统自动识别
            <b>序号、问题、标准答案、答案来源</b> 列（无表头时按此顺序）。
          </p>
          <div className="flex items-center gap-2">
            <Input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,.csv,.tsv,.txt,.md,.markdown"
              onChange={handleFile}
              className="max-w-xs"
            />
            <span className="text-xs text-muted-foreground">或在下方粘贴</span>
          </div>
          {xlsxName && (
            <p className="text-xs text-emerald-600">
              已读取 Excel 文件：{xlsxName}
            </p>
          )}
          {fileError && <p className="text-xs text-destructive">{fileError}</p>}
          <Textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              // 切换到文本输入时，放弃已加载的 Excel 结果
              if (xlsxResult) {
                setXlsxResult(null);
                setXlsxName(null);
              }
            }}
            rows={6}
            placeholder={
              xlsxName
                ? "（已从 Excel 读取，见下方预览；在此输入将改用文本内容）"
                : "序号,问题,标准答案,答案来源\n1,二类居住用地是什么？,以多中高层住宅为主的用地,用地分类标准.pdf"
            }
            className="font-mono text-xs"
          />

          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              className="h-4 w-4 accent-primary"
              checked={shouldRefuse}
              onChange={(e) => setShouldRefuse(e.target.checked)}
            />
            导入的题目标记为「应拒答」
          </label>

          {result && (
            <div className="rounded-md border bg-muted/30 p-3 text-xs">
              <div className="mb-2 flex flex-wrap items-center gap-2 text-muted-foreground">
                <Badge variant={result.headerDetected ? "success" : "secondary"}>
                  {result.headerDetected ? "已识别表头" : "无表头·按列序"}
                </Badge>
                <span>
                  列映射：
                  {result.columnMap
                    .map((f) => (f ? FIELD_LABEL[f] : "（忽略）"))
                    .join(" | ")}
                </span>
                <span>共 {result.rows.length} 题</span>
              </div>
              {result.warnings.map((w, i) => (
                <p key={i} className="text-amber-600">
                  · {w}
                </p>
              ))}
              {result.rows.length > 0 && (
                <div className="mt-2 max-h-48 overflow-auto rounded border bg-card">
                  <table className="w-full text-left">
                    <thead className="sticky top-0 bg-muted/60">
                      <tr>
                        <th className="px-2 py-1">序号</th>
                        <th className="px-2 py-1">问题</th>
                        <th className="px-2 py-1">标准答案</th>
                        <th className="px-2 py-1">答案来源</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.rows.slice(0, 50).map((r, i) => (
                        <tr key={i} className="border-t">
                          <td className="px-2 py-1 text-muted-foreground">
                            {r.seq || i + 1}
                          </td>
                          <td className="px-2 py-1">{r.question}</td>
                          <td className="px-2 py-1 text-muted-foreground">
                            {r.standardAnswer || "—"}
                          </td>
                          <td className="px-2 py-1 text-muted-foreground">
                            {r.correctFile || "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {result.rows.length > 50 && (
                    <p className="px-2 py-1 text-muted-foreground">
                      仅预览前 50 题，导入将包含全部 {result.rows.length} 题。
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              reset();
              onClose();
            }}
          >
            取消
          </Button>
          <Button
            onClick={confirmImport}
            disabled={!result || result.rows.length === 0}
          >
            导入 {result?.rows.length ? `${result.rows.length} 题` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function TriBadge({ value }: { value?: boolean }) {
  if (value === undefined)
    return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <Badge variant={value ? "success" : "destructive"}>{value ? "是" : "否"}</Badge>
  );
}

const triToStr = (v?: boolean) => (v === undefined ? "" : v ? "true" : "false");
const strToTri = (s: string): boolean | undefined =>
  s === "" ? undefined : s === "true";

function formatDuration(ms?: number): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTokens(n?: number): string {
  if (n == null) return "—";
  return n.toLocaleString("zh-CN");
}

function formatEvaluationUser(userId: string): string {
  const user = KNOWLEDGE_USERS.find((u) => u.id === userId);
  return user ? userLabel(user) : userId;
}
