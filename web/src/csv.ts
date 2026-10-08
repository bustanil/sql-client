export async function saveCSV(filename: string, contents: string) {
  if (window.sqlc?.saveFile) {
    await window.sqlc.saveFile(filename, contents);
    return;
  }
  const blob = new Blob([contents], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function rowsToCSV(columns: string[], rows: Array<Array<string | number | boolean | null>>) {
  const lines = [columns.map(csvCell).join(",")];
  for (const row of rows) lines.push(row.map((cell) => csvCell(cell === null || cell === undefined ? "" : String(cell))).join(","));
  return lines.join("\n") + "\n";
}

function csvCell(value: string) {
  if (/[",\n]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}
