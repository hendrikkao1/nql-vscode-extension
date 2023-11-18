export const TokenTypes = [
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

export const TokenModifiers = ["declaration", "readonly"] as const;

export const NQLTokenTypeToTokenTypeMap: Record<string, (typeof TokenTypes)[number]> = {
  aggregate_field: "property",
  aggregate_function: "function",
  boolean: "boolean",
  byte: "number",
  date_time: "number",
  date: "number",
  duration: "number",
  enum: "strong",
  field_name: "variable",
  field_property: "property",
  float: "number",
  int: "number",
  string: "string",
  table: "type",
};

export interface INQLToken {
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
