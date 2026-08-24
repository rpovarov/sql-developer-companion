import { findEmbeddedSqlRanges } from '../embeddedSql/embeddedSqlRanges';
import {
    ProgramUnitNavigationKind,
    ProgramUnitSymbol,
} from './semanticNavigation';

export type EmbeddedSqlDefinitionTarget = 'body' | 'spec' | 'both';

export interface EmbeddedSqlResolution {
    start: number;
    end: number;
    targets: ProgramUnitSymbol[];
}

interface Identifier {
    name: string;
    start: number;
    end: number;
}

interface CallShape {
    argumentCount: number;
    namedArguments: string[];
    positionalArgumentCount: number;
}

/** Resolve a static Oracle reference under a cursor in supported embedded SQL. */
export function resolveEmbeddedSqlReferenceAt(
    text: string,
    offset: number,
    lookupSymbols: (name: string) => readonly ProgramUnitSymbol[],
    navigation: ProgramUnitNavigationKind,
    definitionTarget: EmbeddedSqlDefinitionTarget,
): EmbeddedSqlResolution | undefined {
    const range = findEmbeddedSqlRanges(text).find(candidate =>
        offset >= candidate.start && offset < candidate.end
    );
    if (!range) {
        return undefined;
    }

    const sql = maskOracleCommentsAndStrings(text.slice(range.start, range.end));
    const localOffset = offset - range.start;
    if (isInsideInterpolation(sql, localOffset)) {
        return undefined;
    }

    const identifier = findIdentifierAt(sql, localOffset);
    if (!identifier || isBindOrNamedArgument(sql, identifier)) {
        return undefined;
    }

    const memberCall = findMemberCall(sql, identifier);
    if (memberCall?.member.start === identifier.start) {
        const qualifierKinds = programUnitKinds(
            memberCall.qualifier.name,
            lookupSymbols,
        );
        const candidates = lookupSymbols(memberCall.member.name).filter(symbol =>
            (symbol.kind === 'procedure' || symbol.kind === 'function') &&
            symbol.programUnitName.toLowerCase() === memberCall.qualifier.name.toLowerCase() &&
            qualifierKinds.has(symbol.programUnitKind) &&
            (symbol.programUnitKind !== 'type' || symbol.modifiers.includes('static')) &&
            isCompatibleCall(memberCall.call, symbol)
        );
        return resolution(
            range.start,
            identifier,
            selectTargets(candidates, navigation, definitionTarget),
        );
    }

    if (memberCall?.qualifier.start === identifier.start) {
        const headers = lookupSymbols(identifier.name).filter(symbol =>
            (symbol.kind === 'package' || symbol.kind === 'type') &&
            symbol.name.toLowerCase() === identifier.name.toLowerCase()
        );
        return resolution(
            range.start,
            identifier,
            selectTargets(headers, navigation, definitionTarget),
        );
    }

    if (isPartOfQualifiedName(sql, identifier)) {
        return undefined;
    }

    const schemaTypes = lookupSymbols(identifier.name).filter(symbol =>
        symbol.programUnitKind === 'type' &&
        symbol.kind === 'type' &&
        symbol.name.toLowerCase() === identifier.name.toLowerCase()
    );
    return resolution(
        range.start,
        identifier,
        selectTargets(schemaTypes, navigation, definitionTarget),
    );
}

function resolution(
    rangeStart: number,
    identifier: Identifier,
    targets: readonly ProgramUnitSymbol[],
): EmbeddedSqlResolution | undefined {
    const uniqueTargets = [...new Map(targets.map(target => [
        `${target.uri}:${target.line}:${target.column}`,
        target,
    ])).values()];
    return uniqueTargets.length === 0 ? undefined : {
        start: rangeStart + identifier.start,
        end: rangeStart + identifier.end,
        targets: uniqueTargets,
    };
}

function programUnitKinds(
    name: string,
    lookupSymbols: (name: string) => readonly ProgramUnitSymbol[],
): Set<ProgramUnitSymbol['programUnitKind']> {
    return new Set(lookupSymbols(name)
        .filter(symbol => symbol.kind === 'package' || symbol.kind === 'type')
        .map(symbol => symbol.programUnitKind));
}

