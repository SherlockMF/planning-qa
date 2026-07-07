import test from "node:test";
import assert from "node:assert/strict";

import {
  clusterColumnStarts,
  normalizePdfTextItem,
  type PdfTextItem,
} from "../lib/parse/pdfItems.ts";
import { detectTableRegions } from "../lib/parse/tableRegionDetector.ts";
import { buildTableGrid } from "../lib/parse/tableGridBuilder.ts";
import {
  extractTableGridsFromPageItems,
  extractTablesFromPageItems,
} from "../lib/parse/coordTables.ts";
import { summarizeTableComparison } from "../lib/debug/coordTableCompare.ts";
import {
  buildGridBoundariesFromLines,
  detectLineTableRegions,
  normalizePathLine,
  type PdfPathLine,
} from "../lib/parse/pdfLines.ts";

function item(
  text: string,
  x: number,
  y: number,
  pageNumber = 1,
  width = text.length * 5
): PdfTextItem {
  return { text, x, y, width, height: 10, pageNumber };
}

test("clusters stable column starts with small coordinate jitter", () => {
  const starts = clusterColumnStarts([
    item("h1", 10, 10),
    item("h2", 101, 10),
    item("h3", 202, 10),
    item("a", 12, 30),
    item("b", 99, 30),
    item("c", 201, 30),
    item("d", 11, 50),
    item("e", 103, 50),
    item("f", 198, 50),
  ]);

  assert.equal(starts.length, 3);
  assert.ok(Math.abs(starts[0] - 11) <= 2);
  assert.ok(Math.abs(starts[1] - 101) <= 2);
  assert.ok(Math.abs(starts[2] - 200) <= 3);
});

test("normalizes rotated pdfjs items into the page main coordinate system", () => {
  const normalized = normalizePdfTextItem(
    {
      str: "A",
      transform: [0, 10, -10, 0, 300, 120],
      width: 20,
      height: 10,
    },
    1,
    { dominantB: 10, dominantC: -10, avgH: 10 }
  );

  assert.equal(normalized?.text, "A");
  assert.equal(normalized?.x, 120);
  assert.equal(normalized?.y, 300);
});

test("detects one table region while ignoring prose and page fragments", () => {
  const items = [
    item("Table 1 indicator table", 10, 10),
    item("Name", 10, 30),
    item("Area", 100, 30),
    item("Scale", 200, 30),
    item("Property room", 10, 50),
    item("150", 100, 50),
    item("one per project", 200, 50),
    item("Clinic", 10, 70),
    item("1700", 100, 70),
    item("one per community", 200, 70),
    item("This is a normal paragraph, not a table.", 10, 120),
    item("- 12 -", 260, 760),
  ];

  const regions = detectTableRegions(items, 1);

  assert.equal(regions.length, 1);
  assert.equal(regions[0].tableTitle, "Table 1 indicator table");
  assert.ok(regions[0].confidence >= 0.5);
});

test("detects Chinese table titles as region anchors", () => {
  const items = [
    item("\u8868\uff1a\u91cd\u70b9\u5730\u533a\u7ba1\u63a7\u5185\u5bb9\u4e00\u89c8\u8868", 10, 10, 1, 120),
    item("\u533a\u57df", 10, 30),
    item("\u8981\u6c42", 100, 30),
    item("\u4ee3\u7801", 200, 30),
    item("A", 10, 50),
    item("\u63a7\u5236", 100, 50),
    item("01", 200, 50),
    item("B", 10, 70),
    item("\u4f18\u5316", 100, 70),
    item("02", 200, 70),
  ];

  const regions = detectTableRegions(items, 1);

  assert.equal(regions.length, 1);
  assert.equal(
    regions[0].tableTitle,
    "\u8868\uff1a\u91cd\u70b9\u5730\u533a\u7ba1\u63a7\u5185\u5bb9\u4e00\u89c8\u8868"
  );
});

test("detects tables whose caption appears below the grid", () => {
  const items = [
    item("Railway station", 10, 30, 1, 60),
    item("FAR", 100, 30, 1, 20),
    item("Scale", 170, 30, 1, 30),
    item("National hub", 10, 50, 1, 60),
    item("0.2", 100, 50, 1, 20),
    item("1000m", 170, 50, 1, 30),
    item("Regional hub", 10, 70, 1, 60),
    item("0.1", 100, 70, 1, 20),
    item("500m", 170, 70, 1, 30),
    item("\u8868\uff1a\u94c1\u8def\u5ba2\u7ad9\u5468\u8fb9\u4e00\u4f53\u5316\u8303\u56f4\u4e00\u89c8\u8868", 10, 95, 1, 150),
  ];

  const regions = detectTableRegions(items, 1);

  assert.equal(regions.length, 1);
  assert.equal(
    regions[0].tableTitle,
    "\u8868\uff1a\u94c1\u8def\u5ba2\u7ad9\u5468\u8fb9\u4e00\u4f53\u5316\u8303\u56f4\u4e00\u89c8\u8868"
  );
});

