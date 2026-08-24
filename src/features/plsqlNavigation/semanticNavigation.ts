export interface SemanticDocument {
    uri: string;
    text: string;
}

export type ProgramUnitSide = 'specification' | 'body';
export type ProgramUnitKind = 'package' | 'type';
export type ProgramUnitModifier = 'constructor' | 'member' | 'static' | 'map' | 'order' | 'overriding';

export interface ObjectTypeAttribute {
    name: string;
    typeName: string;
}

export interface ProgramUnitSymbol {
    uri: string;
    programUnitName: string;
    programUnitKind: ProgramUnitKind;
    name: string;
    kind: 'package' | 'type' | 'procedure' | 'function';
    modifiers: ProgramUnitModifier[];
    signature: string;
    parameterCount: number;
    requiredParameterCount: number;
    parameterNames: string[];
    requiredParameterNames: string[];
    signatureComplete: boolean;
    baseTypeName?: string;
    collectionElementTypeName?: string;
    objectAttributes?: ObjectTypeAttribute[];
    isImplementation?: boolean;
    side: ProgramUnitSide;
    line: number;
    column: number;
}

export type ProgramUnitNavigationKind = 'definition' | 'declaration' | 'implementation';

interface ObjectMethodCall {
    name: string;
    nameOffset: number;
    receiverName: string;
    receiverIndexed: boolean;
    argumentCount: number;
    namedArguments: string[];
}

interface EnclosingProgramUnit {
    name: string;
    kind: ProgramUnitKind;
    side: ProgramUnitSide;
    start: number;
    end: number;
}

const PROGRAM_UNIT_PATTERN = String.raw`\b(PACKAGE|TYPE)\s+(BODY\s+)?(?:(?:[A-Za-z][\w$#]*)\s*\.\s*)?([A-Za-z][\w$#]*)\s+(?:FORCE\s+)?(?:(?:AUTHID\s+(?:CURRENT_USER|DEFINER))\s+)?(IS|AS|UNDER)\b`;

