# Changelog

## 1.2.0 — 2026-08-21

- Personal fork release based on upstream `1.1.2`.
- Added semantic navigation between package and object type specifications and bodies through Definition, Declaration, and Implementation commands.
- Added direct member and constructor pairing by normalized overload signatures, including private forward declarations and safe ambiguous Peek results.
- Added repository Go to Definition for schema-level object and collection type references, returning every local specification/body alongside any database definitions contributed by Oracle SQL Developer.
- Recognized schema type targets in Oracle `TREAT(... AS type)` expressions, including nested expressions and qualified type names.
- Added PL/SQL indexing and language association for `.tps` and `.tpb` type files.
- Added live workspace indexing so unsaved repository documents immediately replace saved symbol locations and signatures.
- Added automated coverage for semantic matching, incremental indexing, malformed input, cancellation, and workspace boundaries.

## 1.1.2 — 2026-06-02

- Added `recentObjectsOpenAsPreview` setting to control whether recent objects open in preview mode or as pinned editors (default: pinned).
- Fixed double-click in the Recent Objects panel accidentally opening a different item after list reorder.
- Changed default for `highlightExecutedStatement` to `false` (disabled by default).

## 1.1.1 — 2026-05-05

- Added configurable highlight styles for executed statements (subtle, moderate, bold, border-only, custom).
- Default changed from harsh orange to a softer blue highlight.

## 1.1.0 — 2026-04-30

- Added PL/SQL Navigation: intra-package and local-file Go to Definition (Ctrl+Click), complementing Oracle's database-only navigation.
- Supported symbols: cursors, procedures, functions, variables, parameters, types, tables, and packages.
- Added cross-file workspace indexing for `.pks`, `.pkb`, `.sql`, `.pls`, `.plb`, `.pck` files.
- Added hover tooltips showing signatures and code snippets.
- Added package-aware navigation for qualified references (body/spec/both via setting).
- Added "Go to Local Definition" command (Alt+F12) and context menu entry.
- Added Statement Highlighter: highlights executed SQL in the editor.
- Added Connection Colors: tab badges and Peacock-style workspace coloring per connection.
- Added right-click context menu on connections to set badges and workspace colors.

## 1.0.0 — 2026-04-26

- Initial public release.
- Automatic tracking of recently viewed Oracle database objects.
- Sidebar "Recent Objects" panel in the SQL Developer explorer.
- Multi-select filters for connection, schema, and object type.
- Free-text name filtering.
- One-click reopen with automatic connection re-establishment.
- Remove individual items or clear full history.
- Command palette integration.
