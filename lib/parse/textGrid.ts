import type { RawTableCell, RawTableV2 } from "./tableStructure.ts";

/**
 * `horizontal_strategy: text` creates cell boxes around glyph runs. Their
 * transient left/right edges are not logical columns. Keep only vertical
 * boundaries repeated across most physical rows, then rebuild one cell per
 * logical row/column slot.
 */
export function normalizeTextGrid(raw: RawTableV2): RawTableV2 {

  const horizontal = raw.gridEvidence.horizontalBoundaries;
  const vertical = raw.gridEvidence.verticalBoundaries;
  const rowCount = horizontal.length - 1;
  if (rowCount < 2 || vertical.length <= 3) return raw;

  const boundaryRows = vertical.map(() => new Set<number>());
  for (const cell of raw.cells) {
    const left = nearestBoundary(vertical, cell.bbox[0]);
    const right = nearestBoundary(vertical, cell.bbox[2]);
    for (let row = cell.rowStart; row < cell.rowEnd; row++) {
      boundaryRows[left].add(row);
      boundaryRows[right].add(row);
    }
  }

  const minimumRows = Math.ceil(rowCount * 0.6);
  const logical = vertical.filter(
    (_, index) =>
      index === 0 ||
      index === vertical.length - 1 ||
      boundaryRows[index].size >= minimumRows
  );
  const isFragmentedGrid =
    logical.length >= 3 &&
    logical.length < vertical.length &&
    logical.length <= Math.ceil(vertical.length / 2);
  if (!isFragmentedGrid) return raw;

  const cells: RawTableCell[] = [];
  for (let row = 0; row < rowCount; row++) {
    for (let col = 0; col < logical.length - 1; col++) {
      const left = logical[col];
      const right = logical[col + 1];
      const fragments = raw.cells
        .filter((cell) => {
          if (!(cell.rowStart <= row && row < cell.rowEnd)) return false;
          const center = (cell.bbox[0] + cell.bbox[2]) / 2;
          return left <= center && (center < right || col === logical.length - 2);
        })
        .sort((a, b) => a.bbox[0] - b.bbox[0]);
      cells.push({
        text: fragments
          .map((cell) => cell.text.trim())
          .filter(Boolean)
          .join(""),
        bbox: [
          left,
          horizontal[row],
          right,
          horizontal[row + 1],
        ],
        rowStart: row,
        rowEnd: row + 1,
        colStart: col,
        colEnd: col + 1,
        sourceOrder: [
          ...new Set(fragments.flatMap((cell) => cell.sourceOrder)),
        ].sort((a, b) => a - b),
      });
    }
  }

  return {
    ...raw,
    cells,
    gridEvidence: {
      ...raw.gridEvidence,
      verticalBoundaries: logical,
    },
    warnings: [...raw.warnings, "collapsed_text_grid_columns"],
  };
}

function nearestBoundary(boundaries: number[], value: number): number {
  let best = 0;
  for (let index = 1; index < boundaries.length; index++) {
    if (
      Math.abs(boundaries[index] - value) <
      Math.abs(boundaries[best] - value)
    ) {
      best = index;
    }
  }
  return best;
}
