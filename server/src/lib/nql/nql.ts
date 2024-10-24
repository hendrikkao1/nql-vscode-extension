import Parser = require("web-tree-sitter");

import { INQLParserError, INQLToken, NQLTokenModifier } from "./nql.types";

export class NQL {
  private _parser: Parser | null;
  private _parserFile: string;
  private _parserLocateFile: ((scriptName: string) => string) | undefined;

  constructor({
    parserFile,
    parserLocateFile,
  }: {
    parserFile: string;
    parserLocateFile?: (scriptName: string) => string;
  }) {
    this._parserFile = parserFile;
    this._parserLocateFile = parserLocateFile;
    this._parser = null;
  }

  private async getParser(): Promise<Parser> {
    if (this._parser) {
      return this._parser;
    }

    await Parser.init({
      locateFile: this._parserLocateFile,
    });

    const nql = await Parser.Language.load(this._parserFile);

    const parser = new Parser();

    parser.setLanguage(nql);

    this._parser = parser;

    return parser;
  }

  async getTokens(content: string): Promise<INQLToken[]> {
    const parser = await this.getParser();

    const tree = parser.parse(content);

    // TODO: Improve this
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

    const _getTokens = (node: Parser.SyntaxNode): INQLToken[] => {
      const tokens: INQLToken[] = [];

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
          case "avg":
          case "count_if":
          case "count":
          case "last":
          case "max":
          case "min":
          case "sum_if":
          case "sum":
            tokens.push({
              type: "aggregate_function",
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
              modifiers: isUserDefinedField(child)
                ? [NQLTokenModifier.readonly]
                : [NQLTokenModifier.defaultLibrary],
            });
            break;
          default:
            console.log("Unhandled node type: ", child.type);
            break;
        }

        tokens.push(..._getTokens(child));
      }

      return tokens;
    };

    return _getTokens(tree.rootNode);
  }

  async formatContent({
    content,
    tabSize,
    insertSpaces,
  }: {
    content: string;
    tabSize: number;
    insertSpaces: boolean;
  }): Promise<string> {
    const parser = await this.getParser();

    const tree = parser.parse(content);

    const checkIfNodeHasTypeOfParent = (
      node: Parser.SyntaxNode,
      type: string,
    ): boolean => {
      if (!node.parent) {
        return false;
      }

      if (node.parent.type === type) {
        return true;
      }

      return checkIfNodeHasTypeOfParent(node.parent, type);
    };

    const getNodeOfTypeDepth = (
      node: Parser.SyntaxNode,
      type: string,
      depth = 1,
    ): number => {
      if (!node.parent) {
        return depth;
      }

      if (node.parent.type === type) {
        return getNodeOfTypeDepth(node.parent, type, depth + 1);
      }

      return getNodeOfTypeDepth(node.parent, type, depth);
    };

    const padChar = insertSpaces ? " " : "\t";

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
          if (checkIfNodeHasTypeOfParent(node, "expression")) {
            return text;
          }
          return padLeftNewLine(padLeft(text, tabSize, padChar));
        case "time_frame":
          return padLeftNewLine(padLeft(text, tabSize, padChar));
        case "clause":
          return padLeftNewLine(
            node.children.map(joinLeafNodes).join(""),
            tabSize,
          );
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
          return padLeftNewLine(padLeft(text, tabSize, padChar));
        case "and":
        case "or":
          if (checkIfNodeHasTypeOfParent(node, "aggregate_function")) {
            return padRightSpace(padLeftSpace(text));
          }
          return padLeftNewLine(padLeft(text, tabSize, padChar));
        case "by":
          return padLeftNewLine(padLeft(padRightSpace(text), tabSize, padChar));
        case "limit":
          return padRightSpace(text);
        case "sort_order":
          return padLeftNewLine(padLeft(text, tabSize, padChar));
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
          // eslint-disable-next-line no-case-declarations
          const depth = getNodeOfTypeDepth(node, node.type, 1);
          return padLeftNewLine(
            padLeft(
              node.children.map(joinLeafNodes).join(""),
              depth * 2,
              padChar,
            ),
          );
      }

      if (!node.children.length) {
        return text;
      }

      return node.children.map(joinLeafNodes).join("");
    }

    const formattedDocument = joinLeafNodes(tree.rootNode);

    // Remove all dangling whitespace after coma if the next character is a newline
    const cleanFormattedDocument = formattedDocument
      .replace(/,\s\n/g, ",\n")
      .trim();

    return cleanFormattedDocument;
  }

  async getContentParseErrors(content: string): Promise<INQLParserError[]> {
    const parser = await this.getParser();

    const tree = parser.parse(content);

    if (!tree.rootNode.hasError()) {
      return [];
    }

    const getNodeErrors = (node: Parser.SyntaxNode) => {
      const errors: INQLParserError[] = [];

      for (const child of node.children) {
        switch (child.type) {
          case "ERROR":
            errors.push({
              text: child.text,
              startPosition: child.startPosition,
              endPosition: child.endPosition,
            });
            break;
          default:
            break;
        }

        errors.push(...getNodeErrors(child));
      }

      return errors;
    };

    return getNodeErrors(tree.rootNode);
  }
}
