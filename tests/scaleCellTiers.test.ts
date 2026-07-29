import test from "node:test";
import assert from "node:assert/strict";

import {
  expandScaleTierInRowFields,
  isGeneralScaleBuildingAreaHeader,
  parseScaleCellTiers,
} from "../lib/rag/tables/scaleCellTiers.ts";

test("parses bed/area tier pairs separated by newlines", () => {
  const parsed = parseScaleCellTiers(
    ["50-100 床", "2000-4000", "100-500 床", "4000-15000"].join("\n")
  );

  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.deepEqual(parsed.tiers, [
    { bedRangeRaw: "50-100床", buildingAreaRaw: "2000-4000" },
    { bedRangeRaw: "100-500床", buildingAreaRaw: "4000-15000" },
  ]);
});

test("parses a single bed/area pair already split onto two lines", () => {
  const parsed = parseScaleCellTiers("50-100床\n2000-4000");
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.deepEqual(parsed.tiers, [
    { bedRangeRaw: "50-100床", buildingAreaRaw: "2000-4000" },
  ]);
});

test("rejects glued bed-and-area numeric ranges", () => {
  const parsed = parseScaleCellTiers("床50-1002000-4000");

  assert.equal(parsed.ok, false);
  if (parsed.ok) return;
  assert.equal(parsed.reason, "glued_numeric_ranges");
});

test("returns unsupported for a plain single area value", () => {
  const parsed = parseScaleCellTiers("3500");

  assert.equal(parsed.ok, false);
  if (parsed.ok) return;
  assert.equal(parsed.reason, "unsupported_pattern");
});

test("recognizes per-facility building-area headers without 一般规模 prefix", () => {
  assert.equal(isGeneralScaleBuildingAreaHeader("建筑面积 (平方米/处)"), true);
  assert.equal(isGeneralScaleBuildingAreaHeader("建筑面积 (平方米)"), false);
  assert.equal(
    isGeneralScaleBuildingAreaHeader("规模性指标.一般规模.建筑面积(平方米/处)"),
    true
  );
});

test("expands multi-tier general-scale cells into paired logical rows", () => {
  const expanded = expandScaleTierInRowFields({
    设施名称: "机构养老设施",
    "规模性指标.一般规模.建筑面积(平方米/处)": [
      "50-100 床",
      "2000-4000",
      "100-500 床",
      "4000-15000",
    ].join("\n"),
    服务规模: "每个街道至少1处",
  });

  assert.equal(expanded.rows.length, 2);
  assert.equal(expanded.rows[0]["规模性指标.一般规模.分档"], "50-100床");
  assert.equal(expanded.rows[0]["规模性指标.一般规模.建筑面积(平方米/处)"], "2000-4000");
  assert.equal(expanded.rows[1]["规模性指标.一般规模.分档"], "100-500床");
  assert.equal(expanded.rows[1]["规模性指标.一般规模.建筑面积(平方米/处)"], "4000-15000");
});

test("normalizes a single-tier per-facility area cell into 分档 + clean area", () => {
  const expanded = expandScaleTierInRowFields({
    设施名称: "机构养老设施",
    "建筑面积 (平方米/处)": "50-100床\n2000-4000",
    "建筑面积 (平方米)": "300-400",
    服务规模: "每个街道至少1处",
  });

  assert.equal(expanded.rows.length, 1);
  assert.equal(expanded.rows[0]["规模性指标.一般规模.分档"], "50-100床");
  assert.equal(expanded.rows[0]["建筑面积 (平方米/处)"], "2000-4000");
  assert.equal(expanded.rows[0]["建筑面积 (平方米)"], "300-400");
  assert.deepEqual(expanded.warnings, []);
});

test("marks glued scale cells as low-fidelity instead of inventing tiers", () => {
  const expanded = expandScaleTierInRowFields({
    设施名称: "机构养老设施",
    "规模性指标.一般规模.建筑面积(平方米/处)": "床50-1002000-4000",
  });

  assert.equal(expanded.rows.length, 1);
  assert.ok(expanded.warnings.includes("scrambled_numeric_unit"));
});
