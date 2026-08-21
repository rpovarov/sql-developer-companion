import assert from 'node:assert/strict';
import Module from 'node:module';
import test from 'node:test';

type TestUri = {
    scheme: string;
    fsPath: string;
    path: string;
    toString(): string;
};

const savedFiles = new Map<string, string>();
const workspaceFiles: TestUri[] = [];
const openDocuments: Array<ReturnType<typeof textDocument>> = [];
let readFileOverride: ((uri: TestUri) => Promise<Uint8Array>) | undefined;
let documentChangeListener: ((event: { document: ReturnType<typeof textDocument> }) => void) | undefined;
let documentCloseListener: ((document: ReturnType<typeof textDocument>) => Promise<void>) | undefined;
let documentOpenListener: ((document: ReturnType<typeof textDocument>) => void) | undefined;
let fileChangeListener: ((uri: TestUri) => Promise<void>) | undefined;
let fileDeleteListener: ((uri: TestUri) => void) | undefined;
const disposable = { dispose() { } };
const vscode = {
    workspace: {
        findFiles: async () => workspaceFiles,
        getWorkspaceFolder: (uri: TestUri) =>
            uri.scheme === 'file' && uri.fsPath.startsWith('C:\\workspace\\') ? {} : undefined,
        get textDocuments() {
            return openDocuments;
        },
        fs: {
            readFile: async (uri: TestUri) => readFileOverride
                ? readFileOverride(uri)
                : Buffer.from(savedFiles.get(uri.toString()) ?? '')
        },
        createFileSystemWatcher: () => ({
            ...disposable,
            onDidCreate: () => disposable,
            onDidChange: (listener: typeof fileChangeListener) => {
                fileChangeListener = listener;
                return disposable;
            },
            onDidDelete: (listener: typeof fileDeleteListener) => {
                fileDeleteListener = listener;
                return disposable;
            }
        }),
        onDidSaveTextDocument: () => disposable,
        onDidOpenTextDocument: (listener: typeof documentOpenListener) => {
            documentOpenListener = listener;
            return disposable;
        },
        onDidChangeTextDocument: (listener: typeof documentChangeListener) => {
            documentChangeListener = listener;
            return disposable;
        },
        onDidCloseTextDocument: (listener: typeof documentCloseListener) => {
            documentCloseListener = listener;
            return disposable;
        }
    }
};

const originalLoad = (Module as unknown as { _load: (...args: unknown[]) => unknown })._load;
(Module as unknown as { _load: (...args: unknown[]) => unknown })._load = function (
    request: unknown,
    ...args: unknown[]
): unknown {
    return request === 'vscode' ? vscode : originalLoad(request, ...args);
};

const { WorkspaceIndexer } = require('./workspaceIndexer') as typeof import('./workspaceIndexer');
(Module as unknown as { _load: (...args: unknown[]) => unknown })._load = originalLoad;

function fileUri(fileName: string): TestUri {
    const fsPath = `C:\\workspace\\${fileName}`;
    return {
        scheme: 'file',
        fsPath,
        path: `/workspace/${fileName}`,
        toString: () => `file:///workspace/${fileName}`
    };
}

function databaseUri(fileName: string): TestUri {
    return {
        scheme: 'dbtools',
        fsPath: `C:\\database\\${fileName}`,
        path: `/database/${fileName}`,
        toString: () => `dbtools:///database/${fileName}`
    };
}

function externalFileUri(fileName: string): TestUri {
    return {
        scheme: 'file',
        fsPath: `C:\\outside\\${fileName}`,
        path: `/outside/${fileName}`,
        toString: () => `file:///outside/${fileName}`
    };
}

function textDocument(uri: TestUri, text: string) {
    return {
        uri,
        getText: () => text
    };
}

test('an open document immediately replaces saved program-unit symbols', async () => {
    const uri = fileUri('demo.pks');
    savedFiles.set(uri.toString(), [
        'CREATE PACKAGE demo AS',
        '    PROCEDURE run(p_id NUMBER);',
        'END demo;',
        '/'
    ].join('\n'));
    const indexer = new WorkspaceIndexer({ appendLine() { } } as never);

    await indexer.indexFile(uri as never);
    indexer.indexDocument(
        textDocument(uri, [
            '',
            'CREATE PACKAGE demo AS',
            '    PROCEDURE run(p_id VARCHAR2);',
            'END demo;',
            '/'
        ].join('\n')) as never
    );

    assert.deepEqual(
        indexer.findProgramUnitSymbols('run').map(symbol => ({ line: symbol.line, signature: symbol.signature })),
        [{ line: 2, signature: 'VARCHAR2' }]
    );
    assert.deepEqual(
        indexer.findDefinitions('run').map(definition => ({ line: definition.line, signature: definition.signature })),
        [{ line: 2, signature: 'PROCEDURE run(p_id VARCHAR2)' }]
    );
});

