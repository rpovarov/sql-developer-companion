import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { extractProgramUnitSymbols } from '../features/plsqlNavigation/semanticNavigation';

interface BenchmarkDocument {
    uri: string;
    text: string;
}

interface BenchmarkResult {
    name: string;
    files: number;
    bytes: number;
    symbols: number;
    runs: number[];
    medianMs: number;
    p95Ms: number;
    heapDeltaMiB: number;
}

const supportedExtensions = new Set([
    '.pks', '.pkb', '.sql', '.pls', '.plb', '.pck', '.tps', '.tpb',
]);

const datasets: Array<{ name: string; documents: BenchmarkDocument[] }> = [
    { name: 'generated-many-files', documents: generatedManyFiles(1_000) },
    { name: 'generated-large-file', documents: [generatedLargeFile(4_000)] },
];

const externalDirectory = process.argv[2];
if (externalDirectory) {
    datasets.push({
        name: `repository:${path.basename(path.resolve(externalDirectory))}`,
        documents: loadDirectory(externalDirectory),
    });
}

const results = datasets.map(dataset => benchmark(dataset.name, dataset.documents));
console.log(JSON.stringify({
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    iterations: 7,
    warmups: 2,
    results,
}, null, 2));

function benchmark(name: string, documents: BenchmarkDocument[]): BenchmarkResult {
    for (let warmup = 0; warmup < 2; warmup++) {
        parse(documents);
    }

    const heapBefore = process.memoryUsage().heapUsed;
    const runs: number[] = [];
    let symbols = 0;
    for (let iteration = 0; iteration < 7; iteration++) {
        const start = performance.now();
        symbols = parse(documents);
        runs.push(round(performance.now() - start));
    }
    const heapDeltaMiB = (process.memoryUsage().heapUsed - heapBefore) / 1024 / 1024;
    const sorted = [...runs].sort((left, right) => left - right);
    return {
        name,
        files: documents.length,
        bytes: documents.reduce((total, document) => total + Buffer.byteLength(document.text), 0),
        symbols,
        runs,
        medianMs: sorted[Math.floor(sorted.length / 2)],
        p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
        heapDeltaMiB: round(heapDeltaMiB),
    };
}

function parse(documents: readonly BenchmarkDocument[]): number {
    let symbols = 0;
    for (const document of documents) {
        symbols += extractProgramUnitSymbols(document).length;
    }
    return symbols;
}

function generatedManyFiles(count: number): BenchmarkDocument[] {
    return Array.from({ length: count }, (_, index) => ({
        uri: `file:///generated/demo_api_${index}.pks`,
        text: [
            `CREATE OR REPLACE PACKAGE demo_api_${index} AS`,
            '    FUNCTION load_item(p_id NUMBER) RETURN NUMBER;',
            '    PROCEDURE save_item(p_id NUMBER, p_name VARCHAR2 DEFAULT NULL);',
            `END demo_api_${index};`,
            '/',
        ].join('\n'),
    }));
}

function generatedLargeFile(memberCount: number): BenchmarkDocument {
    const members = Array.from({ length: memberCount }, (_, index) =>
        `    FUNCTION item_${index}(p_id NUMBER, p_name VARCHAR2 DEFAULT NULL) RETURN NUMBER;`
    );
    return {
        uri: 'file:///generated/large_api.pks',
        text: [
            'CREATE OR REPLACE PACKAGE large_api AS',
            ...members,
            'END large_api;',
            '/',
        ].join('\n'),
    };
}

function loadDirectory(directory: string): BenchmarkDocument[] {
    const root = path.resolve(directory);
    const pending = [root];
    const files: string[] = [];
    while (pending.length > 0) {
        const current = pending.pop();
        if (!current) {
            continue;
        }
        for (const entry of readdirSync(current, { withFileTypes: true })) {
            if (entry.name === '.git' || entry.name === 'node_modules') {
                continue;
            }
            const fullPath = path.join(current, entry.name);
            if (entry.isDirectory()) {
                pending.push(fullPath);
            } else if (entry.isFile() && supportedExtensions.has(
                path.extname(entry.name).toLowerCase()
            )) {
                files.push(fullPath);
            }
        }
    }
    files.sort();
    return files.map(file => ({
        uri: `file://${file.replaceAll('\\', '/')}`,
        text: readFileSync(file, 'utf8'),
    }));
}

function round(value: number): number {
    return Math.round(value * 100) / 100;
}

