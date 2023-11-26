import {
  editorTokenModifierList,
  editorTokenTypeList,
  INQLToken,
  NQLTokenModifierToEditorTokenModifierMap,
  NQLTokenTypeToEditorTokenTypeMap,
} from "./nql.types";

const getEditorTokenModifiers = (
  availableModifiers: typeof editorTokenModifierList,
  modifiersToApply: typeof editorTokenModifierList,
) => {
  let result = 0;

  for (let i = 0; i < availableModifiers.length; i++) {
    if (modifiersToApply.includes(availableModifiers[i])) {
      result |= 1 << i;
    }
  }

  return result;
};

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
export const nqlTokensToVSCodeTokens = (nqlTokens: INQLToken[]): number[] => {
  let prevLine = 0;
  let prevChar = 0;

  const semanticTokens = [];

  for (const token of nqlTokens) {
    const lineDelta = token.startPosition.row - prevLine;
    const charDelta =
      lineDelta === 0
        ? token.startPosition.column - prevChar
        : token.startPosition.column;

    const tokenType = editorTokenTypeList.indexOf(
      NQLTokenTypeToEditorTokenTypeMap[token.type],
    );

    const modifiers = getEditorTokenModifiers(
      editorTokenModifierList,
      token.modifiers.map((m) => NQLTokenModifierToEditorTokenModifierMap[m]),
    );

    semanticTokens.push([
      lineDelta,
      charDelta,
      token.text.length,
      tokenType,
      modifiers,
    ]);

    prevLine = token.startPosition.row;
    prevChar = token.startPosition.column;
  }

  return semanticTokens.flat();
};