test('a document change replaces only that document in the workspace index', async () => {
    const changedUri = fileUri('changed.pks');
    const otherUri = fileUri('other.pks');
    savedFiles.set(changedUri.toString(), 'CREATE PACKAGE changed AS\nPROCEDURE before_change;\nEND changed;\n/');
    savedFiles.set(otherUri.toString(), 'CREATE PACKAGE other AS\nPROCEDURE untouched;\nEND other;\n/');
    const indexer = new WorkspaceIndexer({ appendLine() { } } as never);
    const context = { subscriptions: [] as Array<{ dispose(): void }> };

    await indexer.indexFile(changedUri as never);
    await indexer.indexFile(otherUri as never);
    indexer.setupFileWatchers(context as never);
    assert.ok(documentChangeListener);

    documentChangeListener({
        document: textDocument(
            changedUri,
            'CREATE PACKAGE changed AS\nPROCEDURE after_change;\nEND changed;\n/'
        )
    });

    assert.equal(indexer.findProgramUnitSymbols('before_change').length, 0);
    assert.equal(indexer.findProgramUnitSymbols('after_change').length, 1);
    assert.equal(indexer.findProgramUnitSymbols('untouched').length, 1);
});

test('closing an unsaved document restores its saved workspace symbols', async () => {
    const uri = fileUri('close_demo.pks');
    savedFiles.set(
        uri.toString(),
        'CREATE PACKAGE close_demo AS\nPROCEDURE saved_version;\nEND close_demo;\n/'
    );
    const indexer = new WorkspaceIndexer({ appendLine() { } } as never);
    const context = { subscriptions: [] as Array<{ dispose(): void }> };

    await indexer.indexFile(uri as never);
    indexer.indexDocument(textDocument(
        uri,
        'CREATE PACKAGE close_demo AS\nPROCEDURE unsaved_version;\nEND close_demo;\n/'
    ) as never);
    indexer.setupFileWatchers(context as never);
    assert.ok(documentCloseListener);

    await documentCloseListener(textDocument(uri, '') as never);

    assert.equal(indexer.findProgramUnitSymbols('unsaved_version').length, 0);
    assert.equal(indexer.findProgramUnitSymbols('saved_version').length, 1);
});

test('opening a document overlays its current text without waiting for a change', async () => {
    const uri = fileUri('opened.pks');
    savedFiles.set(uri.toString(), 'CREATE PACKAGE opened AS\nPROCEDURE saved_name;\nEND opened;\n/');
    const indexer = new WorkspaceIndexer({ appendLine() { } } as never);
    const context = { subscriptions: [] as Array<{ dispose(): void }> };

    await indexer.indexFile(uri as never);
    indexer.setupFileWatchers(context as never);
    assert.ok(documentOpenListener);

    documentOpenListener(textDocument(
        uri,
        'CREATE PACKAGE opened AS\nPROCEDURE open_name;\nEND opened;\n/'
    ));

    assert.equal(indexer.findProgramUnitSymbols('saved_name').length, 0);
    assert.equal(indexer.findProgramUnitSymbols('open_name').length, 1);
});

test('initial indexing finishes with already-open document text over saved text', async () => {
    const uri = fileUri('initially_open.pks');
    savedFiles.set(
        uri.toString(),
        'CREATE PACKAGE initially_open AS\nPROCEDURE saved_initial;\nEND initially_open;\n/'
    );
    workspaceFiles.splice(0, workspaceFiles.length, uri);
    openDocuments.splice(0, openDocuments.length, textDocument(
        uri,
        'CREATE PACKAGE initially_open AS\nPROCEDURE unsaved_initial;\nEND initially_open;\n/'
    ));
    const output: string[] = [];
    const indexer = new WorkspaceIndexer({ appendLine(line: string) { output.push(line); } } as never);

    await indexer.initialize();

    assert.equal(indexer.findProgramUnitSymbols('saved_initial').length, 0);
    assert.equal(indexer.findProgramUnitSymbols('unsaved_initial').length, 1);
    assert.match(output.at(-1) ?? '', /^\[Indexer\] Indexed 1 files with \d+ unique symbols in \d+ms$/);
    workspaceFiles.length = 0;
    openDocuments.length = 0;
});

