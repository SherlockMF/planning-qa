"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { EvaluationItem, EvaluationStats } from "@/lib/types";
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

  const stats = useMemo(() => computeStatsLocal(items), [items]);

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

  async function run() {
    setRunning(true);
    try {
      // 把当前（含新增/编辑）的题库一并提交并逐题运行
      const res = await fetch("/api/evaluation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "run", items }),
      });
      const data = await res.json();
      setItems(data.items ?? []);
      setDirty(false);
    } finally {
      setRunning(false);
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
        <Button variant="outline" onClick={persist} disabled={saving || !dirty}>
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          保存{dirty ? "（有改动）" : ""}
        </Button>
        <Button onClick={run} disabled={running}>
          {running ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Play className="h-4 w-4" />
          )}
          运行评测（自动判分）
        </Button>
        <Button variant="ghost" onClick={reset} disabled={saving || running}>
          <RotateCcw className="h-4 w-4" />
          重置示例题库
        </Button>
        <span className="text-xs text-muted-foreground">
          运行后会自动回填系统回答与建议分数；可在表格中手动调整得分/判定后再「保存」。
        </span>
      </div>

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[220px]">问题 / 标准答案</TableHead>
              <TableHead className="min-w-[150px]">正确文件 / 条款 / 页码</TableHead>
              <TableHead>应拒答</TableHead>
              <TableHead>进Top5</TableHead>
              <TableHead>引用正确</TableHead>
              <TableHead>正确拒答</TableHead>
              <TableHead>答案得分</TableHead>
              <TableHead className="min-w-[130px]">错误原因</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((it) => (
              <TableRow key={it.id}>
                <TableCell className="align-top text-sm text-slate-800">
                  {it.question || <span className="text-muted-foreground">（空）</span>}
                  <p className="mt-1 text-xs text-muted-foreground">
                    标准：{it.standardAnswer || "—"}
                  </p>
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
                <TableCell colSpan={9} className="py-8 text-center text-sm text-muted-foreground">
                  暂无题目，点击「新增题目」录入。
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
