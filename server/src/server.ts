/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import {
  createConnection,
  TextDocuments,
  Diagnostic,
  DiagnosticSeverity,
  ProposedFeatures,
  InitializeParams,
  DidChangeConfigurationNotification,
  CompletionItem,
  CompletionItemKind,
  TextDocumentPositionParams,
  TextDocumentSyncKind,
  InitializeResult,
  TextEdit,
  SemanticTokensRequest,
  SemanticTokenModifiers,
  SemanticTokenTypes,
  SemanticTokensParams,
  SemanticTokensLegend,
  CancellationToken,
  SemanticTokens,
  TextDocumentIdentifier,
  uinteger,
} from "vscode-languageserver/node";

import Parser = require("web-tree-sitter");

let parser: Parser | undefined;

Parser.init()
  .then(() => {
    return Parser.Language.load(
      "/Users/hendrikkao/Projects/lsp-sample/server/out/tree-sitter-nql.wasm",
    );
  })
  .then((lang) => {
    parser = new Parser();
    parser.setLanguage(lang);
  });

import { TextDocument } from "vscode-languageserver-textdocument";

// Create a simple text document manager.
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

let hasConfigurationCapability = false;
let hasWorkspaceFolderCapability = false;
let hasDiagnosticRelatedInformationCapability = false;

// The example settings
interface ISettings {}

// The global settings, used when the `workspace/configuration` request is not supported by the client.
// Please note that this is not the case when using this server with the client provided in this example
// but could happen with other clients.
const defaultSettings: ISettings = {};

let globalSettings: ISettings = defaultSettings;

// Cache the settings of all open documents
const documentSettings: Map<string, Thenable<ISettings>> = new Map();

function getDocumentSettings(resource: string): Thenable<ISettings> {
  if (!hasConfigurationCapability) {
    return Promise.resolve(globalSettings);
  }

  let result = documentSettings.get(resource);

  if (!result) {
    result = connection.workspace.getConfiguration({
      scopeUri: resource,
      section: "NQL",
    });
    documentSettings.set(resource, result);
  }

  return result;
}

// Create a connection for the server, using Node's IPC as a transport.
// Also include all preview / proposed LSP features.
const connection = createConnection(ProposedFeatures.all);

const tokenTypes = [
  "constant",
  "number",
  "string",
  "strong",
  "variable",
  "type",
  "other",
  // Custom
  "function",
  "property",
  "boolean",
  "control",
] as const;

const tokenModifiers = ["declaration", "readonly"] as const;

const tokenTypeMap: Record<string, (typeof tokenTypes)[number]> = {
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
  // Custom
  aggregate_function: "function",
  field_name: "variable",
  field_property: "property",
  aggregate_field: "property",
};

connection.onInitialize((params: InitializeParams) => {
  const capabilities = params.capabilities;

  // Does the client support the `workspace/configuration` request?
  // If not, we fall back using global settings.
  hasConfigurationCapability = !!(
    capabilities.workspace && !!capabilities.workspace.configuration
  );
  hasWorkspaceFolderCapability = !!(
    capabilities.workspace && !!capabilities.workspace.workspaceFolders
  );
  hasDiagnosticRelatedInformationCapability = !!(
    capabilities.textDocument &&
    capabilities.textDocument.publishDiagnostics &&
    capabilities.textDocument.publishDiagnostics.relatedInformation
  );

  const result: InitializeResult = {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      // Tell the client that this server supports code completion.
      completionProvider: {
        resolveProvider: true,
      },
      documentFormattingProvider: true,
      semanticTokensProvider: {
        documentSelector: [{ language: "NQL" }],
        legend: {
          tokenTypes: tokenTypes as unknown as string[],
          tokenModifiers: tokenModifiers as unknown as string[],
        },
        range: false,
        full: true,
      },
    },
  };

  if (hasWorkspaceFolderCapability) {
    result.capabilities.workspace = {
      workspaceFolders: {
        supported: true,
      },
    };
  }

  return result;
});

connection.onInitialized(() => {
  if (hasConfigurationCapability) {
    // Register for all configuration changes.
    connection.client.register(
      DidChangeConfigurationNotification.type,
      undefined,
    );
  }

  if (hasWorkspaceFolderCapability) {
    connection.workspace.onDidChangeWorkspaceFolders((_event) => {
      connection.console.log("Workspace folder change event received.");
    });
  }

  connection.languages.semanticTokens.on(
    (params: SemanticTokensParams, token) => {
      const provider = new TokenAdapter();

      const result: SemanticTokens = {
        data: [],
      };

      // return result;
      return provider.provideDocumentSemanticTokens(params.textDocument, token);
    },
  );
});