test('a file watcher event does not replace a dirty open-document overlay', async () => {
    const uri = fileUri('dirty_watcher.pks');
    savedFiles.set(
        uri.toString(),
        'CREATE PACKAGE dirty_watcher AS\nPROCEDURE saved_watcher;\nEND dirty_watcher;\n/'
    );
    const dirtyDocument = textDocument(
        uri,
        'CREATE PACKAGE dirty_watcher AS\nPROCEDURE dirty_watcher_member;\nEND dirty_watcher;\n/'
    );
    openDocuments.splice(0, openDocuments.length, dirtyDocument);
    const indexer = new WorkspaceIndexer({ appendLine() { } } as never);
    const context = { subscriptions: [] as Array<{ dispose(): void }> };

    await indexer.indexFile(uri as never);
    indexer.indexDocument(dirtyDocument as never);
    indexer.setupFileWatchers(context as never);
    assert.ok(fileChangeListener);

    await fileChangeListener(uri);

    assert.equal(indexer.findProgramUnitSymbols('saved_watcher').length, 0);
    assert.equal(indexer.findProgramUnitSymbols('dirty_watcher_member').length, 1);
    openDocuments.length = 0;
});

test('a malformed file does not prevent another file from being indexed', async () => {
    const malformedUri = fileUri('malformed.pks');
    const validUri = fileUri('valid.pks');
    savedFiles.set(malformedUri.toString(), 'CREATE PACKAGE malformed AS\nPROCEDURE incomplete(');
    savedFiles.set(validUri.toString(), 'CREATE PACKAGE valid AS\nPROCEDURE reachable;\nEND valid;\n/');
    workspaceFiles.splice(0, workspaceFiles.length, malformedUri, validUri);
    const indexer = new WorkspaceIndexer({ appendLine() { } } as never);

    await indexer.initialize();

    assert.equal(indexer.findProgramUnitSymbols('reachable').length, 1);
    assert.equal(indexer.getStats().fileCount, 2);
    workspaceFiles.length = 0;
});

test('disposing the indexer cancels initialization before workspace access', async () => {
    const uri = fileUri('cancelled.pks');
    savedFiles.set(uri.toString(), 'CREATE PACKAGE cancelled AS\nEND cancelled;\n/');
    workspaceFiles.splice(0, workspaceFiles.length, uri);
    const indexer = new WorkspaceIndexer({ appendLine() { } } as never);

    indexer.dispose();
    await indexer.initialize();

    assert.deepEqual(indexer.getStats(), { fileCount: 0, symbolCount: 0, isIndexing: false });
    workspaceFiles.length = 0;
});

test('database documents remain outside the repository index overlay', () => {
    const uri = databaseUri('remote.sql');
    const indexer = new WorkspaceIndexer({ appendLine() { } } as never);
    const context = { subscriptions: [] as Array<{ dispose(): void }> };

    indexer.setupFileWatchers(context as never);
    assert.ok(documentOpenListener);
    documentOpenListener(textDocument(
        uri,
        'CREATE PACKAGE remote AS\nPROCEDURE database_only;\nEND remote;\n/'
    ));

    assert.equal(indexer.findProgramUnitSymbols('database_only').length, 0);
});

test('an open document wins when a saved-file read completes later', async () => {
    const uri = fileUri('stale_read.pks');
    const savedText = 'CREATE PACKAGE stale_read AS\nPROCEDURE saved_late;\nEND stale_read;\n/';
    let finishRead!: (content: Uint8Array) => void;
    readFileOverride = () => new Promise(resolve => { finishRead = resolve; });
    const indexer = new WorkspaceIndexer({ appendLine() { } } as never);

    const pendingIndex = indexer.indexFile(uri as never);
    const dirtyDocument = textDocument(
        uri,
        'CREATE PACKAGE stale_read AS\nPROCEDURE dirty_current;\nEND stale_read;\n/'
    );
    openDocuments.splice(0, openDocuments.length, dirtyDocument);
    indexer.indexDocument(dirtyDocument as never);
    finishRead(Buffer.from(savedText));
    await pendingIndex;

    assert.equal(indexer.findProgramUnitSymbols('saved_late').length, 0);
    assert.equal(indexer.findProgramUnitSymbols('dirty_current').length, 1);
    readFileOverride = undefined;
    openDocuments.length = 0;
});