test("keeps wrapped long-text continuation rows inside untitled tables", () => {
  const items = [
    item("1", 10, 30),
    item("Residential", 60, 30, 1, 50),
    item("0701 housing land controls at least half of construction land", 160, 30, 1, 220),
    item("including compatible community service facilities and local road access", 160, 48, 1, 240),
    item("with detailed implementation requirements determined by the district", 160, 66, 1, 240),
    item("2", 10, 90),
    item("Commercial", 60, 90, 1, 50),
    item("0902 business land controls at least half of construction land", 160, 90, 1, 220),
    item("3", 10, 115),
    item("Industrial", 60, 115, 1, 50),
    item("1001 industrial land controls at least half of construction land", 160, 115, 1, 220),
  ];

  const regions = detectTableRegions(items, 1);

  assert.equal(regions.length, 1);
  assert.equal(regions[0].tableTitle, undefined);
});

test("builds a matrix, merges multiline cells, and keeps merged cells as null", () => {
  const items = [
    item("Name", 10, 30),
    item("Requirement", 100, 30),
    item("Code", 220, 30),
    item("Property room", 10, 50),
    item("near main entrance", 100, 50),
    item("R1", 220, 50),
    item("and accessible", 100, 62),
    item("- 13 -", 220, 62),
    item("shared-service room", 100, 80),
    item("R2", 220, 80),
  ];
  const [region] = detectTableRegions(items, 1);

  const grid = buildTableGrid(region, items);

  assert.deepEqual(grid.matrix, [
    ["Name", "Requirement", "Code"],
    ["Property room", "near main entrance and accessible", "R1"],
    [null, "shared-service room", "R2"],
  ]);
  assert.ok(grid.warnings.includes("rowspan_filled"));
  assert.ok(grid.warnings.includes("page_footer_removed"));
});

test("orders same-cell text fragments by visual row then x coordinate", () => {
  const items = [
    item("Name", 10, 30),
    item("Value", 100, 30),
    item("托幼", 10, 50),
    item("人6", 130, 50, 1, 15),
    item("0万.", 100, 50, 1, 20),
    item("9", 122, 50, 1, 8),
    item("以下", 130, 66, 1, 20),
    item("岁", 100, 66, 1, 10),
    item("6", 112, 66, 1, 8),
  ];
  const region = {
    regionId: "p1-order",
    pageNumber: 1,
    bbox: [5, 25, 180, 85] as [number, number, number, number],
    confidence: 0.9,
    reasons: ["test"],
  };

  const grid = buildTableGrid(region, items);

  assert.deepEqual(grid.matrix, [
    ["Name", "Value"],
    ["托幼", "0.96万人 6岁以下"],
  ]);
});

test("merges sparse continuation rows into empty cells on the previous row", () => {
  const items = [
    item("No", 10, 30),
    item("Type", 60, 30),
    item("Requirement", 150, 30),
    item("1", 10, 50),
    item("Residential", 60, 50),
    item("0701 housing land", 150, 62),
    item("controls at least half", 150, 74),
    item("2", 10, 95),
    item("Commercial", 60, 95),
    item("0902 business land", 150, 95),
  ];
  const [region] = detectTableRegions(items, 1);

  const grid = buildTableGrid(region, items);

  assert.deepEqual(grid.matrix, [
    ["No", "Type", "Requirement"],
    ["1", "Residential", "0701 housing land controls at least half"],
    ["2", "Commercial", "0902 business land"],
  ]);
});

test("bridges page items into RawTable-shaped coordinate tables", () => {
  const tables = extractTablesFromPageItems([
    [
      item("Table 2 code table", 10, 10),
      item("Code", 10, 30),
      item("Name", 100, 30),
      item("A21", 10, 50),
      item("Library", 100, 50),
      item("A22", 10, 70),
      item("Culture center", 100, 70),
    ],
  ]);

  assert.equal(tables.length, 1);
  assert.equal(tables[0].page, 1);
  assert.equal(tables[0].title, "Table 2 code table");
  assert.deepEqual(tables[0].rows, [
    ["Code", "Name"],
    ["A21", "Library"],
    ["A22", "Culture center"],
  ]);
});

