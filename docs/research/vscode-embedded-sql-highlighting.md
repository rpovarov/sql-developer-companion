# Embedded SQL highlighting in VS Code

Research date: 2026-08-24. Sources are limited to the official VS Code docs and API reference.

## Conclusion

Yes, VS Code can highlight SQL embedded inside another language, including Python strings, but the mechanism matters.

For plain syntax highlighting, the supported path is a TextMate injection grammar contributed through `grammars` with `injectTo`, optionally combined with `embeddedLanguages` and `tokenTypes`. VS Code documents this as the way to extend an existing grammar and to mark embedded content as another language for basic editor behavior such as bracket matching and snippet selection. See the official [Syntax Highlight Guide](https://code.visualstudio.com/api/language-extensions/syntax-highlight-guide) and [Contribution Points](https://code.visualstudio.com/api/references/contribution-points).

For richer symbol-aware behavior, VS Code also supports semantic tokens through `registerDocumentSemanticTokensProvider` or `registerDocumentRangeSemanticTokensProvider`. Those providers can color ranges with token types and modifiers, but they do not automatically turn a substring into a full foreign language mode. See the official [Semantic Highlight Guide](https://code.visualstudio.com/api/language-extensions/semantic-highlight-guide).

For full language features on embedded SQL, the supported route is a language feature implementation around virtual documents or similar indirection. VS Code's [Virtual Documents](https://code.visualstudio.com/api/extension-guides/virtual-documents) API lets an extension expose read-only text from arbitrary sources. That is useful when you want completions, hovers, validation, or cross-file navigation over extracted SQL, but it is a separate layer from syntax highlighting.

## What VS Code can do

| Mechanism | Best for | Limitations |
| --- | --- | --- |
| TextMate injection grammar (`injectTo`) | Color SQL text inside another language | Regex-based and lexical; it cannot reliably understand Python AST or project context |
| `embeddedLanguages` + `tokenTypes` | Tell VS Code that a matched scope should behave like SQL for basic editing features | Still depends on a grammar match; not a general language-injection engine |
| Semantic tokens | Context-aware coloring of selected ranges | Colors token ranges only; it does not give the editor a nested SQL parser by itself |
| Virtual documents | Full language features over extracted SQL | Requires extra plumbing; this is more than highlighting |

## Reusing another extension's grammar

The normal, supported path is to reuse the target language's scope names if they are available in the editor grammar model. In practice that means injecting into the host language scopes and, if needed, mapping a scope to SQL with `embeddedLanguages`.

What VS Code does not give you is a stable public API to "borrow" another installed extension's parser as a reusable service. An extension can depend on another extension being installed, but the highlighted region still has to be contributed through the current extension's own grammar, semantic tokens, or language features.

So for this repository, the realistic options are:

1. Add a TextMate injection grammar for likely SQL string patterns in Python.
2. Add a semantic-token pass if the goal is only better coloring of recognized SQL spans.
3. Add a separate embedded-document feature if you want completion, hover, and navigation inside extracted SQL.

## Practical recommendation

If the goal is "DataGrip-like SQL coloring inside Python strings", start with an injection grammar and keep the scope narrow and explicit. That is the smallest supported feature that fits VS Code's model.

If the goal is "SQL editor features inside Python strings", TextMate alone is not enough. You need a real embedded-document workflow or a language service that understands the extracted SQL.
