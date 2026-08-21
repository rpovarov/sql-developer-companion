export interface SemanticDocument {
    uri: string;
    text: string;
}

export type PackageSide = 'specification' | 'body';

export interface PackageSymbol {
    uri: string;
    packageName: string;
    name: string;
    kind: 'package' | 'procedure' | 'function';
    side: PackageSide;
    line: number;
    column: number;
}

export type PackageNavigationKind = 'definition' | 'declaration' | 'implementation';

/** Extract the package symbols needed for spec/body navigation. */
export function extractPackageSymbols(document: SemanticDocument): PackageSymbol[] {
    const source = maskCommentsAndStrings(document.text);
    const symbols: PackageSymbol[] = [];
    const packagePattern = /\bPACKAGE\s+(BODY\s+)?(?:(?:[A-Za-z][\w$#]*)\s*\.\s*)?([A-Za-z][\w$#]*)\s+(?:(?:AUTHID\s+(?:CURRENT_USER|DEFINER))\s+)?(?:IS|AS)\b/gi;

    for (const match of source.matchAll(packagePattern)) {
        const packageName = match[2];
        const nameOffset = match.index + match[0].toLowerCase().lastIndexOf(packageName.toLowerCase());
        const position = offsetToPosition(source, nameOffset);

        symbols.push({
            uri: document.uri,
            packageName,
            name: packageName,
            kind: 'package',
            side: match[1] ? 'body' : 'specification',
            line: position.line,
            column: position.column
        });

        const packageEnd = findPackageEnd(source, match.index + match[0].length, packageName);
        const packageText = source.slice(match.index + match[0].length, packageEnd);
        const memberPattern = /^[ \t]*(PROCEDURE|FUNCTION)\s+([A-Za-z][\w$#]*)\b/gim;
        let skipMembersBefore = 0;

        for (const memberMatch of packageText.matchAll(memberPattern)) {
            if (memberMatch.index < skipMembersBefore) {
                continue;
            }

            const memberName = memberMatch[2];
            const memberOffset = match.index + match[0].length + memberMatch.index +
                memberMatch[0].toLowerCase().lastIndexOf(memberName.toLowerCase());
            const memberPosition = offsetToPosition(source, memberOffset);

            symbols.push({
                uri: document.uri,
                packageName,
                name: memberName,
                kind: memberMatch[1].toLowerCase() as 'procedure' | 'function',
                side: match[1] ? 'body' : 'specification',
                line: memberPosition.line,
                column: memberPosition.column
            });

            if (match[1]) {
                const header = findMemberHeader(packageText, memberMatch.index + memberMatch[0].length);
                const memberEnd = header?.bodyStart === undefined
                    ? undefined
                    : findMemberEnd(packageText, header.bodyStart, memberName);
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
    const terminator = /\b(?:IS|AS)\b|;/gi;
    terminator.lastIndex = start;
    const match = terminator.exec(text);
    if (!match) {
        return undefined;
    }
    return match[0] === ';'
        ? { end: terminator.lastIndex }
        : { bodyStart: terminator.lastIndex, end: terminator.lastIndex };
}

function findMemberEnd(text: string, start: number, memberName: string): number | undefined {
    const escapedName = memberName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const endPattern = new RegExp(`\\bEND\\s+${escapedName}\\s*;`, 'ig');
    endPattern.lastIndex = start;
    const namedEnd = endPattern.exec(text);
    return namedEnd ? endPattern.lastIndex : findStructuralMemberEnd(text, start);
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

/** Return declarations or implementations belonging to the opposite package side. */
export function findPackageCounterparts(
    origin: PackageSymbol,
    candidates: readonly PackageSymbol[]
): PackageSymbol[] {
    const oppositeSide: PackageSide = origin.side === 'specification' ? 'body' : 'specification';
    return candidates.filter(candidate =>
        candidate.side === oppositeSide &&
        candidate.kind === origin.kind &&
        candidate.packageName.toLowerCase() === origin.packageName.toLowerCase() &&
        candidate.name.toLowerCase() === origin.name.toLowerCase()
    );
}

/** Apply VS Code's definition/declaration/implementation direction to a package symbol. */
export function findPackageNavigationTargets(
    origin: PackageSymbol,
    candidates: readonly PackageSymbol[],
    navigation: PackageNavigationKind
): PackageSymbol[] {
    if (navigation === 'declaration' && origin.side !== 'body') {
        return [];
    }
    if (navigation === 'implementation' && origin.side !== 'specification') {
        return [];
    }
    return findPackageCounterparts(origin, candidates);
}

/** Find a package header or direct member whose name contains the cursor. */
export function findPackageSymbolAt(
    symbols: readonly PackageSymbol[],
    line: number,
    column: number
): PackageSymbol | undefined {
    return symbols.find(symbol =>
        symbol.line === line &&
        column >= symbol.column &&
        column < symbol.column + symbol.name.length
    );
}

function findPackageEnd(text: string, start: number, packageName: string): number {
    const remainder = text.slice(start);
    const slash = /^[ \t]*\/[ \t]*(?=\r?$)/m.exec(remainder);
    const nextPackage = /^[ \t]*(?:CREATE\s+(?:OR\s+REPLACE\s+)?(?:(?:NON)?EDITIONABLE\s+)?)?PACKAGE\s+(?:BODY\s+)?[A-Za-z]/im.exec(remainder);
    const boundary = Math.min(
        slash?.index ?? remainder.length,
        nextPackage?.index ?? remainder.length
    );
    const packageText = remainder.slice(0, boundary);
    const escapedName = packageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const endPattern = new RegExp(`\\bEND\\s+${escapedName}\\s*;`, 'i');
    const namedEnd = endPattern.exec(packageText);
    if (namedEnd) {
        return start + namedEnd.index;
    }

    const unnamedEnds = [...packageText.matchAll(/\bEND\s*;/gi)];
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