interface IToken {
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

function getTokens(nqlString: string): IToken[] {
  const document = nqlString;

  if (!parser) {
    return [];
  }

  const tree = parser.parse(document);

  const isUserDefinedField = (node: Parser.SyntaxNode): boolean => {
    let isFound: boolean = false;

    const findDeclaration = (treeNode: Parser.SyntaxNode): boolean => {
      for (const child of treeNode.children) {
        switch (child.type) {
          case "summarize_clause":
          case "compute_clause":
            child.children.forEach((c) => {
              if (c.type === "field_name" && c.text === node.text) {
                isFound = true;
              }
            });
            break;
          default:
            break;
        }

        findDeclaration(child);
      }

      return isFound;
    };

    return findDeclaration(tree.rootNode);
  };

  const getNodeTokens = (node: Parser.SyntaxNode) => {
    const tokens: {
      type: string;
      text: string;
      modifiers: string[];
      startPosition: {
        column: number;
        row: number;
      };
      endPosition: {
        column: number;
        row: number;
      };
    }[] = [];

    for (const child of node.children) {
      switch (child.type) {
        case "enum":
        case "boolean":
        case "date_time":
        case "date":
        case "duration":
        case "float":
        case "int":
        case "string":
        case "table":
        case "aggregate_function":
        case "aggregate_field":
        case "field_property":
        case "byte":
          tokens.push({
            type: child.type,
            startPosition: child.startPosition,
            endPosition: child.endPosition,
            text: child.text,
            modifiers: [],
          });
          break;
        case "field_name":
          tokens.push({
            type: child.type,
            startPosition: child.startPosition,
            endPosition: child.endPosition,
            text: child.text,
            // TODO: Can this be done in the parser?
            modifiers: isUserDefinedField(child)
              ? ["declaration", "readonly"]
              : [],
          });
          break;
        default:
          console.log("Unhandled node type: ", child.type);
          break;
      }

      tokens.push(...getNodeTokens(child));
    }

    return tokens;
  };

  const tokens = getNodeTokens(tree.rootNode);

  return tokens;
}

function applyModifiers(
  availableModifiers: typeof tokenModifiers,
  // modifiersToApply: (typeof tokenModifiers)[number][],
  modifiersToApply: string[],
) {
  let result = 0;

  for (let i = 0; i < availableModifiers.length; i++) {
    if (modifiersToApply.includes(availableModifiers[i])) {
      result |= 1 << i;
    }
  }

  return result;
}

export class TokenAdapter {
  public getLegend(): SemanticTokensLegend {
    return {
      tokenTypes: tokenTypes as unknown as string[],
      tokenModifiers: tokenModifiers as unknown as string[],
    };
  }

  public provideDocumentSemanticTokens(
    document: TextDocumentIdentifier,
    token: CancellationToken,
  ): SemanticTokens {
    const d = documents.get(document.uri);
    const c = d?.getText();

    if (!c) {
      return {
        data: [],
        resultId: undefined,
      };
    }

    const tokens = getTokens(c);

    /**
     * How to encode tokens
     *
     * Here is an example for encoding a file with 3 tokens in a uint32 array
     *
     * ```
     * { line: 2, startChar:  5, length: 3, tokenType: "property",  tokenModifiers: ["private", "static"] },
     * { line: 2, startChar: 10, length: 4, tokenType: "type",      tokenModifiers: [] },
     * { line: 5, startChar:  2, length: 7, tokenType: "class",     tokenModifiers: [] }
     * ```
     *
     * First of all, a legend must be devised. This legend must be provided up-front and capture all possible token types. For this example, we will choose the following legend which must be passed in when registering the provider:
     *
     * ```
     * tokenTypes: ['property', 'type', 'class'],
     * tokenModifiers: ['private', 'static']
     * ```
     *
     * The first transformation step is to encode tokenType and tokenModifiers as integers using the legend.
     * Token types are looked up by index, so a tokenType value of 1 means tokenTypes[1].
     * Multiple token modifiers can be set by using bit flags,
     * so a tokenModifier value of 3 is first viewed as binary 0b00000011,
     * which means [tokenModifiers[0], tokenModifiers[1]] because bits 0 and 1 are set.
     * Using this legend, the tokens now are:
     *
     * ```
     * { line: 2, startChar:  5, length: 3, tokenType: 0, tokenModifiers: 3 },
     * { line: 2, startChar: 10, length: 4, tokenType: 1, tokenModifiers: 0 },
     * { line: 5, startChar:  2, length: 7, tokenType: 2, tokenModifiers: 0 }
     * ```
     *
     * The next step is to represent each token relative to the previous token in the file. In this case, the second token is on the same line as the first token, so the startChar of the second token is made relative to the startChar of the first token, so it will be 10 - 5. The third token is on a different line than the second token, so the startChar of the third token will not be altered:
     *
     * ```
     * { deltaLine: 2, deltaStartChar: 5, length: 3, tokenType: 0, tokenModifiers: 3 },
     * { deltaLine: 0, deltaStartChar: 5, length: 4, tokenType: 1, tokenModifiers: 0 },
     * { deltaLine: 3, deltaStartChar: 2, length: 7, tokenType: 2, tokenModifiers: 0 }
     * ```
     *
     * Finally, the last step is to inline each of the 5 fields for a token in a single array, which is a memory friendly representation:
     *
     * ```
     * // 1st token,  2nd token,  3rd token
     * [  2,5,3,0,3,  0,5,4,1,0,  3,2,7,2,0 ]
     * ```
     */

    let prevLine = 0;
    let prevChar = 0;

    const semanticTokens = [];

    for (const token of tokens) {
      const lineDelta = token.startPosition.row - prevLine;
      const charDelta =
        lineDelta === 0
          ? token.startPosition.column - prevChar
          : token.startPosition.column;

      const tokenType = tokenTypes.indexOf(tokenTypeMap[token.type]);

      // TODO: Set individual bits based on modifiers

      semanticTokens.push([
        lineDelta,
        charDelta,
        token.text.length,
        tokenType,
        applyModifiers(tokenModifiers, token.modifiers),
      ]);

      prevLine = token.startPosition.row;
      prevChar = token.startPosition.column;
    }

    if (token.isCancellationRequested) {
      return {
        data: [],
        resultId: undefined,
      };
    }

    return {
      data: semanticTokens.flat(),
      resultId: undefined,
    };
  }

