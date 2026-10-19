export type Cell = string | number | boolean | null;

export type EditDraft = { text: string; isNull: boolean };

export type FieldKind = "text" | "number" | "boolean" | "date" | "time" | "timestamp";

// Classify a column type from PostgreSQL format_type or MySQL column_type.
// The picker and the dirty check only need the broad family, not the exact
// modifier or width.
export function columnKind(type: string): FieldKind {
  const base = type
    .toLowerCase()
    .trim()
    .split("(")[0]
    .trim()
    .replace(/ (unsigned|zerofill)\b/g, "");
  if (base.startsWith("timestamp") || base === "datetime" || base === "timestamptz") return "timestamp";
  if (base === "date") return "date";
  if (base.startsWith("time") || base === "timetz") return "time";
  if (base === "boolean" || base === "bool") return "boolean";
  if (
    [
      "smallint",
      "integer",
      "bigint",
      "int",
      "int2",
      "int4",
      "int8",
      "tinyint",
      "mediumint",
      "year",
      "serial",
      "smallserial",
      "bigserial",
      "numeric",
      "decimal",
      "real",
      "double",
      "double precision",
      "float",
      "float4",
      "float8",
      "money",
    ].includes(base)
  ) {
    return "number";
  }
  return "text";
}

export function columnHasZone(type: string): boolean {
  return /with time zone|timestamptz/i.test(type);
}

function firstDate(text: string): string {
  return /^(\d{4}-\d{2}-\d{2})/.exec(text.trim())?.[1] || "";
}

function clock(text: string): string {
  const match = /(?:^|[T ])(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(text.trim());
  if (!match) return "";
  return `${match[1].padStart(2, "0")}:${match[2]}:${match[3] || "00"}`;
}

function timestampParts(text: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(text.trim());
  if (!match) return "";
  return `${match[1]}T${match[2]}:${match[3]}${match[4] ? `:${match[4]}` : ""}`;
}

function zoneSuffix(text: string): string {
  return /(Z|[+-]\d{2}:?\d{2})$/.exec(text.trim())?.[1] || "";
}

// What the grid shows when the cell is not being edited. Driver timestamps
// often carry a date for a time-only column and a midnight time for a date
// column, so trim those to the useful part.
export function displayValue(kind: FieldKind, text: string): string {
  if (kind === "date") return firstDate(text) || text;
  if (kind === "time") return clock(text) || text;
  return text;
}

// Comparison form for dirty detection. It keeps a value the user did not
// really change from being treated as dirty just because the driver spelled
// the timestamp differently.
export function normalizeValue(kind: FieldKind, text: string, hasZone: boolean): string {
  if (kind === "date") return firstDate(text) || text.trim();
  if (kind === "time") return clock(text) || text.trim();
  if (kind === "timestamp") {
    let value = text.trim().replace(" ", "T");
    if (!hasZone) value = value.replace(/(Z|[+-]\d{2}:?\d{2})$/, "");
    return value;
  }
  return text;
}

export function draftDiffers(value: Cell, draft: EditDraft, kind: FieldKind, hasZone: boolean): boolean {
  if (draft.isNull) return value !== null;
  if (value === null) return true;
  return normalizeValue(kind, draft.text, hasZone) !== normalizeValue(kind, String(value), hasZone);
}

export type PickerSpec = { type: "date" | "time" | "datetime-local"; value: string };

export function pickerSpec(kind: FieldKind, text: string): PickerSpec | null {
  if (kind === "date") return { type: "date", value: firstDate(text) };
  if (kind === "time") return { type: "time", value: clock(text) };
  if (kind === "timestamp") return { type: "datetime-local", value: timestampParts(text) };
  return null;
}

// Build the text stored in the cell from what the native picker returned.
// A timezone-aware original keeps its zone suffix, so editing the wall time
// does not silently change the stored offset.
export function valueFromPicker(kind: FieldKind, picked: string, original: string, hasZone: boolean): string {
  if (!picked) return "";
  if (kind === "timestamp") {
    let value = picked;
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) value += ":00";
    const zone = zoneSuffix(original);
    if (hasZone && zone) value += zone;
    return value;
  }
  return picked;
}