test("keeps coord grid metadata for debug and overlay consumers", () => {
  const grids = extractTableGridsFromPageItems([
    [
      item("Table 3 requirements", 10, 10),
      item("Name", 10, 30),
      item("Requirement", 100, 30),
      item("Room", 10, 50),
      item("Near entrance", 100, 50),
      item("Hall", 10, 70),
      item("Shared access", 100, 70),
    ],
  ]);

  assert.equal(grids.length, 1);
  assert.equal(grids[0].rawTable.page, 1);
  assert.equal(grids[0].rawTable.title, "Table 3 requirements");
  assert.ok(grids[0].cellBBoxes?.[0]?.[0]);
  assert.equal(grids[0].warnings.length, 0);
});

test("summarizes coord-vs-python table quality metrics", () => {
  const summary = summarizeTableComparison(
    [{ page: 1, bbox: null, title: null, rows: [["A", "B"], ["1", ""]] }],
    [{ page: 1, bbox: null, title: null, rows: [["A", "B"], ["1", "2"]] }]
  );

  assert.equal(summary.coord.tableCount, 1);
  assert.equal(summary.python.tableCount, 1);
  assert.equal(summary.coord.totalRows, 2);
  assert.equal(summary.coord.maxEffectiveColumns, 2);
  assert.equal(summary.coord.emptyCellRate, 0.25);
  assert.equal(summary.deltas.tableCount, 0);
});

test("builds grid boundaries from vector table lines", () => {
  const lines: PdfPathLine[] = [
    { x0: 10, y0: 10, x1: 110, y1: 10, orientation: "h", pageNumber: 1 },
    { x0: 10, y0: 40, x1: 110, y1: 40, orientation: "h", pageNumber: 1 },
    { x0: 10, y0: 70, x1: 110, y1: 70, orientation: "h", pageNumber: 1 },
    { x0: 10, y0: 10, x1: 10, y1: 70, orientation: "v", pageNumber: 1 },
    { x0: 60, y0: 10, x1: 60, y1: 70, orientation: "v", pageNumber: 1 },
    { x0: 110, y0: 10, x1: 110, y1: 70, orientation: "v", pageNumber: 1 },
  ];

  const boundaries = buildGridBoundariesFromLines(lines, [8, 8, 112, 72]);

  assert.deepEqual(boundaries?.x, [10, 60, 110]);
  assert.deepEqual(boundaries?.y, [10, 40, 70]);
});

test("splits marker sequences across line-grid columns", () => {
  const region = {
    regionId: "p1-line",
    pageNumber: 1,
    bbox: [10, 10, 210, 70] as [number, number, number, number],
    confidence: 0.9,
    reasons: ["line_grid"],
  };
  const lines: PdfPathLine[] = [
    { x0: 10, y0: 10, x1: 210, y1: 10, orientation: "h", pageNumber: 1 },
    { x0: 10, y0: 40, x1: 210, y1: 40, orientation: "h", pageNumber: 1 },
    { x0: 10, y0: 70, x1: 210, y1: 70, orientation: "h", pageNumber: 1 },
    { x0: 10, y0: 10, x1: 10, y1: 70, orientation: "v", pageNumber: 1 },
    { x0: 60, y0: 10, x1: 60, y1: 70, orientation: "v", pageNumber: 1 },
    { x0: 110, y0: 10, x1: 110, y1: 70, orientation: "v", pageNumber: 1 },
    { x0: 160, y0: 10, x1: 160, y1: 70, orientation: "v", pageNumber: 1 },
    { x0: 210, y0: 10, x1: 210, y1: 70, orientation: "v", pageNumber: 1 },
  ];
  const grid = buildTableGrid(
    region,
    [
      item("Name", 15, 20, 1, 30),
      item("\u25cf \u25cb \u25cf", 65, 20, 1, 130),
      item("Road", 15, 50, 1, 30),
      item("\u25cb \u25cf \u25cb", 65, 50, 1, 130),
    ],
    lines
  );

  assert.deepEqual(grid.matrix, [
    ["Name", "\u25cf", "\u25cb", "\u25cf"],
    ["Road", "\u25cb", "\u25cf", "\u25cb"],
  ]);
});

