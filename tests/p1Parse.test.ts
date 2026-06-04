// P1 解析增强 golden tests：页码残片清理 / code 行判定 / 续表表头指纹。
import test from "node:test";
import assert from "node:assert/strict";
import { isPageFragment, rowHasCode } from "../lib/rag/ragTable.ts";
import { headerFingerprint, fingerprintSimilar } from "../lib/parse/headerFingerprint.ts";

test("页码残片识别：破折号包裹的页码 → true；真实数值/区间 → false", () => {
  assert.equal(isPageFragment("— 15 —"), true);
  assert.equal(isPageFragment("—5 1—"), true);
  assert.equal(isPageFragment("- 23 -"), true);
  // 真实值不应被误删
  assert.equal(isPageFragment("150"), false);
  assert.equal(isPageFragment("40-50"), false); // 区间值，破折号在中间
  assert.equal(isPageFragment("1.0"), false);
  assert.equal(isPageFragment("物业服务用房"), false);
  assert.equal(isPageFragment(""), false);
});

test("code 行判定：code 字段 / rowKey / 单元格任一含代码 → true", () => {
  assert.equal(rowHasCode("A21", "图书展览用地"), true);
  assert.equal(rowHasCode(undefined, "A21 图书展览用地"), true);
  assert.equal(rowHasCode(undefined, "080301 图书与展览用地"), true);
  // 代码落在单元格（类别代码列）里：rowKey 是名称，但 cells 含 A21 → 仍是代码行
  assert.equal(rowHasCode(undefined, "图书展览用地", ["A21", "图书展览用地", "..."]), true);
  // 续写行：无 code、rowKey 与 cells 都是纯说明文字
  assert.equal(rowHasCode(undefined, "公共图书馆、博物馆等设施用地", ["综合医院、专科医院等设施用地"]), false);
  assert.equal(rowHasCode(undefined, ""), false);
  assert.equal(rowHasCode("", "纯文字说明", []), false);
});

test("表头指纹：归一化去单位/标点后比较", () => {
  const a = headerFingerprint(["类别代码", "类别名称", "内容"]);
  const b = headerFingerprint(["类别代码", "类别名称", "内容"]);
  assert.equal(a, b);
  // 去单位括号后相同
  const c = headerFingerprint(["建筑面积(平方米)", "用地面积(平方米)"]);
  const d = headerFingerprint(["建筑面积", "用地面积"]);
  assert.equal(c, d);
});

test("续表指纹相似：同表头 → 续表；不同表头 → 不合并", () => {
  const prev = headerFingerprint(["类别代码", "类别名称", "内容"]);
  const contSame = headerFingerprint(["类别代码", "类别名称", "内容"]);
  const contNoise = headerFingerprint(["类别代码", "类别名称", "内容", "备注"]); // 4/4 交 3 → 0.75
  const other = headerFingerprint(["设施名称", "建筑面积", "服务规模"]);
  assert.equal(fingerprintSimilar(prev, contSame), true);
  assert.equal(fingerprintSimilar(prev, contNoise), true); // Jaccard 0.75 ≥ 0.6
  assert.equal(fingerprintSimilar(prev, other), false);
  assert.equal(fingerprintSimilar(prev, ""), false);
});
