import * as vscode from 'vscode';
import { PlsqlParser, PlsqlDefinition } from './plsqlParser';
import { extractProgramUnitSymbols, ProgramUnitSymbol } from './semanticNavigation';

/**
 * Represents a definition with its source file
 */
export interface WorkspaceDefinition extends PlsqlDefinition {
    uri: vscode.Uri;
    fileName: string;
}

/**
 * Indexes all PL/SQL definitions across the workspace
 * Provides fast lookup by symbol name
 */
export class WorkspaceIndexer {
    
    private parser: PlsqlParser;
    private outputChannel: vscode.OutputChannel;
    
    // Map of symbol name (lowercase) -> array of definitions
    private definitionIndex: Map<string, WorkspaceDefinition[]> = new Map();
    
    // Map of file URI -> definitions in that file (for quick invalidation)
    private fileIndex: Map<string, WorkspaceDefinition[]> = new Map();

    // Program-unit symbols are indexed separately because object type members are
    // not part of the legacy definition parser.
    private programUnitFileIndex: Map<string, ProgramUnitSymbol[]> = new Map();
    
    // File patterns to index
    private readonly FILE_PATTERNS = '**/*.{pks,pkb,sql,pls,plb,pck}';
    
    private isIndexing = false;
    private disposed = false;
    
    constructor(outputChannel: vscode.OutputChannel) {
        this.parser = new PlsqlParser();
        this.outputChannel = outputChannel;
    }
    
    /**
     * Mark the indexer as disposed - stops any ongoing indexing
     */
    public dispose(): void {
        this.disposed = true;
    }
    
    /**
     * Initialize the indexer - scan all workspace files
     */
    public async initialize(): Promise<void> {
        if (this.disposed) {
            return;
        }
        
        this.outputChannel.appendLine('[Indexer] Starting workspace indexing...');
        this.isIndexing = true;
        
        const startTime = Date.now();
        
        try {
            // Find all PL/SQL files in workspace
            const files = await vscode.workspace.findFiles(this.FILE_PATTERNS, '**/node_modules/**');
            
            if (this.disposed) {
                return;
            }
            
            this.outputChannel.appendLine(`[Indexer] Found ${files.length} PL/SQL files to index`);
            
            // Index files sequentially with error handling for each file
            for (const file of files) {
                if (this.disposed) {
                    break;
                }
                
                try {
                    await this.indexFile(file);
                } catch (error) {
                    // Silently continue on individual file errors
                }
            }

            // Open documents are authoritative, including documents that were
            // already dirty before activation or changed during initial indexing.
            for (const document of vscode.workspace.textDocuments) {
                if (this.disposed) {
                    break;
                }
                if (this.isPlsqlFile(document.uri)) {
                    try {
                        this.indexDocument(document);
                    } catch (error) {
                        // Keep failures isolated to the current document.
                    }
                }
            }
            
            const elapsed = Date.now() - startTime;
            if (!this.disposed) {
                const stats = this.getStats();
                this.outputChannel.appendLine(`[Indexer] Indexed ${stats.fileCount} files with ${stats.symbolCount} unique symbols in ${elapsed}ms`);
            }
            
        } catch (error) {
            // Silently ignore errors during shutdown
        } finally {
            this.isIndexing = false;
        }
    }
    
    /**
     * Index a single file
     */
    public async indexFile(uri: vscode.Uri): Promise<void> {
        if (!this.isPlsqlFile(uri)) {
            return;
        }
        try {
            // Read file content directly instead of opening as document
            // This avoids "Canceled" errors from openTextDocument
            let fileContent: Uint8Array;
            try {
                fileContent = await vscode.workspace.fs.readFile(uri);
            } catch (readError) {
                this.reportIndexError(uri, readError);
                return;
            }
            
            const text = Buffer.from(fileContent).toString('utf8');
            if (this.disposed) {
                return;
            }
            const openDocument = vscode.workspace.textDocuments.find(
                document => document.uri.toString() === uri.toString()
            );
            if (openDocument) {
                this.indexDocument(openDocument);
                return;
            }
            this.indexText(uri, text);
            
        } catch (error) {
            this.reportIndexError(uri, error);
        }
    }

