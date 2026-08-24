import assert from 'node:assert/strict';
import path from 'node:path';
import * as vscode from 'vscode';
import { withTimeout } from '../withTimeout';

const EXTENSION_ID = 'shmuel-appleton.sql-developer-companion';

export async function run(): Promise<void> {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension, `${EXTENSION_ID} is not installed in the test host`);

    await withTimeout(extension.activate(), 30_000, 'Extension activation timed out');
    assert.equal(extension.isActive, true);

    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('sqlDevCompanion.reindexPlsql'));
    const indexStarted = Date.now();
    await withTimeout(
        vscode.commands.executeCommand('sqlDevCompanion.reindexPlsql'),
        30_000,
        'PL/SQL indexing timed out',
    );
    console.log(`SMOKE_INDEX_MS=${Date.now() - indexStarted}`);

    const workspace = vscode.workspace.workspaceFolders?.[0];
    assert.ok(workspace, 'examples workspace was not opened');

    await assertPythonPackageNavigation(workspace.uri);
    await assertPackageCounterpartNavigation(workspace.uri);
    await assertObjectTypeCounterpartNavigation(workspace.uri);
}

async function assertPythonPackageNavigation(root: vscode.Uri): Promise<void> {
    const document = await open(root, 'embedded_sql_examples.py');
    assert.equal(document.languageId, 'python');
    const needle = 'demo_repository_api.reserve_item';
    const position = document.positionAt(
        document.getText().indexOf(needle) + needle.indexOf('reserve_item') + 2,
    );
    const targets = await withTimeout(
        vscode.commands.executeCommand<readonly DefinitionTarget[]>(
            'vscode.executeDefinitionProvider',
            document.uri,
            position,
        ),
        10_000,
        'Python definition request timed out',
    );

    assert.ok(targetUris(targets).some(uri => uri.fsPath.endsWith(
        path.join('examples', 'demo_repository_api.pkb'),
    )));
}

async function assertPackageCounterpartNavigation(root: vscode.Uri): Promise<void> {
    const document = await open(root, 'demo_repository_api.pks');
    assert.equal(document.languageId, 'oracle-sql');
    const position = document.positionAt(document.getText().indexOf('reserve_item') + 2);
    const targets = await withTimeout(
        vscode.commands.executeCommand<readonly DefinitionTarget[]>(
            'vscode.executeImplementationProvider',
            document.uri,
            position,
        ),
        10_000,
        'Package implementation request timed out',
    );

    assert.ok(targetUris(targets).some(uri => uri.fsPath.endsWith(
        path.join('examples', 'demo_repository_api.pkb'),
    )));
}

async function assertObjectTypeCounterpartNavigation(root: vscode.Uri): Promise<void> {
    const document = await open(root, 'demo_item_type.tps');
    assert.equal(document.languageId, 'oracle-sql');
    const position = document.positionAt(document.getText().indexOf('rename') + 2);
    const targets = await withTimeout(
        vscode.commands.executeCommand<readonly DefinitionTarget[]>(
            'vscode.executeImplementationProvider',
            document.uri,
            position,
        ),
        10_000,
        'Object type implementation request timed out',
    );

    assert.ok(targetUris(targets).some(uri => uri.fsPath.endsWith(
        path.join('examples', 'demo_item_type.tpb'),
    )));
}

async function open(root: vscode.Uri, name: string): Promise<vscode.TextDocument> {
    const document = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(root, name));
    await vscode.window.showTextDocument(document, { preview: false });
    return document;
}

type DefinitionTarget = vscode.Location | vscode.LocationLink;

function targetUris(targets: readonly DefinitionTarget[] | undefined): vscode.Uri[] {
    return (targets ?? []).map(target =>
        'targetUri' in target ? target.targetUri : target.uri
    );
}
