"use client";

import type { ReactNode } from "react";

/**
 * Deterministic data-table renderer for stems, problems, and quiz questions.
 *
 * Renders a GitHub-style markdown pipe table (parsed in parseVizSegments) as a
 * clean HTML table. Each cell's text is rendered through the shared content
 * renderer (passed in as `renderCell`) so cells can themselves contain inline
 * math / chemistry ($...$, \ce{...}). Used via MathText, so tables render wherever
 * content renders — problems AND quiz questions — with no per-page wiring.
 */
export function DataTable({
  rows,
  hasHeader,
  renderCell,
}: {
  rows: string[][];
  hasHeader: boolean;
  renderCell: (text: string) => ReactNode;
}) {
  if (!rows.length) return null;
  const headerRow = hasHeader ? rows[0] : null;
  const bodyRows = hasHeader ? rows.slice(1) : rows;

  return (
    <div className="my-3 block overflow-x-auto">
      <table className="w-auto border-collapse text-sm">
        {headerRow ? (
          <thead>
            <tr>
              {headerRow.map((cell, i) => (
                <th
                  key={i}
                  className="border border-neutral-300 bg-neutral-50 px-3 py-1.5 text-left font-semibold text-neutral-700"
                >
                  {renderCell(cell)}
                </th>
              ))}
            </tr>
          </thead>
        ) : null}
        <tbody>
          {bodyRows.map((row, r) => (
            <tr key={r}>
              {row.map((cell, c) => (
                <td key={c} className="border border-neutral-300 px-3 py-1.5 align-top text-neutral-800">
                  {renderCell(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default DataTable;