/** Extract the program-unit symbols needed for spec/body navigation. */
export function extractProgramUnitSymbols(document: SemanticDocument): ProgramUnitSymbol[] {
    const source = maskCommentsAndStrings(document.text);
    const symbols: ProgramUnitSymbol[] = [];
    const programUnitPattern = new RegExp(PROGRAM_UNIT_PATTERN, 'gi');

    for (const match of source.matchAll(programUnitPattern)) {
        const isTypeSpecification = match[1].toUpperCase() === 'TYPE' && !match[2];
        const isObjectType = !isTypeSpecification ||
            match[4].toUpperCase() === 'UNDER' ||
            /^\s*OBJECT\b/i.test(source.slice(match.index + match[0].length));
        if (isTypeSpecification && !isObjectType && !hasCreatePrefix(source, match.index)) {
            continue;
        }
        const programUnitName = match[3];
        const nameOffset = match.index + match[0].toLowerCase().lastIndexOf(programUnitName.toLowerCase());
        const position = offsetToPosition(source, nameOffset);
        const programUnitStart = match.index + match[0].length;
        const programUnitEnd = findProgramUnitEnd(source, programUnitStart, programUnitName);
        const programUnitText = source.slice(programUnitStart, programUnitEnd);
        const typeDetails = match[1].toUpperCase() === 'TYPE' && !match[2]
            ? extractTypeDetails(programUnitText, match[4])
            : {};

        symbols.push({
            uri: document.uri,
            programUnitName,
            programUnitKind: match[1].toLowerCase() as ProgramUnitKind,
            name: programUnitName,
            kind: match[1].toLowerCase() as 'package' | 'type',
            modifiers: [],
            signature: '',
            parameterCount: 0,
            requiredParameterCount: 0,
            parameterNames: [],
            requiredParameterNames: [],
            signatureComplete: true,
            ...typeDetails,
            side: match[2] ? 'body' : 'specification',
            line: position.line,
            column: position.column
        });

        // Schema collection types have a specification header but no members
        // or body. Keeping the header in the shared index makes references to
        // CREATE TYPE ... AS TABLE/VARRAY navigable without treating a
        // package-local TYPE declaration as a program unit.
        if (isTypeSpecification && !isObjectType) {
            continue;
        }

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
                requiredParameterCount: parameters.requiredCount,
                parameterNames: parameters.names,
                requiredParameterNames: parameters.requiredNames,
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

function extractTypeDetails(
    programUnitText: string,
    introducer: string
): Partial<Pick<ProgramUnitSymbol, 'baseTypeName' | 'collectionElementTypeName' | 'objectAttributes'>> {
    if (introducer.toUpperCase() === 'UNDER') {
        return {
            baseTypeName: firstQualifiedIdentifier(programUnitText),
            objectAttributes: extractObjectTypeAttributes(programUnitText)
        };
    }

    const collection = /^\s*(?:TABLE\s+OF|VARRAY\s*\([^)]*\)\s+OF)\s+((?:[A-Za-z][\w$#]*\s*\.\s*)?[A-Za-z][\w$#]*)/i
        .exec(programUnitText);
    if (collection) {
        return { collectionElementTypeName: unqualifiedName(collection[1]) };
    }

    return { objectAttributes: extractObjectTypeAttributes(programUnitText) };
}

function extractObjectTypeAttributes(programUnitText: string): ObjectTypeAttribute[] {
    const object = /\bOBJECT\s*\(/i.exec(programUnitText);
    if (!object) {
        return [];
    }
    const opening = object.index + object[0].lastIndexOf('(');
    const closing = findMatchingParenthesis(programUnitText, opening);
    if (closing === undefined) {
        return [];
    }

    const methodPrefixes = new Set([
        'CONSTRUCTOR', 'MEMBER', 'STATIC', 'MAP', 'ORDER', 'OVERRIDING', 'FINAL', 'NOT'
    ]);
    return splitParameters(programUnitText.slice(opening + 1, closing))
        .map(entry => entry.trim())
        .filter(entry => entry.length > 0)
        .flatMap(entry => {
            const attribute = /^([A-Za-z][\w$#]*)\s+((?:[A-Za-z][\w$#]*\s*\.\s*)?[A-Za-z][\w$#]*)\b/i.exec(entry);
            if (!attribute || methodPrefixes.has(attribute[1].toUpperCase())) {
                return [];
            }
            return [{ name: attribute[1], typeName: unqualifiedName(attribute[2]) }];
        });
}

function firstQualifiedIdentifier(text: string): string | undefined {
    const match = /^\s*((?:[A-Za-z][\w$#]*\s*\.\s*)?[A-Za-z][\w$#]*)/i.exec(text);
    return match ? unqualifiedName(match[1]) : undefined;
}

function unqualifiedName(name: string): string {
    return name.replace(/\s/g, '').split('.').at(-1) ?? name;
}

/** Find a schema type name when the cursor is in a PL/SQL type position. */
export function findSchemaTypeReferenceAt(
    document: SemanticDocument,
    line: number,
    column: number
): string | undefined {
    const source = maskCommentsAndStrings(document.text);
    const lineStart = positionToOffset(source, line);
    if (lineStart === undefined) {
        return undefined;
    }
    const lineEnd = source.indexOf('\n', lineStart);
    const currentLine = source.slice(lineStart, lineEnd === -1 ? source.length : lineEnd);
    const identifierPattern = /[A-Za-z][\w$#]*/g;
    const identifier = [...currentLine.matchAll(identifierPattern)].find(match =>
        column >= match.index && column < match.index + match[0].length
    );
    if (!identifier) {
        return undefined;
    }

    const start = lineStart + identifier.index;
    const end = start + identifier[0].length;
    const before = source.slice(0, start);
    const after = source.slice(end);
    const qualifier = String.raw`(?:[A-Za-z][\w$#]*\s*\.\s*)?`;

    if (isTreatTypePosition(source, start)) {
        return identifier[0];
    }

    if (new RegExp(String.raw`\bUNDER\s+${qualifier}$`, 'i').test(before) ||
        new RegExp(String.raw`\bTABLE\s+OF\s+${qualifier}$`, 'i').test(before) ||
        new RegExp(String.raw`\bVARRAY\s*\([^)]*\)\s+OF\s+${qualifier}$`, 'i').test(before)) {
        return identifier[0];
    }

    if (new RegExp(String.raw`\bRETURN\s+${qualifier}$`, 'i').test(before)) {
        const functionMatches = [...before.matchAll(/\bFUNCTION\b/gi)];
        const lastFunction = functionMatches.at(-1);
        if (lastFunction) {
            const functionHeader = before.slice(lastFunction.index);
            if (!/\b(?:IS|AS|BEGIN)\b/i.test(functionHeader)) {
                return identifier[0];
            }
        }
    }

    const declarationSuffix = /^\s*(?:\([^;]*?\))?\s*(?:NOT\s+NULL\s*)?(?::=|DEFAULT\b|[;,)])/i;
    if (!declarationSuffix.test(after)) {
        return undefined;
    }

    const parameterPrefix = new RegExp(
        String.raw`(?:^|[,(])\s*[A-Za-z][\w$#]*\s+` +
        String.raw`(?:(?:IN\s+OUT|IN|OUT)\s+)?(?:NOCOPY\s+)?${qualifier}$`,
        'i'
    );
    const declarationPrefix = new RegExp(
        String.raw`(?:^|[;\n,(])\s*[A-Za-z][\w$#]*\s+(?:CONSTANT\s+)?${qualifier}$`,
        'i'
    );
    return parameterPrefix.test(before) || declarationPrefix.test(before)
        ? identifier[0]
        : undefined;
}

function isTreatTypePosition(text: string, typeOffset: number): boolean {
    const beforeType = text.slice(0, typeOffset);
    const typePrefix = /\bAS\s+(?:REF\s+)?(?:[A-Za-z][\w$#]*\s*\.\s*)?$/i.exec(beforeType);
    if (!typePrefix) {
        return false;
    }

    const asOffset = typePrefix.index + typePrefix[0].search(/\bAS\b/i);
    let depth = 0;
    for (let index = asOffset - 1; index >= 0; index--) {
        if (text[index] === ')') {
            depth++;
        } else if (text[index] === '(') {
            if (depth > 0) {
                depth--;
                continue;
            }
            const call = /([A-Za-z][\w$#]*)\s*$/.exec(text.slice(0, index));
            return call?.[1].toUpperCase() === 'TREAT';
        }
    }
    return false;
}

/** Return every repository specification/body header for a schema type name. */
export function findSchemaTypeDefinitions(
    typeName: string,
    symbols: readonly ProgramUnitSymbol[]
): ProgramUnitSymbol[] {
    return symbols.filter(symbol =>
        symbol.programUnitKind === 'type' &&
        symbol.kind === 'type' &&
        symbol.name.toLowerCase() === typeName.toLowerCase()
    );
}

/** Resolve a call on an Oracle object instance to repository member declarations and implementations. */
export function resolveObjectMethodCall(
    document: SemanticDocument,
    line: number,
    column: number,
    currentSymbols: readonly ProgramUnitSymbol[],
    lookupSymbols: (name: string) => readonly ProgramUnitSymbol[]
): ProgramUnitSymbol[] {
    const source = maskCommentsAndStrings(document.text);
    const call = findObjectMethodCallAt(source, line, column);
    if (!call) {
        return [];
    }
    const programUnit = findEnclosingProgramUnit(source, call.nameOffset);
    if (!programUnit) {
        return [];
    }

    const lookup = (name: string) => uniqueSymbols([
        ...currentSymbols.filter(symbol =>
            symbol.name.toLowerCase() === name.toLowerCase()
        ),
        ...lookupSymbols(name)
    ]);
    let receiverType = call.receiverName.toLowerCase() === 'self'
        ? programUnit.kind === 'type' ? programUnit.name : undefined
        : findDeclaredReceiverType(source, call, programUnit, currentSymbols, lookup);
    if (!receiverType) {
        return [];
    }

    if (call.receiverIndexed) {
        receiverType = findCollectionElementType(receiverType, lookup);
        if (!receiverType) {
            return [];
        }
    }

    const visited = new Set<string>();
    let declaringType: string | undefined = receiverType;
    while (declaringType && !visited.has(declaringType.toLowerCase())) {
        visited.add(declaringType.toLowerCase());
        const targets = lookup(call.name).filter(symbol =>
            symbol.programUnitKind === 'type' &&
            (symbol.kind === 'function' || symbol.kind === 'procedure') &&
            symbol.programUnitName.toLowerCase() === declaringType?.toLowerCase() &&
            !symbol.modifiers.includes('constructor') &&
            !symbol.modifiers.includes('static') &&
            isCompatibleCall(call, symbol)
        );
        if (targets.length > 0) {
            return uniqueSymbols(targets);
        }
        declaringType = findBaseType(declaringType, lookup);
    }
    return [];
}

function findObjectMethodCallAt(
    source: string,
    line: number,
    column: number
): ObjectMethodCall | undefined {
    const lineStart = positionToOffset(source, line);
    if (lineStart === undefined) {
        return undefined;
    }
    const lineEnd = source.indexOf('\n', lineStart);
    const currentLine = source.slice(lineStart, lineEnd === -1 ? source.length : lineEnd);
    const identifier = [...currentLine.matchAll(/[A-Za-z][\w$#]*/g)].find(match =>
        column >= match.index && column < match.index + match[0].length
    );
    if (!identifier) {
        return undefined;
    }

    const nameOffset = lineStart + identifier.index;
    let opening = nameOffset + identifier[0].length;
    while (/\s/.test(source[opening] || '')) {
        opening++;
    }
    if (source[opening] !== '(') {
        return undefined;
    }
    const closing = findMatchingParenthesis(source, opening);
    if (closing === undefined) {
        return undefined;
    }

    let dot = nameOffset - 1;
    while (/\s/.test(source[dot] || '')) {
        dot--;
    }
    if (source[dot] !== '.') {
        return undefined;
    }
    let receiverEnd = dot - 1;
    while (/\s/.test(source[receiverEnd] || '')) {
        receiverEnd--;
    }

    let receiverIndexed = false;
    if (source[receiverEnd] === ')') {
        const receiverOpening = findMatchingParenthesisBackward(source, receiverEnd);
        if (receiverOpening === undefined) {
            return undefined;
        }
        receiverEnd = receiverOpening - 1;
        receiverIndexed = true;
        while (/\s/.test(source[receiverEnd] || '')) {
            receiverEnd--;
        }
    }
    const receiver = /[A-Za-z][\w$#]*$/.exec(source.slice(0, receiverEnd + 1));
    if (!receiver) {
        return undefined;
    }

    const argumentsList = splitParameters(source.slice(opening + 1, closing));
    return {
        name: identifier[0],
        nameOffset,
        receiverName: receiver[0],
        receiverIndexed,
        argumentCount: argumentsList.length,
        namedArguments: argumentsList.flatMap(argument => {
            const named = /^\s*([A-Za-z][\w$#]*)\s*=>/i.exec(argument);
            return named ? [named[1]] : [];
        })
    };
}

function findDeclaredReceiverType(
    source: string,
    call: ObjectMethodCall,
    programUnit: EnclosingProgramUnit,
    currentSymbols: readonly ProgramUnitSymbol[],
    lookup: (name: string) => readonly ProgramUnitSymbol[]
): string | undefined {
    const scopeStart = currentSymbols
        .filter(symbol =>
            symbol.programUnitName.toLowerCase() === programUnit.name.toLowerCase() &&
            symbol.side === programUnit.side &&
            (symbol.kind === 'function' || symbol.kind === 'procedure')
        )
        .map(symbol => positionToOffset(source, symbol.line, symbol.column))
        .filter((offset): offset is number => offset !== undefined && offset <= call.nameOffset)
        .sort((left, right) => right - left)[0] ?? programUnit.start;
    const escapedReceiver = call.receiverName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const declarationPattern = new RegExp(
        String.raw`\b${escapedReceiver}\b\s+` +
        String.raw`(?:CONSTANT\s+)?(?:(?:IN\s+OUT|IN|OUT)\s+)?(?:NOCOPY\s+)?` +
        String.raw`((?:[A-Za-z][\w$#]*\s*\.\s*)?[A-Za-z][\w$#]*)\b`,
        'gi'
    );
    const declarations = [...source.slice(scopeStart, call.nameOffset).matchAll(declarationPattern)];
    const localType = declarations.at(-1)?.[1];
    if (localType) {
        return unqualifiedName(localType);
    }

    const attributeTypes = lookup(programUnit.name)
        .filter(symbol =>
            symbol.programUnitKind === 'type' &&
            symbol.kind === 'type' &&
            symbol.side === 'specification'
        )
        .flatMap(symbol => symbol.objectAttributes ?? [])
        .filter(attribute => attribute.name.toLowerCase() === call.receiverName.toLowerCase())
        .map(attribute => attribute.typeName.toLowerCase());
    const uniqueTypes = [...new Set(attributeTypes)];
    return uniqueTypes.length === 1 ? uniqueTypes[0] : undefined;
}

function findCollectionElementType(
    collectionType: string,
    lookup: (name: string) => readonly ProgramUnitSymbol[]
): string | undefined {
    const elementTypes = lookup(collectionType)
        .filter(symbol =>
            symbol.programUnitKind === 'type' &&
            symbol.kind === 'type' &&
            symbol.side === 'specification' &&
            symbol.collectionElementTypeName
        )
        .map(symbol => symbol.collectionElementTypeName?.toLowerCase())
        .filter((name): name is string => name !== undefined);
    const uniqueTypes = [...new Set(elementTypes)];
    return uniqueTypes.length === 1 ? uniqueTypes[0] : undefined;
}

function findBaseType(
    objectType: string,
    lookup: (name: string) => readonly ProgramUnitSymbol[]
): string | undefined {
    const baseTypes = lookup(objectType)
        .filter(symbol =>
            symbol.programUnitKind === 'type' &&
            symbol.kind === 'type' &&
            symbol.side === 'specification' &&
            symbol.baseTypeName
        )
        .map(symbol => symbol.baseTypeName?.toLowerCase())
        .filter((name): name is string => name !== undefined);
    const uniqueTypes = [...new Set(baseTypes)];
    return uniqueTypes.length === 1 ? uniqueTypes[0] : undefined;
}

function isCompatibleCall(call: ObjectMethodCall, symbol: ProgramUnitSymbol): boolean {
    if (!symbol.signatureComplete) {
        return true;
    }
    if (call.argumentCount < symbol.requiredParameterCount ||
        call.argumentCount > symbol.parameterCount) {
        return false;
    }
    const parameterNames = new Set(symbol.parameterNames.map(name => name.toLowerCase()));
    return call.namedArguments.every(name => parameterNames.has(name.toLowerCase()));
}

function findEnclosingProgramUnit(source: string, offset: number): EnclosingProgramUnit | undefined {
    const pattern = new RegExp(PROGRAM_UNIT_PATTERN, 'gi');
    for (const match of source.matchAll(pattern)) {
        const start = match.index + match[0].length;
        const end = findProgramUnitEnd(source, start, match[3]);
        if (offset >= match.index && offset <= end) {
            return {
                name: match[3],
                kind: match[1].toLowerCase() as ProgramUnitKind,
                side: match[2] ? 'body' : 'specification',
                start,
                end
            };
        }
    }
    return undefined;
}

function uniqueSymbols(symbols: readonly ProgramUnitSymbol[]): ProgramUnitSymbol[] {
    return [...new Map(symbols.map(symbol => [
        `${symbol.uri}:${symbol.line}:${symbol.column}`,
        symbol
    ])).values()];
}

function hasCreatePrefix(text: string, typeOffset: number): boolean {
    return /\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:EDITIONABLE\s+|NONEDITIONABLE\s+)?$/i
        .test(text.slice(0, typeOffset));
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
): {
    signature: string;
    count: number;
    requiredCount: number;
    names: string[];
    requiredNames: string[];
    complete: boolean;
} {
    let opening = start;
    while (/\s/.test(text[opening] || '')) {
        opening++;
    }
    if (text[opening] !== '(') {
        return {
            signature: '', count: 0, requiredCount: 0,
            names: [], requiredNames: [], complete: true
        };
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
        return {
            signature: '', count: 0, requiredCount: 0,
            names: [], requiredNames: [], complete: false
        };
    }

    const parameters = splitParameters(text.slice(opening + 1, closing - 1));
    const requiredParameters = parameters.filter(
        parameter => !/(?:\bDEFAULT\b|:=)/i.test(parameter)
    );
    const parameterName = (parameter: string): string =>
        /^\s*([A-Za-z][\w$#]*)/.exec(parameter)?.[1] ?? '';
    return {
        signature: parameters.map(normalizeParameter).join(','),
        count: parameters.length,
        requiredCount: requiredParameters.length,
        names: parameters.map(parameterName),
        requiredNames: requiredParameters.map(parameterName),
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

function findMatchingParenthesis(text: string, opening: number): number | undefined {
    let depth = 0;
    for (let index = opening; index < text.length; index++) {
        if (text[index] === '(') {
            depth++;
        } else if (text[index] === ')') {
            depth--;
            if (depth === 0) {
                return index;
            }
        }
    }
    return undefined;
}

function findMatchingParenthesisBackward(text: string, closing: number): number | undefined {
    let depth = 0;
    for (let index = closing; index >= 0; index--) {
        if (text[index] === ')') {
            depth++;
        } else if (text[index] === '(') {
            depth--;
            if (depth === 0) {
                return index;
            }
        }
    }
    return undefined;
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

function positionToOffset(text: string, line: number, column = 0): number | undefined {
    if (line < 0) {
        return undefined;
    }
    let offset = 0;
    for (let currentLine = 0; currentLine < line; currentLine++) {
        const newline = text.indexOf('\n', offset);
        if (newline === -1) {
            return undefined;
        }
        offset = newline + 1;
    }
    return offset + column;
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
