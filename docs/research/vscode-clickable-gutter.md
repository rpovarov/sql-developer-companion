# Clickable PL/SQL spec/body gutter in VS Code

Research date: 2026-08-21. Sources are limited to the official VS Code Extension API and the `microsoft/vscode` project.

## Conclusion

An extension can draw a JetBrains-like arrow in the editor gutter, but it cannot make that gutter decoration clickable with the stable public VS Code API.

`window.createTextEditorDecorationType` accepts `DecorationRenderOptions`; that type exposes `gutterIconPath` and `gutterIconSize`, but no `command`, `onClick`, or click event. Per-occurrence `DecorationOptions` likewise exposes only a range, hover content, and render options. `TextEditorDecorationType` itself only exposes its key and `dispose`. Therefore a gutter icon created by a normal extension is visual decoration, not an actionable control. See the official API entries for [`DecorationRenderOptions`](https://code.visualstudio.com/api/references/vscode-api#DecorationRenderOptions), [`DecorationOptions`](https://code.visualstudio.com/api/references/vscode-api#DecorationOptions), and [`TextEditorDecorationType`](https://code.visualstudio.com/api/references/vscode-api#TextEditorDecorationType).

This is also reflected in the VS Code project's open [request for click and hover events on gutter icons, #224134](https://github.com/microsoft/vscode/issues/224134), currently categorized as a feature request in the backlog. The broader [glyph-margin design issue #179725](https://github.com/microsoft/vscode/issues/179725) discusses a possible decoration `command` or selection event, but that text is a design proposal, not an Extension API contract.

## Stable alternatives

| Mechanism | What it gives PL/SQL users | Where it appears |
| --- | --- | --- |
| `DeclarationProvider` | Navigate from a package-body subprogram to its package-spec declaration | Standard **Go to Declaration** / Peek UI |
| `ImplementationProvider` | Navigate from a package-spec declaration to the matching body implementation | Standard **Go to Implementation** / Peek UI |
| `DefinitionProvider` | Resolve calls and references to the chosen canonical definition | Standard **Go to Definition** / Peek UI |
| `CodeLensProvider` | Explicit clickable `Go to body` / `Go to specification` commands | A dedicated horizontal line above the declaration |
| `InlayHintsProvider` | A compact clickable label part with either a command or navigation location | Inline with source text |
| Gutter decoration plus one of the above | JetBrains-like visual arrows plus real navigation elsewhere | Arrow in gutter; click target/shortcut outside it |

The three navigation providers are stable APIs registered through `languages.registerDefinitionProvider`, `registerDeclarationProvider`, and `registerImplementationProvider`. Their purpose and registration are documented in the official [`languages` API](https://code.visualstudio.com/api/references/vscode-api#languages) and [programmatic language-features guide](https://code.visualstudio.com/api/language-extensions/programmatic-language-features).

A [`CodeLens`](https://code.visualstudio.com/api/references/vscode-api#CodeLens) directly represents a `Command`, and a [`CodeLensProvider`](https://code.visualstudio.com/api/references/vscode-api#CodeLensProvider) adds those commands as horizontal lines between source lines. This is the closest stable, obviously clickable UI for a named `Go to body` / `Go to specification` action, but it is not a gutter icon.

An [`InlayHintLabelPart`](https://code.visualstudio.com/api/references/vscode-api#InlayHintLabelPart) has stable `command` and `location` properties. VS Code renders a part with a command as a clickable link; a location also enables code navigation. It is more compact than CodeLens but still appears in the text area, not in the gutter.

## Proposed API status

No general proposed API for clicking `TextEditorDecorationType` gutter icons is present in the current official [proposed-API catalog](https://github.com/microsoft/vscode/tree/main/src/vscode-dts). The gutter-related files visible there for Chat and the diff editor are empty contribution-menu placeholders, not a click API for text-editor decorations: [`contribChatEditorInlineGutterMenu`](https://github.com/microsoft/vscode/blob/main/src/vscode-dts/vscode.proposed.contribChatEditorInlineGutterMenu.d.ts) and [`contribDiffEditorGutterToolBarMenus`](https://github.com/microsoft/vscode/blob/main/src/vscode-dts/vscode.proposed.contribDiffEditorGutterToolBarMenus.d.ts).

Even if such an API appeared as proposed, VS Code documents proposed APIs as unstable, Insiders-only, and unavailable to published Marketplace extensions. See [Using proposed API](https://code.visualstudio.com/api/advanced-topics/using-proposed-api).

## Recommendation for this extension

Implement spec/body pairing as semantic navigation first:

- spec to body through `ImplementationProvider`;
- body to spec through `DeclarationProvider`;
- calls through `DefinitionProvider`;
- optional CodeLens commands for discoverability.

If visual parity matters, add opposite-direction gutter arrow decorations on the spec and body lines, but treat them as indicators only. Do not imply that the arrows themselves are clickable.
