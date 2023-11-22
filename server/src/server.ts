import {
  CancellationToken,
  createConnection,
  InitializeResult,
  ProposedFeatures,
  SemanticTokens,
  SemanticTokensParams,
  TextDocumentIdentifier,
  TextDocuments,
  TextDocumentSyncKind,
  TextEdit,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import {
  NQL,
  TokenModifiers,
  TokenTypes,
  nqlTokensToVSCodeTokens,
} from "./lib/nql";

const nql = new NQL({
  parserFile: __dirname + "/lib/nql/tree-sitter-nql.wasm",
});

const provideDocumentSemanticTokens = async (
  document: TextDocumentIdentifier,
  token: CancellationToken,
): Promise<SemanticTokens> => {
  const textDocument = documents.get(document.uri);
  const content = textDocument?.getText();

  if (!content) {
    return {
      data: [],
      resultId: undefined,
    };
  }

  const tokens = await nql.getTokens(content);
  const semanticTokens = nqlTokensToVSCodeTokens(tokens);

  if (token.isCancellationRequested) {
    return {
      data: [],
      resultId: undefined,
    };
  }

  return {
    data: semanticTokens,
    resultId: undefined,
  };
};

const provideDocumentFormattingEdits = async (
  documentIdentifier: TextDocumentIdentifier,
  token: CancellationToken,
): Promise<TextEdit[]> => {
  const document = documents.get(documentIdentifier.uri);
  const content = document?.getText();

  if (!content) {
    return [];
  }

  const newText = await nql.formatContent(content);

  if (token.isCancellationRequested) {
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
};

// Create a simple text document manager.
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

// Create a connection for the server, using Node's IPC as a transport.
// Also include all preview / proposed LSP features.
const connection = createConnection(ProposedFeatures.all);

connection.onInitialize(() => {
  const result: InitializeResult = {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      documentFormattingProvider: true,
      semanticTokensProvider: {
        documentSelector: [{ language: "NQL" }],
        legend: {
          tokenTypes: TokenTypes as unknown as string[],
          tokenModifiers: TokenModifiers as unknown as string[],
        },
        range: false,
        full: true,
      },
    },
    workspace: {
      workspaceFolders: {
        supported: true,
      },
    },
  };

  return result;
});

connection.onInitialized(() => {
  connection.languages.semanticTokens.on(
    (params: SemanticTokensParams, token) =>
      provideDocumentSemanticTokens(params.textDocument, token),
  );
});

connection.onDocumentFormatting(
  async (_params, token): Promise<TextEdit[]> =>
    provideDocumentFormattingEdits(_params.textDocument, token),
);

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// Listen on the connection
connection.listen();
