import { INQLToken, TokenModifiers, NQLTokenTypeToTokenTypeMap, TokenTypes } from './nql.types';

const getTokenModifiers = (
	availableModifiers: string[],
	modifiersToApply: string[],
) => {
	let result = 0;

	for (let i = 0; i < availableModifiers.length; i++) {
		if (modifiersToApply.includes(availableModifiers[i])) {
			result |= 1 << i;
		}
	}

	return result;
};

export const nqlTokensToVSCodeTokens = (
	nqlTokens: INQLToken[],
): number[] => {
	let prevLine = 0;
	let prevChar = 0;

	const semanticTokens = [];

	for (const token of nqlTokens) {
		const lineDelta = token.startPosition.row - prevLine;
		const charDelta =
			lineDelta === 0
				? token.startPosition.column - prevChar
				: token.startPosition.column;

		const tokenType = TokenTypes.indexOf(NQLTokenTypeToTokenTypeMap[token.type]);

		const modifiers = getTokenModifiers(TokenModifiers as unknown as string[], token.modifiers);

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