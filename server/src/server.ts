import {
  CancellationToken,
  createConnection,
  Diagnostic,
  DiagnosticSeverity,
  InitializeResult,
  ProposedFeatures,
  Range,
  SemanticTokens,
  SemanticTokensParams,
  TextDocumentIdentifier,
  TextDocuments,
  TextDocumentSyncKind,
  TextEdit,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import {
  editorTokenModifierList,
  editorTokenTypeList,
  NQL,
  nqlTokensToVSCodeTokens,
} from "./lib/nql";

const nql = new NQL({
  parserFile: __dirname + "/lib/nql/tree-sitter-nql.wasm",
});

const provideDocumentSemanticTokens = async (
  documentIdentifier: TextDocumentIdentifier,
  token: CancellationToken,
): Promise<SemanticTokens> => {
  const document = documents.get(documentIdentifier.uri);
  const content = document?.getText();

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

const provideDocumentFormattingEdits = async ({
  documentIdentifier,
  tabSize,
  insertSpaces,
  token,
}: {
  documentIdentifier: TextDocumentIdentifier;
  tabSize: number;
  insertSpaces: boolean;
  token: CancellationToken;
}): Promise<TextEdit[]> => {
  const document = documents.get(documentIdentifier.uri);
  const content = document?.getText();

  if (!content) {
    return [];
  }

  const newText = await nql.formatContent({
    content,
    tabSize,
    insertSpaces,
  });

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

const valdiateDocument = async (document: TextDocument) => {
  const content = document.getText();

  const parserErrors = await nql.getContentParseErrors(content);

  const diagnostics: Diagnostic[] = parserErrors.map((error) => {
    const range = Range.create(
      error.startPosition.row,
      error.startPosition.column,
      error.endPosition.row,
      error.endPosition.column,
    );
    const message = `Syntax error: "${error.text}"`;
    const severity = DiagnosticSeverity.Error;
    const source = "NQL";

    return Diagnostic.create(range, message, severity, undefined, source);
  });

  connection.sendDiagnostics({
    uri: document.uri,
    diagnostics,
  });
};

// Create a simple text document manager.
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

documents.onDidChangeContent((change) => {
  valdiateDocument(change.document);
});

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
          tokenTypes: editorTokenTypeList,
          tokenModifiers: editorTokenModifierList,
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
  async (params, token): Promise<TextEdit[]> =>
    provideDocumentFormattingEdits({
      documentIdentifier: params.textDocument,
      tabSize: params.options.tabSize,
      insertSpaces: params.options.insertSpaces,
      token,
    }),
);

connection.onDidChangeConfiguration((change) => {
  documents.all().forEach(valdiateDocument);
});

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// Listen on the connection
connection.listen();
