export const tokenTypes = [
  "constant",
  "number",
  "string",
  "strong",
  "variable",
  "type",
  "other",
  "function",
  "property",
  "boolean",
  "control",
] as const;

export const tokenModifiers = ["declaration", "readonly"] as const;

export const tokenTypeMap: Record<string, (typeof tokenTypes)[number]> = {
  boolean: "boolean",
  byte: "number",
  date_time: "number",
  date: "number",
  duration: "number",
  enum: "strong",
  float: "number",
  int: "number",
  string: "string",
  table: "type",
  aggregate_function: "function",
  field_name: "variable",
  field_property: "property",
  aggregate_field: "property",
};

export interface INQLSematicToken {
  type: string;
  text: string;
  modifiers: string[];
  startPosition: {
    row: number;
    column: number;
  };
  endPosition: {
    row: number;
    column: number;
  };
}

export interface INQLParserError {
  text: string;
  startPosition: {
    row: number;
    column: number;
  };
  endPosition: {
    row: number;
    column: number;
  };
}