function selectTargets(
    candidates: readonly ProgramUnitSymbol[],
    navigation: ProgramUnitNavigationKind,
    definitionTarget: EmbeddedSqlDefinitionTarget,
): ProgramUnitSymbol[] {
    const side = navigation === 'declaration'
        ? 'specification'
        : navigation === 'implementation'
            ? 'body'
            : undefined;
    const requestedSides = side
        ? new Set([side])
        : definitionTarget === 'both'
            ? new Set(['specification', 'body'])
            : new Set([definitionTarget === 'spec' ? 'specification' : 'body']);

    return candidates.filter(symbol =>
        requestedSides.has(symbol.side) &&
        (symbol.side !== 'body' ||
            (symbol.kind !== 'procedure' && symbol.kind !== 'function') ||
            symbol.isImplementation !== false)
    );
}

function isCompatibleCall(call: CallShape, symbol: ProgramUnitSymbol): boolean {
    if (!symbol.signatureComplete) {
        return true;
    }
    if (call.argumentCount < symbol.requiredParameterCount ||
        call.argumentCount > symbol.parameterCount) {
        return false;
    }
    const parameterNames = new Set(symbol.parameterNames.map(name => name.toLowerCase()));
    if (!call.namedArguments.every(name => parameterNames.has(name.toLowerCase()))) {
        return false;
    }
    const namedArguments = new Set(call.namedArguments.map(name => name.toLowerCase()));
    return symbol.requiredParameterNames.every(name => {
        const parameterIndex = symbol.parameterNames.indexOf(name);
        return parameterIndex < call.positionalArgumentCount ||
            namedArguments.has(name.toLowerCase());
    });
}

