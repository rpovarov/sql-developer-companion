export interface SemanticDocument {
    uri: string;
    text: string;
}

export type ProgramUnitSide = 'specification' | 'body';
export type ProgramUnitKind = 'package' | 'type';
export type ProgramUnitModifier = 'constructor' | 'member' | 'static' | 'map' | 'order' | 'overriding';

export interface ProgramUnitSymbol {
    uri: string;
    programUnitName: string;
    programUnitKind: ProgramUnitKind;
    name: string;
    kind: 'package' | 'type' | 'procedure' | 'function';
    modifiers: ProgramUnitModifier[];
    signature: string;
    parameterCount: number;
    signatureComplete: boolean;
    isImplementation?: boolean;
    side: ProgramUnitSide;
    line: number;
    column: number;
}

export type ProgramUnitNavigationKind = 'definition' | 'declaration' | 'implementation';

/** Extract the program-unit symbols needed for spec/body navigation. */
export function extractProgramUnitSymbols(document: SemanticDocument): ProgramUnitSymbol[] {
    const source = maskCommentsAndStrings(document.text);
    const symbols: ProgramUnitSymbol[] = [];
    const programUnitPattern = /\b(PACKAGE|TYPE)\s+(BODY\s+)?(?:(?:[A-Za-z][\w$#]*)\s*\.\s*)?([A-Za-z][\w$#]*)\s+(?:FORCE\s+)?(?:(?:AUTHID\s+(?:CURRENT_USER|DEFINER))\s+)?(IS|AS|UNDER)\b/gi;

    for (const match of source.matchAll(programUnitPattern)) {
        if (match[1].toUpperCase() === 'TYPE' && !match[2] &&
            match[4].toUpperCase() !== 'UNDER' &&
            !/^\s*OBJECT\b/i.test(source.slice(match.index + match[0].length))) {
            continue;
        }
        const programUnitName = match[3];
        const nameOffset = match.index + match[0].toLowerCase().lastIndexOf(programUnitName.toLowerCase());
        const position = offsetToPosition(source, nameOffset);

        symbols.push({
            uri: document.uri,
            programUnitName,
            programUnitKind: match[1].toLowerCase() as ProgramUnitKind,
            name: programUnitName,
            kind: match[1].toLowerCase() as 'package' | 'type',
            modifiers: [],
            signature: '',
            parameterCount: 0,
            signatureComplete: true,
            side: match[2] ? 'body' : 'specification',
            line: position.line,
            column: position.column
        });

        const programUnitEnd = findProgramUnitEnd(source, match.index + match[0].length, programUnitName);
        const programUnitText = source.slice(match.index + match[0].length, programUnitEnd);
        const memberPattern = /^[ \t]*((?:(?:CONSTRUCTOR|MEMBER|STATIC|MAP|ORDER|OVERRIDING)\s+)*)(PROCEDURE|FUNCTION)\s+([A-Za-z][\w$#]*)\b/gim;
        let skipMembersBefore = 0;

        for (const memberMatch of programUnitText.matchAll(memberPattern)) {
            if (memberMatch.index < skipMembersBefore) {
                continue;
            }

            const memberName = memberMatch[3];
            const modifiers = memberMatch[1].trim().toLowerCase().split(/\s+/)
                .filter(Boolean) as ProgramUnitModifier[];
            const parameters = extractParameterSignature(
                programUnitText,
                memberMatch.index + memberMatch[0].length
            );
            const memberOffset = match.index + match[0].length + memberMatch.index +
                memberMatch[0].toLowerCase().lastIndexOf(memberName.toLowerCase());
            const memberPosition = offsetToPosition(source, memberOffset);
            const header = match[2]
                ? findMemberHeader(programUnitText, memberMatch.index + memberMatch[0].length)
                : undefined;

            symbols.push({
                uri: document.uri,
                programUnitName,
                programUnitKind: match[1].toLowerCase() as ProgramUnitKind,
                name: memberName,
                kind: memberMatch[2].toLowerCase() as 'procedure' | 'function',
                modifiers,
                signature: parameters.signature,
                parameterCount: parameters.count,
                signatureComplete: parameters.complete,
                isImplementation: match[2] ? header?.bodyStart !== undefined : false,
                side: match[2] ? 'body' : 'specification',
                line: memberPosition.line,
                column: memberPosition.column
            });

            if (match[2]) {
                const memberEnd = header?.bodyStart === undefined
                    ? undefined
                    : findMemberEnd(programUnitText, header.bodyStart, memberName);
                if (memberEnd !== undefined) {
                    skipMembersBefore = memberEnd;
                }
            }
        }
    }

    return symbols;
}

function findMemberHeader(
    text: string,
    start: number
): { bodyStart?: number; end: number } | undefined {
    const tokenPattern = /[A-Za-z][\w$#]*|[(),;]/g;
    tokenPattern.lastIndex = start;
    let depth = 0;
    let match: RegExpExecArray | null;

    while ((match = tokenPattern.exec(text))) {
        const value = match[0].toUpperCase();
        if (value === '(') {
            depth++;
        } else if (value === ')') {
            if (depth === 0) {
                return { end: tokenPattern.lastIndex };
            }
            depth--;
        } else if (depth === 0 && (value === ';' || value === ',')) {
            return { end: tokenPattern.lastIndex };
        } else if (depth === 0 && (value === 'IS' || value === 'AS')) {
            const next = nextToken(text, tokenPattern.lastIndex);
            if (value === 'AS' && next?.value.toUpperCase() === 'RESULT') {
                tokenPattern.lastIndex = next.end;
                continue;
            }
            return { bodyStart: tokenPattern.lastIndex, end: tokenPattern.lastIndex };
        }
    }

    return undefined;
}

function extractParameterSignature(
    text: string,
    start: number
): { signature: string; count: number; complete: boolean } {
    let opening = start;
    while (/\s/.test(text[opening] || '')) {
        opening++;
    }
    if (text[opening] !== '(') {
        return { signature: '', count: 0, complete: true };
    }

    let depth = 1;
    let closing = opening + 1;
    while (closing < text.length && depth > 0) {
        if (text[closing] === '(') {
            depth++;
        } else if (text[closing] === ')') {
            depth--;
        }
        closing++;
    }
    if (depth !== 0) {
        return { signature: '', count: 0, complete: false };
    }

    const parameters = splitParameters(text.slice(opening + 1, closing - 1));
    return {
        signature: parameters.map(normalizeParameter).join(','),
        count: parameters.length,
        complete: true
    };
}

function splitParameters(text: string): string[] {
    const parameters: string[] = [];
    let start = 0;
    let depth = 0;

    for (let index = 0; index < text.length; index++) {
        if (text[index] === '(') {
            depth++;
        } else if (text[index] === ')') {
            depth--;
        } else if (text[index] === ',' && depth === 0) {
            parameters.push(text.slice(start, index));
            start = index + 1;
        }
    }
    const last = text.slice(start).trim();
    if (last) {
        parameters.push(last);
    }
    return parameters;
}

function normalizeParameter(parameter: string): string {
    const withoutDefault = parameter.replace(/(?:\s+DEFAULT\b|\s*:=)\s*.*$/is, '');
    return withoutDefault
        .trim()
        .toUpperCase()
        .replace(/^[A-Z][\w$#]*\s+/, '')
        .replace(/^IN\s+(?!OUT\b)/, '')
        .replace(/\s*([.%(),])\s*/g, '$1')
        .replace(/\s+/g, ' ');
}

function findMemberEnd(text: string, start: number, memberName: string): number | undefined {
    const structuralEnd = findStructuralMemberEnd(text, start);
    if (structuralEnd !== undefined) {
        return structuralEnd;
    }
    const escapedName = memberName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const endPattern = new RegExp(`\\bEND\\s+${escapedName}\\s*;`, 'ig');
    endPattern.lastIndex = start;
    const namedEnd = endPattern.exec(text);
    return namedEnd ? endPattern.lastIndex : undefined;
}

function findStructuralMemberEnd(text: string, start: number): number | undefined {
    let position = start;

    while (position < text.length) {
        const token = nextToken(text, position);
        if (!token) {
            return undefined;
        }

        const value = token.value.toUpperCase();
        if (value === 'PROCEDURE' || value === 'FUNCTION') {
            const nestedName = nextToken(text, token.end);
            if (!nestedName || nestedName.value === ';') {
                return undefined;
            }
            const nestedHeader = findMemberHeader(text, nestedName.end);
            if (!nestedHeader) {
                return undefined;
            }
            if (nestedHeader.bodyStart !== undefined) {
                const nestedEnd = findStructuralMemberEnd(text, nestedHeader.bodyStart);
                if (nestedEnd === undefined) {
                    return undefined;
                }
                position = nestedEnd;
            } else {
                position = nestedHeader.end;
            }
            continue;
        }

        if (value === 'BEGIN') {
            return findExecutableBlockEnd(text, token.end);
        }
        position = token.end;
    }

    return undefined;
}

function findExecutableBlockEnd(text: string, start: number): number | undefined {
    let depth = 1;
    let position = start;

    while (position < text.length) {
        const token = nextToken(text, position);
        if (!token) {
            return undefined;
        }
        const value = token.value.toUpperCase();

        if (value === 'BEGIN') {
            depth++;
        } else if (value === 'END') {
            const afterEnd = nextToken(text, token.end);
            const qualifier = afterEnd?.value.toUpperCase();
            if (qualifier === 'IF' || qualifier === 'LOOP' || qualifier === 'CASE') {
                position = afterEnd?.end ?? token.end;
                continue;
            }

            depth--;
            if (depth === 0) {
                let terminator = afterEnd;
                while (terminator && terminator.value !== ';') {
                    terminator = nextToken(text, terminator.end);
                }
                return terminator?.end;
            }
        }
        position = token.end;
    }

    return undefined;
}

function nextToken(text: string, start: number): { value: string; end: number } | undefined {
    const tokenPattern = /[A-Za-z][\w$#]*|;/g;
    tokenPattern.lastIndex = start;
    const match = tokenPattern.exec(text);
    return match ? { value: match[0], end: tokenPattern.lastIndex } : undefined;
}

/** Return declarations or implementations belonging to the opposite program-unit side. */
export function findCounterparts(
    origin: ProgramUnitSymbol,
    candidates: readonly ProgramUnitSymbol[]
): ProgramUnitSymbol[] {
    const isMember = origin.kind === 'procedure' || origin.kind === 'function';
    const sameMember = candidates.filter(candidate =>
        candidate !== origin &&
        candidate.kind === origin.kind &&
        candidate.signatureComplete &&
        candidate.programUnitKind === origin.programUnitKind &&
        candidate.programUnitName.toLowerCase() === origin.programUnitName.toLowerCase() &&
        candidate.name.toLowerCase() === origin.name.toLowerCase() &&
        candidate.modifiers.join(' ') === origin.modifiers.join(' ')
    );

    if (isMember && origin.side === 'body' && origin.isImplementation === false) {
        const localImplementations = sameMember.filter(candidate =>
            candidate.uri === origin.uri &&
            candidate.side === 'body' &&
            candidate.isImplementation === true
        );
        const exact = origin.signatureComplete
            ? localImplementations.filter(candidate => candidate.signature === origin.signature)
            : [];
        if (exact.length > 0 || (origin.signatureComplete && origin.signature === '')) {
            return exact;
        }
        if (!origin.signatureComplete) {
            return localImplementations;
        }
        const sameArity = localImplementations.filter(
            candidate => candidate.parameterCount === origin.parameterCount
        );
        if (sameArity.length === 1) {
            return sameArity;
        }
        return localImplementations.length > 1 ? localImplementations : [];
    }

    const oppositeSide: ProgramUnitSide = origin.side === 'specification' ? 'body' : 'specification';
    const matchingSymbols = sameMember.filter(candidate =>
        candidate.side === oppositeSide &&
        (!isMember || candidate.isImplementation !== origin.isImplementation)
    );
    const exact = origin.signatureComplete
        ? matchingSymbols.filter(candidate => candidate.signature === origin.signature)
        : [];
    if (exact.length > 0) {
        return exact;
    }

    const fallbackSymbols = matchingSymbols.filter(candidate =>
        origin.side !== 'specification' ||
        !sameMember.some(local =>
            local.uri === candidate.uri &&
            local.side === 'body' &&
            local.isImplementation === false &&
            local.signature === candidate.signature
        )
    );
    if (!origin.signatureComplete) {
        return fallbackSymbols;
    }

    if (isMember && origin.side === 'body' && origin.isImplementation === true) {
        const localDeclarations = sameMember.filter(candidate =>
            candidate.uri === origin.uri &&
            candidate.side === 'body' &&
            candidate.isImplementation === false
        );
        const exactLocal = localDeclarations.filter(candidate => candidate.signature === origin.signature);
        if (exactLocal.length > 0) {
            return exactLocal;
        }
        if (origin.signature === '') {
            return [];
        }
        const sameArity = localDeclarations.filter(
            candidate => candidate.parameterCount === origin.parameterCount
        );
        if (sameArity.length === 1) {
            return sameArity;
        }
        return localDeclarations.length > 1 ? localDeclarations : [];
    }

    if (origin.signature === '') {
        return [];
    }
    const sameArity = fallbackSymbols.filter(candidate => candidate.parameterCount === origin.parameterCount);
    if (sameArity.length === 1) {
        return sameArity;
    }
    return fallbackSymbols.length > 1 ? fallbackSymbols : [];
}

/** Apply VS Code's definition/declaration/implementation direction to a program-unit symbol. */
export function findNavigationTargets(
    origin: ProgramUnitSymbol,
    candidates: readonly ProgramUnitSymbol[],
    navigation: ProgramUnitNavigationKind
): ProgramUnitSymbol[] {
    if (navigation === 'declaration' &&
        (origin.side !== 'body' || origin.isImplementation === false)) {
        return [];
    }
    if (navigation === 'implementation' && origin.side !== 'specification') {
        if (origin.isImplementation !== false) {
            return [];
        }
    }
    return findCounterparts(origin, candidates);
}

/** Find a program-unit header or direct member whose name contains the cursor. */
export function findSymbolAt(
    symbols: readonly ProgramUnitSymbol[],
    line: number,
    column: number
): ProgramUnitSymbol | undefined {
    return symbols.find(symbol =>
        symbol.line === line &&
        column >= symbol.column &&
        column < symbol.column + symbol.name.length
    );
}

function findProgramUnitEnd(text: string, start: number, programUnitName: string): number {
    const remainder = text.slice(start);
    const slash = /^[ \t]*\/[ \t]*(?=\r?$)/m.exec(remainder);
    const boundary = slash?.index ?? remainder.length;
    const programUnitText = remainder.slice(0, boundary);
    const escapedName = programUnitName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const endPattern = new RegExp(`\\bEND\\s+${escapedName}\\s*;`, 'ig');
    const namedEnds = [...programUnitText.matchAll(endPattern)];
    const namedEnd = namedEnds[namedEnds.length - 1];
    if (namedEnd) {
        return start + namedEnd.index;
    }

    const unnamedEnds = [...programUnitText.matchAll(/\bEND\s*;/gi)];
    const unnamedEnd = unnamedEnds[unnamedEnds.length - 1];
    return unnamedEnd ? start + unnamedEnd.index : start + boundary;
}

function offsetToPosition(text: string, offset: number): { line: number; column: number } {
    const before = text.slice(0, offset);
    const line = (before.match(/\n/g) || []).length;
    const lastNewline = before.lastIndexOf('\n');
    return { line, column: offset - lastNewline - 1 };
}

function maskCommentsAndStrings(text: string): string {
    let result = '';
    let state: 'code' | 'line-comment' | 'block-comment' | 'string' = 'code';

    for (let index = 0; index < text.length; index++) {
        const char = text[index];
        const next = text[index + 1];

        if (state === 'code' && char === '-' && next === '-') {
            result += '  ';
            index++;
            state = 'line-comment';
        } else if (state === 'code' && char === '/' && next === '*') {
            result += '  ';
            index++;
            state = 'block-comment';
        } else if (state === 'code' && char === "'") {
            result += ' ';
            state = 'string';
        } else if (state === 'line-comment' && (char === '\n' || char === '\r')) {
            result += char;
            state = 'code';
        } else if (state === 'block-comment' && char === '*' && next === '/') {
            result += '  ';
            index++;
            state = 'code';
        } else if (state === 'string' && char === "'" && next === "'") {
            result += '  ';
            index++;
        } else if (state === 'string' && char === "'") {
            result += ' ';
            state = 'code';
        } else if (state === 'code') {
            result += char;
        } else {
            result += char === '\n' || char === '\r' ? char : ' ';
        }
    }

    return result;
}
