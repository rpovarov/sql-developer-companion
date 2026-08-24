# SQL Developer Companion examples

This directory is a compact, fictional workspace for manually exercising the
extension. It contains no production names, connection details, credentials,
or copied business logic.

## Files

| File | Demonstrates |
| --- | --- |
| `demo_repository_api.pks` / `.pkb` | Package specification/body counterpart navigation, overloads, defaults, a private forward declaration, and object method calls |
| `demo_item_type.tps` / `.tpb` | Object type specification/body counterpart navigation, overloaded constructors and methods, plus a static method |
| `demo_special_item.sql` | Collection types, `UNDER`, specification/body counterparts in one file, an inherited member call, and `TREAT(... AS type)` |
| `embedded_sql_examples.py` | Every supported Python SQL injection form and repository Ctrl+Click into the PL/SQL files above |

## Manual checks

Open the repository root as the VS Code workspace and wait for the PL/SQL index
to finish.

1. In each spec/body counterpart, use the gutter arrows and the Definition,
   Declaration, and Implementation commands on matching members.
2. In `demo_repository_api.pks`, Ctrl+Click `demo_item_type` in parameter and
   return positions.
3. In `demo_repository_api.pkb`, Ctrl+Click calls on `l_item`, `l_items(1)`,
   and the overloaded `score` member.
4. In `demo_special_item.sql`, navigate between the same-file object type
   specification/body counterparts,
   follow `UNDER demo_item_type`, the inherited `self.display_name()` call, and
   the `TREAT` target.
5. In `embedded_sql_examples.py`, verify Oracle colors and the subtle
   background for named triple strings, raw strings, f-strings, implicit
   concatenation, and direct `execute` arguments.
6. In the embedded PL/SQL block, Ctrl+Click `demo_repository_api`,
   `reserve_item`, `demo_item_type`, and `from_json`. Named arguments select the
   intended overload. Ordinary Python names outside SQL remain handled by the
   Python extension.

Dynamic identifiers inside `{...}`, unqualified PL/SQL calls, and identifiers
split across adjacent string fragments are deliberately not navigation targets.

These files are editor fixtures, not an installation bundle. If compiling them
in Oracle, use this dependency order: `.tps`, `.tpb`, `.sql`, `.pks`, `.pkb`.