    /** Replace saved symbols with the current contents of an open document. */
    public indexDocument(document: vscode.TextDocument): void {
        if (!this.isPlsqlFile(document.uri)) {
            return;
        }
        try {
            this.indexText(document.uri, document.getText());
        } catch (error) {
            this.reportIndexError(document.uri, error);
        }
    }

    private reportIndexError(uri: vscode.Uri, error: unknown): void {
        const message = error instanceof Error ? error.message : String(error);
        this.outputChannel.appendLine(`[Indexer] Failed to index ${uri.fsPath}: ${message}`);
    }

    private async indexCurrentContent(uri: vscode.Uri): Promise<void> {
        const openDocument = vscode.workspace.textDocuments.find(
            document => document.uri.toString() === uri.toString()
        );
        if (openDocument) {
            this.indexDocument(openDocument);
        } else {
            await this.indexFile(uri);
        }
    }

    private indexText(uri: vscode.Uri, text: string): void {
        const definitions = this.parser.parseText(text);
        const programUnitSymbols = extractProgramUnitSymbols({ uri: uri.toString(), text });
        const fileName = uri.path.split('/').pop() || uri.fsPath;
        const workspaceDefinitions: WorkspaceDefinition[] = definitions.map(definition => ({
            ...definition,
            uri,
            fileName
        }));

        this.removeFileFromIndex(uri.toString());
        this.programUnitFileIndex.set(uri.toString(), programUnitSymbols);

        for (const definition of workspaceDefinitions) {
            const key = definition.name.toLowerCase();
            const existing = this.definitionIndex.get(key) || [];
            existing.push(definition);
            this.definitionIndex.set(key, existing);
        }

        this.fileIndex.set(uri.toString(), workspaceDefinitions);
    }
    
    /**
     * Remove all definitions from a file
     */
    public removeFileFromIndex(uriString: string): void {
        this.programUnitFileIndex.delete(uriString);

        const fileDefs = this.fileIndex.get(uriString);
        if (!fileDefs) {
            return;
        }
        
        // Remove each definition from the main index
        for (const def of fileDefs) {
            const key = def.name.toLowerCase();
            const existing = this.definitionIndex.get(key);
            if (existing) {
                const filtered = existing.filter(d => d.uri.toString() !== uriString);
                if (filtered.length > 0) {
                    this.definitionIndex.set(key, filtered);
                } else {
                    this.definitionIndex.delete(key);
                }
            }
        }
        
        this.fileIndex.delete(uriString);
    }
    
    /**
     * Find all definitions for a symbol name across the workspace
     */
    public findDefinitions(symbolName: string): WorkspaceDefinition[] {
        const key = symbolName.toLowerCase();
        return this.definitionIndex.get(key) || [];
    }

    /** Find indexed program-unit headers or direct members with the given name. */
    public findProgramUnitSymbols(symbolName: string): ProgramUnitSymbol[] {
        const name = symbolName.toLowerCase();
        return [...this.programUnitFileIndex.values()]
            .flatMap(symbols => symbols)
            .filter(symbol => symbol.name.toLowerCase() === name);
    }
    
    /**
     * Find definitions excluding a specific file (for cross-file navigation)
     * Uses fsPath for comparison to handle URI format differences
     */
    public findDefinitionsExcludingFile(symbolName: string, excludeUri: vscode.Uri): WorkspaceDefinition[] {
        const all = this.findDefinitions(symbolName);
        const excludePath = excludeUri.fsPath.toLowerCase();
        return all.filter(def => def.uri.fsPath.toLowerCase() !== excludePath);
    }
    
    /**
     * Find definitions in a specific file
     */
    public findDefinitionsInFile(symbolName: string, uri: vscode.Uri): WorkspaceDefinition[] {
        const all = this.findDefinitions(symbolName);
        return all.filter(def => def.uri.toString() === uri.toString());
    }
    
    /**
     * Get all package names defined in a specific file
     * Returns package names from actual PACKAGE/PACKAGE BODY definitions
     */
    public getPackageNamesInFile(uri: vscode.Uri): string[] {
        const fileDefs = this.fileIndex.get(uri.toString());
        if (!fileDefs) {
            return [];
        }
        
        return fileDefs
            .filter(def => def.type === 'package')
            .map(def => def.name.toUpperCase());
    }
    
