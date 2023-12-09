export const NQLTokenType = {
  aggregate_field: "aggregate_field",
  aggregate_function: "aggregate_function",
  boolean: "boolean",
  byte: "byte",
  date_time: "date_time",
  date: "date",
  duration: "duration",
  enum: "enum",
  field_name: "field_name",
  field_property: "field_property",
  float: "float",
  int: "int",
  string: "string",
  table: "table",
} as const;

export const EditorTokenType = {
  constant: "constant",
  number: "number",
  string: "string",
  strong: "strong",
  variable: "variable",
  type: "type",
  other: "other",
  function: "function",
  property: "property",
  boolean: "boolean",
  control: "control",
} as const;

export const NQLTokenTypeToEditorTokenTypeMap: Record<
  (typeof NQLTokenType)[keyof typeof NQLTokenType],
  (typeof EditorTokenType)[keyof typeof EditorTokenType]
> = {
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

export const editorTokenTypeList = Object.keys(
  EditorTokenType,
) as (keyof typeof EditorTokenType)[];

export const NQLTokenModifier = {
  defaultLibrary: "defaultLibrary",
  readonly: "readonly",
} as const;

export const EditorTokenModifier = {
  readonly: "readonly",
  defaultLibrary: "defaultLibrary",
} as const;

export const NQLTokenModifierToEditorTokenModifierMap: Record<
  (typeof NQLTokenModifier)[keyof typeof NQLTokenModifier],
  (typeof EditorTokenModifier)[keyof typeof EditorTokenModifier]
> = {
  defaultLibrary: "defaultLibrary",
  readonly: "readonly",
};

export const editorTokenModifierList = Object.keys(
  EditorTokenModifier,
) as (keyof typeof EditorTokenModifier)[];

export interface INQLToken {
  type: keyof typeof NQLTokenType;
  text: string;
  modifiers: (keyof typeof NQLTokenModifier)[];
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
