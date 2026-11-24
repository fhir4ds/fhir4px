/**
 * Reading typed values out of engine result cells. Population SQL returns
 * one row per patient with one cell per requested column; a boolean may
 * arrive as a JS boolean or as 0/1 and "true"/"false" depending on how the
 * engine serialized the column, so membership checks go through here.
 */

/** Value of a boolean column in a result row: true, false, or null when the
 * column is absent or the cell is not a recognizable boolean. */
export function boolAt(row: unknown[], columns: string[], name: string): boolean | null {
  const index = columns.indexOf(name);
  if (index < 0) return null;
  const value = row[index];
  return value === true || value === 1 || value === "true"
    ? true
    : value === false || value === 0 || value === "false"
      ? false
      : null;
}