    /**
     * Check if a file contains a package body for the given package name
     */
    public isPackageBodyFile(uri: vscode.Uri, packageName: string): boolean {
        const fileDefs = this.fileIndex.get(uri.toString());
        if (!fileDefs) {
            return false;
        }
        
        return fileDefs.some(def => 
            def.type === 'package' && 
            def.name.toLowerCase() === packageName.toLowerCase() &&
            def.isPackageBody === true
        );
    }
    
    /**
     * Check if a file contains a package spec for the given package name
     */
    public isPackageSpecFile(uri: vscode.Uri, packageName: string): boolean {
        const fileDefs = this.fileIndex.get(uri.toString());
        if (!fileDefs) {
            return false;
        }
        
        return fileDefs.some(def => 
            def.type === 'package' && 
            def.name.toLowerCase() === packageName.toLowerCase() &&
            def.isPackageBody === false
        );
    }
    
    /**
     * Get statistics about the index
     */
    public getStats(): { fileCount: number; symbolCount: number; isIndexing: boolean } {
        return {
            fileCount: this.fileIndex.size,
            symbolCount: this.definitionIndex.size,
            isIndexing: this.isIndexing
        };
    }
    
    /**
     * Clear the entire index
     */
    public clear(): void {
        this.definitionIndex.clear();
        this.fileIndex.clear();
        this.programUnitFileIndex.clear();
    }
    
    /**
     * Set up file watchers to keep index up to date
     */
    public setupFileWatchers(context: vscode.ExtensionContext): void {
        // Watch for file changes
        const watcher = vscode.workspace.createFileSystemWatcher(this.FILE_PATTERNS);
        
        watcher.onDidCreate(async (uri) => {
            this.outputChannel.appendLine(`[Indexer] File created: ${uri.fsPath}`);
            await this.indexCurrentContent(uri);
        });
        
        watcher.onDidChange(async (uri) => {
            this.outputChannel.appendLine(`[Indexer] File changed: ${uri.fsPath}`);
            await this.indexCurrentContent(uri);
        });
        
        watcher.onDidDelete((uri) => {
            this.outputChannel.appendLine(`[Indexer] File deleted: ${uri.fsPath}`);
            const openDocument = vscode.workspace.textDocuments.find(
                document => document.uri.toString() === uri.toString()
            );
            if (openDocument) {
                this.indexDocument(openDocument);
            } else {
                this.removeFileFromIndex(uri.toString());
            }
        });
        
        context.subscriptions.push(watcher);
        
        // Also watch for document saves (in case file watcher misses it)
        context.subscriptions.push(
            vscode.workspace.onDidSaveTextDocument(async (document) => {
                if (this.isPlsqlFile(document.uri)) {
                    this.outputChannel.appendLine(`[Indexer] Document saved: ${document.uri.fsPath}`);
                    this.indexDocument(document);
                }
            })
        );

        context.subscriptions.push(
            vscode.workspace.onDidOpenTextDocument((document) => {
                if (this.isPlsqlFile(document.uri)) {
                    this.indexDocument(document);
                }
            })
        );

        context.subscriptions.push(
            vscode.workspace.onDidChangeTextDocument((event) => {
                if (this.isPlsqlFile(event.document.uri)) {
                    this.indexDocument(event.document);
                }
            })
        );

        context.subscriptions.push(
            vscode.workspace.onDidCloseTextDocument(async (document) => {
                if (this.isPlsqlFile(document.uri)) {
                    this.removeFileFromIndex(document.uri.toString());
                    await this.indexFile(document.uri);
                }
            })
        );
    }
    
    /**
     * Check if a URI is a PL/SQL file
     */
    private isPlsqlFile(uri: vscode.Uri): boolean {
        if (uri.scheme !== 'file' || !vscode.workspace.getWorkspaceFolder(uri)) {
            return false;
        }
        const ext = uri.fsPath.toLowerCase();
        return ext.endsWith('.pks') || 
               ext.endsWith('.pkb') || 
               ext.endsWith('.sql') || 
               ext.endsWith('.pls') || 
               ext.endsWith('.plb') ||
               ext.endsWith('.pck');
    }
}