function findIdentifierAt(text: string, offset: number): Identifier | undefined {
    return [...text.matchAll(/[A-Za-z][\w$#]*/g)]
        .map(match => ({
            name: match[0],
            start: match.index,
            end: match.index + match[0].length,
        }))
        .find(identifier => offset >= identifier.start && offset < identifier.end);
}

function findMemberCall(
    text: string,
    clicked: Identifier,
): { qualifier: Identifier; member: Identifier; call: CallShape } | undefined {
    const memberAfter = identifierAfterDot(text, clicked);
    if (memberAfter) {
        const call = callShapeAfter(text, memberAfter);
        return call ? { qualifier: clicked, member: memberAfter, call } : undefined;
    }

    const qualifierBefore = identifierBeforeDot(text, clicked);
    if (!qualifierBefore) {
        return undefined;
    }
    const call = callShapeAfter(text, clicked);
    return call ? { qualifier: qualifierBefore, member: clicked, call } : undefined;
}

function identifierAfterDot(text: string, identifier: Identifier): Identifier | undefined {
    let cursor = skipWhitespaceForward(text, identifier.end);
    if (text[cursor] !== '.') {
        return undefined;
    }
    cursor = skipWhitespaceForward(text, cursor + 1);
    return identifierStartingAt(text, cursor);
}

function identifierBeforeDot(text: string, identifier: Identifier): Identifier | undefined {
    let cursor = skipWhitespaceBackward(text, identifier.start - 1);
    if (text[cursor] !== '.') {
        return undefined;
    }
    cursor = skipWhitespaceBackward(text, cursor - 1);
    const match = /[A-Za-z][\w$#]*$/.exec(text.slice(0, cursor + 1));
    return match ? {
        name: match[0],
        start: cursor + 1 - match[0].length,
        end: cursor + 1,
    } : undefined;
}

function identifierStartingAt(text: string, start: number): Identifier | undefined {
    const match = /^[A-Za-z][\w$#]*/.exec(text.slice(start));
    return match ? { name: match[0], start, end: start + match[0].length } : undefined;
}

function callShapeAfter(text: string, identifier: Identifier): CallShape | undefined {
    const opening = skipWhitespaceForward(text, identifier.end);
    if (text[opening] !== '(') {
        return undefined;
    }
    const closing = findMatchingParenthesis(text, opening);
    if (closing === undefined) {
        return undefined;
    }
    const argumentsList = splitTopLevel(text.slice(opening + 1, closing));
    const namedArguments = argumentsList.flatMap(argument => {
        const named = /^\s*([A-Za-z][\w$#]*)\s*=>/i.exec(argument);
        return named ? [named[1]] : [];
    });
    return {
        argumentCount: argumentsList.length,
        namedArguments,
        positionalArgumentCount: argumentsList.length - namedArguments.length,
    };
}

function splitTopLevel(text: string): string[] {
    if (text.trim() === '') {
        return [];
    }
    const entries: string[] = [];
    let start = 0;
    let depth = 0;
    for (let index = 0; index < text.length; index++) {
        if (text[index] === '(') {
            depth++;
        } else if (text[index] === ')') {
            depth--;
        } else if (text[index] === ',' && depth === 0) {
            entries.push(text.slice(start, index));
            start = index + 1;
        }
    }
    entries.push(text.slice(start));
    return entries;
}

function findMatchingParenthesis(text: string, opening: number): number | undefined {
    let depth = 1;
    for (let cursor = opening + 1; cursor < text.length; cursor++) {
        if (text[cursor] === '(') {
            depth++;
        } else if (text[cursor] === ')') {
            depth--;
            if (depth === 0) {
                return cursor;
            }
        }
    }
    return undefined;
}

function isBindOrNamedArgument(text: string, identifier: Identifier): boolean {
    const before = skipWhitespaceBackward(text, identifier.start - 1);
    if (text[before] === ':') {
        return true;
    }
    const after = skipWhitespaceForward(text, identifier.end);
    return text.slice(after, after + 2) === '=>';
}

function isPartOfQualifiedName(text: string, identifier: Identifier): boolean {
    const before = skipWhitespaceBackward(text, identifier.start - 1);
    const after = skipWhitespaceForward(text, identifier.end);
    return text[before] === '.' || text[after] === '.';
}

function skipWhitespaceForward(text: string, start: number): number {
    let cursor = start;
    while (/\s/.test(text[cursor] ?? '')) {
        cursor++;
    }
    return cursor;
}

function skipWhitespaceBackward(text: string, start: number): number {
    let cursor = start;
    while (cursor >= 0 && /\s/.test(text[cursor])) {
        cursor--;
    }
    return cursor;
}

function isInsideInterpolation(text: string, offset: number): boolean {
    let depth = 0;
    for (let cursor = 0; cursor < offset; cursor++) {
        if (text.startsWith('{{', cursor) || text.startsWith('}}', cursor)) {
            cursor++;
        } else if (text[cursor] === '{') {
            depth++;
        } else if (text[cursor] === '}') {
            depth = Math.max(0, depth - 1);
        }
    }
    return depth > 0;
}

function maskOracleCommentsAndStrings(text: string): string {
    const masked = [...text];
    const hide = (start: number, end: number) => {
        for (let index = start; index < end; index++) {
            if (masked[index] !== '\n' && masked[index] !== '\r') {
                masked[index] = ' ';
            }
        }
    };

    for (let cursor = 0; cursor < text.length;) {
        if (text.startsWith('--', cursor)) {
            const end = text.indexOf('\n', cursor + 2);
            const commentEnd = end === -1 ? text.length : end;
            hide(cursor, commentEnd);
            cursor = commentEnd;
        } else if (text.startsWith('/*', cursor)) {
            const end = text.indexOf('*/', cursor + 2);
            const commentEnd = end === -1 ? text.length : end + 2;
            hide(cursor, commentEnd);
            cursor = commentEnd;
        } else if (text[cursor] === "'") {
            const start = cursor++;
            while (cursor < text.length) {
                if (text[cursor] !== "'") {
                    cursor++;
                } else if (text[cursor + 1] === "'") {
                    cursor += 2;
                } else {
                    cursor++;
                    break;
                }
            }
            hide(start, cursor);
        } else {
            cursor++;
        }
    }
    return masked.join('');
}