  public releaseDocumentSemanticTokens() {}
}

// async function validateTextDocument(textDocument: TextDocument): Promise<void> {
//   // In this simple example we get the settings for every validate run.
//   const settings = await getDocumentSettings(textDocument.uri);

//   console.log("***");
//   console.log(settings);
//   console.log("***");

//   // Send the computed diagnostics to VSCode.
//   connection.sendDiagnostics({ uri: textDocument.uri, diagnostics: [] });
// }

// connection.onRequest(SemanticTokensRequest.type, (params, token) => {
//   console.log("***");
//   console.log(SemanticTokensRequest.type);
//   console.log("***");
//   return null;
// });

// connection.onRequest(SemanticTokenTypes.type, (params, token) => {
//   console.log("***");
//   console.log(SemanticTokenTypes.type);
//   console.log("***");
//   return null;
// });

connection.onDidChangeConfiguration((change) => {
  if (hasConfigurationCapability) {
    // Reset all cached document settings
    documentSettings.clear();
  } else {
    globalSettings = <ISettings>(change.settings.NQL || defaultSettings);
  }

  // Revalidate all open text documents
  documents.all().forEach(validateTextDocument);
});

// Only keep settings for open documents
documents.onDidClose((e) => {
  documentSettings.delete(e.document.uri);
});

// The content of a text document has changed. This event is emitted
// when the text document first opened or when its content has changed.
documents.onDidChangeContent((change) => {
  validateTextDocument(change.document);
});

async function validateTextDocument(textDocument: TextDocument): Promise<void> {
  // In this simple example we get the settings for every validate run.
  const settings = await getDocumentSettings(textDocument.uri);

  connection.console.log("We received an file change event");
  console.log("settings", settings);

  // The validator creates diagnostics for all uppercase words length 2 and more
  const text = textDocument.getText();
  const pattern = /\b[A-Z]{2,}\b/g;
  let m: RegExpExecArray | null;

  let problems = 0;
  const diagnostics: Diagnostic[] = [];
  while ((m = pattern.exec(text)) && problems < 100) {
    problems++;
    const diagnostic: Diagnostic = {
      severity: DiagnosticSeverity.Warning,
      range: {
        start: textDocument.positionAt(m.index),
        end: textDocument.positionAt(m.index + m[0].length),
      },
      message: `${m[0]} is all uppercase.`,
      source: "ex",
    };
    if (hasDiagnosticRelatedInformationCapability) {
      diagnostic.relatedInformation = [
        {
          location: {
            uri: textDocument.uri,
            range: Object.assign({}, diagnostic.range),
          },
          message: "Spelling matters",
        },
        {
          location: {
            uri: textDocument.uri,
            range: Object.assign({}, diagnostic.range),
          },
          message: "Particularly for names",
        },
      ];
    }
    diagnostics.push(diagnostic);
  }

  // Send the computed diagnostics to VSCode.
  connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
}

connection.onDocumentFormatting(async (_params): Promise<TextEdit[]> => {
  // Get current active document and its content
  const document = documents.get(_params.textDocument.uri);
  const content = document?.getText();

  function format(nqlString: string): string | undefined {
    if (!content || !parser) {
      return;
    }

    const tree = parser.parse(nqlString);

    const checkIfNodeHasParent = (
      node: Parser.SyntaxNode,
      type: string,
    ): boolean => {
      if (!node.parent) {
        return false;
      }

      if (node.parent.type === type) {
        return true;
      }

      return checkIfNodeHasParent(node.parent, type);
    };

    const checkIfNodeHasPreviousSibling = (
      node: Parser.SyntaxNode,
      type: string,
    ): boolean => {
      if (!node.previousSibling) {
        return false;
      }

      if (node.previousSibling.type === type) {
        return true;
      }

      return checkIfNodeHasPreviousSibling(node.previousSibling, type);
    };

    const padLeft = (str: string, len: number, char: string) =>
      char.repeat(len) + str;

    const padLeftSpace = (str: string, len: number = 1) =>
      padLeft(str, len, " ");

    const padLeftNewLine = (str: string, len: number = 1) =>
      padLeft(str, len, "\n");

    const padRight = (str: string, len: number, char: string) =>
      str + char.repeat(len);

    const padRightSpace = (str: string, len: number = 1) =>
      padRight(str, len, " ");

    function joinLeafNodes(node: Parser.SyntaxNode): string {
      const type = node.type;
      const text = node.text.trim();

      switch (type) {
        case "field_name":
          if (checkIfNodeHasParent(node, "expression")) {
            return text;
          }
          return padLeftNewLine(padLeftSpace(text, 2));
        case "time_frame":
          return padLeftNewLine(padLeftSpace(text, 2));
        case "clause":
          return padLeftNewLine(node.children.map(joinLeafNodes).join(""), 2);
        case "compute_clause":
        case "include_clause":
        case "list_clause":
        case "limit_clause":
        case "select_clause":
        case "sort_clause":
        case "summarize_clause":
        case "where_clause":
        case "with_clause":
          return padLeftSpace(node.children.map(joinLeafNodes).join(""));
        case "table":
          return padLeftNewLine(padLeftSpace(text, 2));
        case "and":
        case "or":
          return padLeftNewLine(padLeftSpace(text, 2));
        case "by":
          return padLeftNewLine(padLeftSpace(padRightSpace(text), 2));
        case "limit":
          return padRightSpace(text);
        case "sort_order":
          return padLeftNewLine(padLeftSpace(text, 2));
        case "alias":
        case "division":
        case "equals":
        case "greater_than_or_equals":
        case "greater_than":
        case "in_array":
        case "less_than_or_equals":
        case "less_than":
        case "multiplication":
        case "not_equals":
        case "not_in_array":
        case "subtraction":
        case "addition":
          return padRightSpace(padLeftSpace(text));
        case "duration":
        case "byte":
        case "int":
        case "string":
          return text;
        case ",":
          return padRightSpace(text);
        case "pipe":
          return text;
        case "expression_parenthesized_expression":
          return padLeftNewLine(
            padLeftSpace(node.children.map(joinLeafNodes).join(""), 4),
          );
      }

      if (!node.children.length) {
        return text;
      }

      const childValues = node.children.map(joinLeafNodes);

      return childValues.join("");
    }

    const formattedNql = joinLeafNodes(tree.rootNode);

    // Remove all dangling whitespace after coma if the next character is a newline
    const cleanFormattedNql = formattedNql.replace(/,\s\n/g, ",\n").trim();

    return cleanFormattedNql;
  }

  if (!content) {
    return [];
  }

  const newText = format(content);

  if (!newText) {
    return [];
  }

  const textEdit: TextEdit = {
    range: {
      start: { line: 0, character: 0 },
      end: { line: Number.MAX_VALUE, character: Number.MAX_VALUE },
    },
    newText,
  };

  return [textEdit];
});

connection.onDidChangeWatchedFiles((_change) => {
  // Monitored files have change in VSCode
  connection.console.log("We received an file change event");
});

// This handler provides the initial list of the completion items.
connection.onCompletion(
  (_textDocumentPosition: TextDocumentPositionParams): CompletionItem[] => {
    // The pass parameter contains the position of the text document in
    // which code complete got requested. For the example we ignore this
    // info and always provide the same completion items.
    return [
      {
        label: "TypeScript",
        kind: CompletionItemKind.Text,
        data: 1,
      },
      {
        label: "JavaScript",
        kind: CompletionItemKind.Text,
        data: 2,
      },
    ];
  },
);

// This handler resolves additional information for the item selected in
// the completion list.
connection.onCompletionResolve((item: CompletionItem): CompletionItem => {
  if (item.data === 1) {
    item.detail = "TypeScript details";
    item.documentation = "TypeScript documentation";
  } else if (item.data === 2) {
    item.detail = "JavaScript details";
    item.documentation = "JavaScript documentation";
  }
  return item;
});

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// Listen on the connection
connection.listen();