test("drops sparse interior ghost columns from line grids", () => {
  const region = {
    regionId: "p1-line",
    pageNumber: 1,
    bbox: [10, 10, 260, 100] as [number, number, number, number],
    confidence: 0.9,
    reasons: ["line_grid"],
  };
  const lines: PdfPathLine[] = [
    { x0: 10, y0: 10, x1: 260, y1: 10, orientation: "h", pageNumber: 1 },
    { x0: 10, y0: 40, x1: 260, y1: 40, orientation: "h", pageNumber: 1 },
    { x0: 10, y0: 70, x1: 260, y1: 70, orientation: "h", pageNumber: 1 },
    { x0: 10, y0: 100, x1: 260, y1: 100, orientation: "h", pageNumber: 1 },
    { x0: 10, y0: 10, x1: 10, y1: 100, orientation: "v", pageNumber: 1 },
    { x0: 80, y0: 10, x1: 80, y1: 100, orientation: "v", pageNumber: 1 },
    { x0: 140, y0: 10, x1: 140, y1: 100, orientation: "v", pageNumber: 1 },
    { x0: 200, y0: 10, x1: 200, y1: 100, orientation: "v", pageNumber: 1 },
    { x0: 260, y0: 10, x1: 260, y1: 100, orientation: "v", pageNumber: 1 },
  ];
  const grid = buildTableGrid(
    region,
    [
      item("Name", 15, 20, 1, 30),
      item("Value", 85, 20, 1, 30),
      item("ghost", 145, 20, 1, 30),
      item("Note", 205, 20, 1, 30),
      item("A", 15, 50, 1, 30),
      item("1", 85, 50, 1, 30),
      item("ok", 205, 50, 1, 30),
      item("B", 15, 80, 1, 30),
      item("2", 85, 80, 1, 30),
      item("ok", 205, 80, 1, 30),
    ],
    lines
  );

  assert.deepEqual(grid.matrix, [
    ["Name", "Value", "Note"],
    ["A", "1", "ok"],
    ["B", "2", "ok"],
  ]);
});

test("detects separate vector-line table regions on one page", () => {
  const lines: PdfPathLine[] = [
    { x0: 10, y0: 10, x1: 110, y1: 10, orientation: "h", pageNumber: 1 },
    { x0: 10, y0: 40, x1: 110, y1: 40, orientation: "h", pageNumber: 1 },
    { x0: 10, y0: 70, x1: 110, y1: 70, orientation: "h", pageNumber: 1 },
    { x0: 10, y0: 10, x1: 10, y1: 70, orientation: "v", pageNumber: 1 },
    { x0: 60, y0: 10, x1: 60, y1: 70, orientation: "v", pageNumber: 1 },
    { x0: 110, y0: 10, x1: 110, y1: 70, orientation: "v", pageNumber: 1 },
    { x0: 210, y0: 10, x1: 310, y1: 10, orientation: "h", pageNumber: 1 },
    { x0: 210, y0: 40, x1: 310, y1: 40, orientation: "h", pageNumber: 1 },
    { x0: 210, y0: 70, x1: 310, y1: 70, orientation: "h", pageNumber: 1 },
    { x0: 210, y0: 10, x1: 210, y1: 70, orientation: "v", pageNumber: 1 },
    { x0: 260, y0: 10, x1: 260, y1: 70, orientation: "v", pageNumber: 1 },
    { x0: 310, y0: 10, x1: 310, y1: 70, orientation: "v", pageNumber: 1 },
  ];

  const regions = detectLineTableRegions(lines, 1);

  assert.equal(regions.length, 2);
  assert.deepEqual(regions.map((region) => region.bbox), [
    [10, 10, 110, 70],
    [210, 10, 310, 70],
  ]);
});

test("detects two-row vector-line continuation tables", () => {
  const lines: PdfPathLine[] = [
    { x0: 10, y0: 10, x1: 110, y1: 40, orientation: "h", pageNumber: 1 },
    { x0: 10, y0: 40, x1: 110, y1: 70, orientation: "h", pageNumber: 1 },
    { x0: 10, y0: 10, x1: 10, y1: 70, orientation: "v", pageNumber: 1 },
    { x0: 60, y0: 10, x1: 60, y1: 70, orientation: "v", pageNumber: 1 },
    { x0: 110, y0: 10, x1: 110, y1: 70, orientation: "v", pageNumber: 1 },
  ];

  const regions = detectLineTableRegions(lines, 1);

  assert.equal(regions.length, 1);
  assert.deepEqual(regions[0].bbox, [10, 10, 110, 70]);
});

test("normalizes quarter-rotated vector lines into text coordinates", () => {
  const line = normalizePathLine(
    { x0: 303, y0: 0, x1: 303, y1: 633, pageNumber: 1 },
    90,
    105
  );

  assert.deepEqual(line, {
    x0: 105,
    y0: 303,
    x1: 738,
    y1: 303,
    orientation: "h",
    pageNumber: 1,
  });
});