test('disposing during a pending saved-file read prevents a late index mutation', async () => {
    const uri = fileUri('dispose_pending.pks');
    const savedText = 'CREATE PACKAGE dispose_pending AS\nPROCEDURE too_late;\nEND dispose_pending;\n/';
    let finishRead!: (content: Uint8Array) => void;
    readFileOverride = () => new Promise(resolve => { finishRead = resolve; });
    const indexer = new WorkspaceIndexer({ appendLine() { } } as never);

    const pendingIndex = indexer.indexFile(uri as never);
    indexer.dispose();
    finishRead(Buffer.from(savedText));
    await pendingIndex;

    assert.equal(indexer.findProgramUnitSymbols('too_late').length, 0);
    assert.equal(indexer.getStats().fileCount, 0);
    readFileOverride = undefined;
});

test('local files outside a VS Code workspace folder do not enter the repository overlay', async () => {
    const uri = externalFileUri('external.sql');
    savedFiles.set(
        uri.toString(),
        'CREATE PACKAGE external AS\nPROCEDURE saved_external;\nEND external;\n/'
    );
    const indexer = new WorkspaceIndexer({ appendLine() { } } as never);
    const context = { subscriptions: [] as Array<{ dispose(): void }> };

    await indexer.indexFile(uri as never);
    indexer.setupFileWatchers(context as never);
    assert.ok(documentOpenListener);
    documentOpenListener(textDocument(
        uri,
        'CREATE PACKAGE external AS\nPROCEDURE open_external;\nEND external;\n/'
    ));

    assert.equal(indexer.findProgramUnitSymbols('saved_external').length, 0);
    assert.equal(indexer.findProgramUnitSymbols('open_external').length, 0);
});

test('file deletion preserves an open overlay and close removes it when the file is missing', async () => {
    const uri = fileUri('deleted_open.pks');
    const openDocument = textDocument(
        uri,
        'CREATE PACKAGE deleted_open AS\nPROCEDURE still_open;\nEND deleted_open;\n/'
    );
    openDocuments.splice(0, openDocuments.length, openDocument);
    const indexer = new WorkspaceIndexer({ appendLine() { } } as never);
    const context = { subscriptions: [] as Array<{ dispose(): void }> };

    indexer.indexDocument(openDocument as never);
    indexer.setupFileWatchers(context as never);
    assert.ok(fileDeleteListener);
    assert.ok(documentCloseListener);

    fileDeleteListener(uri);
    assert.equal(indexer.findProgramUnitSymbols('still_open').length, 1);

    openDocuments.length = 0;
    readFileOverride = async () => { throw new Error('file is missing'); };
    await documentCloseListener(openDocument as never);
    assert.equal(indexer.findProgramUnitSymbols('still_open').length, 0);
    readFileOverride = undefined;
});

test('a live-document read failure is isolated and reported to the output channel', () => {
    const uri = fileUri('live_error.pks');
    const output: string[] = [];
    const indexer = new WorkspaceIndexer({ appendLine(line: string) { output.push(line); } } as never);

    assert.doesNotThrow(() => indexer.indexDocument({
        uri,
        getText() {
            throw new Error('live getText failed');
        }
    } as never));

    assert.equal(indexer.getStats().fileCount, 0);
    assert.match(output.at(-1) ?? '', /Failed to index .*live_error\.pks: live getText failed$/);
});

test('a saved-file read failure is isolated and reported to the output channel', async () => {
    const uri = fileUri('saved_error.pks');
    const output: string[] = [];
    readFileOverride = async () => { throw new Error('saved read failed'); };
    const indexer = new WorkspaceIndexer({ appendLine(line: string) { output.push(line); } } as never);

    await indexer.indexFile(uri as never);

    assert.equal(indexer.getStats().fileCount, 0);
    assert.match(output.at(-1) ?? '', /Failed to index .*saved_error\.pks: saved read failed$/);
    readFileOverride = undefined;
});
