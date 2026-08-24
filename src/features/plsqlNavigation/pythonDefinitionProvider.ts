import * as vscode from 'vscode';
import {
    EmbeddedSqlDefinitionTarget,
    resolveEmbeddedSqlReferenceAt,
} from './embeddedSqlNavigation';
import { ProgramUnitNavigationKind, ProgramUnitSymbol } from './semanticNavigation';
import { WorkspaceIndexer } from './workspaceIndexer';

/** Bridges Python embedded-SQL references to the local PL/SQL workspace index. */
export class PythonEmbeddedSqlDefinitionProvider implements
    vscode.DefinitionProvider,
    vscode.DeclarationProvider,
    vscode.ImplementationProvider {

    constructor(
        private readonly outputChannel: vscode.OutputChannel,
        private readonly workspaceIndexer: WorkspaceIndexer,
    ) { }

    public provideDefinition(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
    ): vscode.ProviderResult<vscode.Definition | vscode.LocationLink[]> {
        return this.findLocations(document, position, token, 'definition');
    }

    public provideDeclaration(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
    ): vscode.ProviderResult<vscode.Declaration> {
        return this.findLocations(document, position, token, 'declaration');
    }

    public provideImplementation(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
    ): vscode.ProviderResult<vscode.Definition | vscode.LocationLink[]> {
        return this.findLocations(document, position, token, 'implementation');
    }

    private findLocations(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
        navigation: ProgramUnitNavigationKind,
    ): vscode.LocationLink[] | undefined {
        if (token.isCancellationRequested ||
            document.uri.scheme !== 'file' ||
            vscode.workspace.getWorkspaceFolder(document.uri) === undefined) {
            return undefined;
        }

        const configuredTarget = vscode.workspace
            .getConfiguration('sqlDevCompanion')
            .get<string>('packageDefinitionTarget', 'body');
        const definitionTarget: EmbeddedSqlDefinitionTarget =
            configuredTarget === 'spec' || configuredTarget === 'both'
                ? configuredTarget
                : 'body';
        const text = document.getText();
        const resolved = resolveEmbeddedSqlReferenceAt(
            text,
            document.offsetAt(position),
            name => this.workspaceIndexer.findProgramUnitSymbols(name),
            navigation,
            definitionTarget,
        );
        if (!resolved) {
            return undefined;
        }

        const originSelectionRange = new vscode.Range(
            document.positionAt(resolved.start),
            document.positionAt(resolved.end),
        );
        this.outputChannel.appendLine(
            `[${navigation}] Found ${resolved.targets.length} embedded-SQL repository target(s)`,
        );
        return resolved.targets.map(target =>
            this.createLocationLink(target, originSelectionRange)
        );
    }

    private createLocationLink(
        symbol: ProgramUnitSymbol,
        originSelectionRange: vscode.Range,
    ): vscode.LocationLink {
        const targetStart = new vscode.Position(symbol.line, symbol.column);
        const targetRange = new vscode.Range(
            targetStart,
            new vscode.Position(symbol.line, symbol.column + symbol.name.length),
        );
        return {
            originSelectionRange,
            targetUri: vscode.Uri.parse(symbol.uri),
            targetRange,
            targetSelectionRange: targetRange,
        };
    }
}
