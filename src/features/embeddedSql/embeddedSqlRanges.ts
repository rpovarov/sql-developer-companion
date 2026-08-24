export interface EmbeddedSqlRange {
    start: number;
    end: number;
}

export interface EmbeddedSqlBackground {
    wholeLines: number[];
    inlineRanges: EmbeddedSqlRange[];
}

interface Candidate {
    openingQuote: number;
    delimiter: string;
}

const assignmentPattern = /\b((?=[A-Z_])\w*(?:sql|query|statement)\w*|stmt|ddl|dml)[^\S\r\n]*=[^\S\r\n]*(?:[ru]{0,2})("""|''')/gi;
const fStringAssignmentPattern = /\b((?=[A-Z_])\w*(?:sql|query|statement)\w*|stmt|ddl|dml)[^\S\r\n]*=[^\S\r\n]*(?:fr|rf|f)("""|''')/gi;
const executionPattern = /\b[A-Z_]\w*[^\S\r\n]*\.[^\S\r\n]*(?:execute|executemany)[^\S\r\n]*\([^\S\r\n]*(?:\r?\n[^\S\r\n]*)?(?:[ru]{0,2})("""|''')/gi;
const multilineExecutionPattern = /\b[A-Z_]\w*[^\S\r\n]*\.[^\S\r\n]*(?:execute|executemany)[^\S\r\n]*\([^\S\r\n]*\r?\n/gi;
const parenthesizedAssignmentPattern = /\b((?=[A-Z_])\w*(?:sql|query|statement)\w*|stmt|ddl|dml)[^\S\r\n]*=[^\S\r\n]*\(/gi;

function collectCandidates(text: string, pattern: RegExp): Candidate[] {
    const candidates: Candidate[] = [];

    for (const match of text.matchAll(pattern)) {
        const matchStart = match.index;
        const delimiter = match[match.length - 1];
        const lineStart = text.lastIndexOf('\n', matchStart - 1) + 1;

        // TextMate's injection selector excludes comments. Mirror the common
        // line-comment case without introducing a Python parser.
        if (text.slice(lineStart, matchStart).includes('#')) {
            continue;
        }

        candidates.push({
            openingQuote: matchStart + match[0].lastIndexOf(delimiter),
            delimiter,
        });
    }

    return candidates;
}

function findStringEnd(text: string, contentStart: number, delimiter: string): number {
    for (let cursor = contentStart; cursor < text.length;) {
        if (text.startsWith(delimiter, cursor)) {
            return cursor;
        }
        if (text[cursor] === '\\') {
            cursor += 2;
            continue;
        }
        if (delimiter.length === 1 && (text[cursor] === '\n' || text[cursor] === '\r')) {
            return -1;
        }
        cursor++;
    }
    return -1;
}

function findParenthesizedSqlRanges(text: string): EmbeddedSqlRange[] {
    const ranges: EmbeddedSqlRange[] = [];
    const stringStartPattern = /([rRuUfF]{0,2})("""|'''|"|')/y;
    let coveredUntil = -1;

    for (const match of text.matchAll(parenthesizedAssignmentPattern)) {
        const matchStart = match.index;
        if (matchStart < coveredUntil) {
            continue;
        }

        const lineStart = text.lastIndexOf('\n', matchStart - 1) + 1;
        if (text.slice(lineStart, matchStart).includes('#')) {
            continue;
        }

        let cursor = matchStart + match[0].lastIndexOf('(') + 1;
        let depth = 1;

        while (cursor < text.length && depth > 0) {
            if (text[cursor] === '#') {
                const nextLine = text.indexOf('\n', cursor + 1);
                cursor = nextLine === -1 ? text.length : nextLine + 1;
                continue;
            }

            stringStartPattern.lastIndex = cursor;
            const stringStart = stringStartPattern.exec(text);
            if (stringStart) {
                const prefix = stringStart[1];
                const delimiter = stringStart[2];
                const contentStart = stringStartPattern.lastIndex;
                const contentEnd = findStringEnd(text, contentStart, delimiter);

                if (contentEnd === -1) {
                    cursor++;
                    continue;
                }
                if (!prefix.toLowerCase().includes('f')) {
                    ranges.push({ start: contentStart, end: contentEnd });
                }
                cursor = contentEnd + delimiter.length;
                continue;
            }

            if (text[cursor] === '(') {
                depth++;
            } else if (text[cursor] === ')') {
                depth--;
            }
            cursor++;
        }

        coveredUntil = cursor;
    }

    return ranges;
}

function findExecutedInlineStringRanges(text: string): EmbeddedSqlRange[] {
    const ranges: EmbeddedSqlRange[] = [];
    const stringStartPattern = /([rRuUfF]{0,2})("""|'''|"|')/y;

    for (const match of text.matchAll(multilineExecutionPattern)) {
        const matchStart = match.index;
        const lineStart = text.lastIndexOf('\n', matchStart - 1) + 1;
        if (text.slice(lineStart, matchStart).includes('#')) {
            continue;
        }

        let cursor = matchStart + match[0].length;
        while (cursor < text.length) {
            while (/\s/.test(text[cursor] ?? '')) {
                cursor++;
            }
            if (text[cursor] === '#') {
                const nextLine = text.indexOf('\n', cursor + 1);
                cursor = nextLine === -1 ? text.length : nextLine + 1;
                continue;
            }

            stringStartPattern.lastIndex = cursor;
            const stringStart = stringStartPattern.exec(text);
            if (!stringStart) {
                break;
            }

            const prefix = stringStart[1];
            const delimiter = stringStart[2];
            const contentStart = stringStartPattern.lastIndex;
            const contentEnd = findStringEnd(text, contentStart, delimiter);
            if (contentEnd === -1) {
                break;
            }
            if (delimiter.length === 1) {
                ranges.push({ start: contentStart, end: contentEnd });
            }
            cursor = contentEnd + delimiter.length;
        }
    }

    return ranges;
}

export function findEmbeddedSqlRanges(text: string): EmbeddedSqlRange[] {
    const candidates = [
        ...collectCandidates(text, assignmentPattern),
        ...collectCandidates(text, fStringAssignmentPattern),
        ...collectCandidates(text, executionPattern),
    ].sort((left, right) => left.openingQuote - right.openingQuote);

    const ranges: EmbeddedSqlRange[] = [];
    let coveredUntil = -1;

    for (const candidate of candidates) {
        if (candidate.openingQuote < coveredUntil) {
            continue;
        }

        const contentStart = candidate.openingQuote + candidate.delimiter.length;
        const closingQuote = text.indexOf(candidate.delimiter, contentStart);
        const contentEnd = closingQuote === -1 ? text.length : closingQuote;

        ranges.push({ start: contentStart, end: contentEnd });
        coveredUntil = closingQuote === -1
            ? text.length
            : closingQuote + candidate.delimiter.length;
    }

    return [
        ...ranges,
        ...findParenthesizedSqlRanges(text),
        ...findExecutedInlineStringRanges(text),
    ]
        .sort((left, right) => left.start - right.start);
}

export function buildEmbeddedSqlBackground(text: string): EmbeddedSqlBackground {
    const lineStarts = [0];
    for (let offset = text.indexOf('\n'); offset !== -1; offset = text.indexOf('\n', offset + 1)) {
        lineStarts.push(offset + 1);
    }

    const lineAt = (offset: number): number => {
        let low = 0;
        let high = lineStarts.length - 1;
        while (low <= high) {
            const middle = Math.floor((low + high) / 2);
            if (lineStarts[middle] <= offset) {
                low = middle + 1;
            } else {
                high = middle - 1;
            }
        }
        return Math.max(0, high);
    };

    const lineEnd = (line: number): number =>
        line + 1 < lineStarts.length ? lineStarts[line + 1] - 1 : text.length;

    const wholeLines: number[] = [];
    const inlineRanges: EmbeddedSqlRange[] = [];

    for (const range of findEmbeddedSqlRanges(text)) {
        const startLine = lineAt(range.start);
        const endLine = lineAt(range.end);

        if (startLine === endLine) {
            if (range.start < range.end) {
                inlineRanges.push(range);
            }
            continue;
        }

        if (text.slice(range.start, lineEnd(startLine)).trim().length > 0) {
            inlineRanges.push({ start: range.start, end: lineEnd(startLine) });
        }
        if (text.slice(lineStarts[endLine], range.end).trim().length > 0) {
            inlineRanges.push({ start: lineStarts[endLine], end: range.end });
        }

        for (let line = startLine + 1; line < endLine; line++) {
            wholeLines.push(line);
        }
    }

    return { wholeLines, inlineRanges };
}
