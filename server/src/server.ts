import {
  CancellationToken,
  createConnection,
  Diagnostic,
  DidChangeConfigurationNotification,
  InitializeParams,
  InitializeResult,
  ProposedFeatures,
  SemanticTokens,
  SemanticTokensLegend,
  SemanticTokensParams,
  TextDocumentIdentifier,
  TextDocuments,
  TextDocumentSyncKind,
  TextEdit,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";

import Parser = require("web-tree-sitter");

let parser: Parser | undefined;

Parser.init()
  .then(() => Parser.Language.load(__dirname + "/tree-sitter-nql.wasm"))
  .then((lang) => {
    parser = new Parser();
    parser.setLanguage(lang);
  });

const tokenTypes = [
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
  aggregate_function: "function",
  field_name: "variable",
  field_property: "property",
  aggregate_field: "property",
};

// Create a simple text document manager.
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

let hasConfigurationCapability = false;
let hasWorkspaceFolderCapability = false;
let hasDiagnosticRelatedInformationCapability = false;

// The settings
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

  connection.languages.semanticTokens.on(
    (params: SemanticTokensParams, token) => {
      const provider = new TokenAdapter();
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
    const textDocument = documents.get(document.uri);
    const content = textDocument?.getText();

    if (!content) {
      return {
        data: [],
        resultId: undefined,
      };
    }

    const tokens = getTokens(content);

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
  const diagnostics: Diagnostic[] = [];

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

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// Listen on the connection
connection.listen();
