import * as vscode from 'vscode';
import { buildEmbeddedSqlBackground } from './embeddedSqlRanges';

const backgroundSetting = 'sqlDevCompanion.embeddedSqlBackground';

export function activateEmbeddedSqlBackground(context: vscode.ExtensionContext): void {
    const wholeLineDecoration = vscode.window.createTextEditorDecorationType({
        backgroundColor: new vscode.ThemeColor('sqlDevCompanion.embeddedSqlBackground'),
        isWholeLine: true,
    });
    const inlineDecoration = vscode.window.createTextEditorDecorationType({
        backgroundColor: new vscode.ThemeColor('sqlDevCompanion.embeddedSqlBackground'),
    });

    const updateEditor = (editor: vscode.TextEditor): void => {
        const enabled = vscode.workspace
            .getConfiguration('sqlDevCompanion', editor.document.uri)
            .get<boolean>('embeddedSqlBackground', true);

        if (!enabled || editor.document.languageId !== 'python') {
            editor.setDecorations(wholeLineDecoration, []);
            editor.setDecorations(inlineDecoration, []);
            return;
        }

        const text = editor.document.getText();
        const background = buildEmbeddedSqlBackground(text);
        const wholeLines = background.wholeLines.map((line) =>
            new vscode.Range(line, 0, line, 0),
        );
        const inlineRanges = background.inlineRanges.map((range) =>
            new vscode.Range(
                editor.document.positionAt(range.start),
                editor.document.positionAt(range.end),
            ),
        );
        editor.setDecorations(wholeLineDecoration, wholeLines);
        editor.setDecorations(inlineDecoration, inlineRanges);
    };

    const updateVisibleEditors = (): void => {
        for (const editor of vscode.window.visibleTextEditors) {
            updateEditor(editor);
        }
    };

    context.subscriptions.push(
        wholeLineDecoration,
        inlineDecoration,
        vscode.window.onDidChangeVisibleTextEditors(updateVisibleEditors),
        vscode.workspace.onDidChangeTextDocument((event) => {
            for (const editor of vscode.window.visibleTextEditors) {
                if (editor.document === event.document) {
                    updateEditor(editor);
                }
            }
        }),
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration(backgroundSetting)) {
                updateVisibleEditors();
            }
        }),
    );

    updateVisibleEditors();
}
