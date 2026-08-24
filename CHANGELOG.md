# Changelog

## 1.3.0 — 2026-08-24

- Added Oracle SQL syntax highlighting inside ordinary and raw triple-quoted
  Python strings assigned to SQL-like variable names.
- Added highlighting for implicitly concatenated string literals inside
  parenthesized SQL-like assignments, excluding commented-out fragments.
- Added mixed Oracle SQL/Python highlighting for triple-quoted SQL f-strings,
  preserving Python syntax inside `{...}` interpolation.
- Added highlighting for triple-quoted SQL passed directly to `execute` and
  `executemany` methods, including first arguments moved to the following line.
- Added mixed Oracle SQL/Python highlighting for adjacent single-line f-strings
  used as a following-line `execute` or `executemany` first argument.
- Added highlighting for ordinary and raw single-line SQL strings used in the
  same following-line direct-execution form.
- Reused Oracle SQL Developer's grammar so embedded SQL follows the active
  Oracle SQL syntax theme.
- Added a subtle theme-aware background for embedded SQL, with an opt-out
  setting and a customizable workbench color.
- Added theme-aware lexical scopes for qualified PL/SQL calls, named arguments,
  and bind variables inside every supported Python SQL injection context.
- Added repository Definition, Declaration, and Implementation navigation from
  static PL/SQL package/type references in embedded Python SQL, including
  overload filtering by argument count and named arguments.
- Required named parameters now exclude incompatible overloads from Python
  Definition and Peek results.
- Added a compact, fictional `examples/` workspace covering supported package,
  object type, Python injection, and repository navigation forms.

## 1.2.0 — 2026-08-21

- Personal fork release based on upstream `1.1.2`.
- Added semantic navigation between package and object type specifications and bodies through Definition, Declaration, and Implementation commands.
- Added direct member and constructor pairing by normalized overload signatures, including private forward declarations and safe ambiguous Peek results.
- Added repository Go to Definition for schema-level object and collection type references, returning every local specification/body alongside any database definitions contributed by Oracle SQL Developer.
- Recognized schema type targets in Oracle `TREAT(... AS type)` expressions, including nested expressions and qualified type names.
- Added PL/SQL indexing and language association for `.tps` and `.tpb` type files.
- Added receiver-aware repository navigation for Oracle object method calls on `self`, declared variables/parameters/attributes, and schema collection elements, including inherited methods and overload filtering.
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
