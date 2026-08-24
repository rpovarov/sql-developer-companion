# Performance baseline

Recorded: 2026-08-24

This baseline contains timings and repository metadata only. No proprietary
source text, filenames, database metadata, or connection information is
stored here.

## Environment

- SQL Developer Companion base commit: `fbf7bfa75fc3b2d8ff48da146282692ab70a987d`
  plus the `security-performance-hardening` working tree
- VS Code Extension Host smoke version: `1.134.0`
- Oracle SQL Developer test dependency: `26.2.1-win32-x64`
- Node.js: `v24.15.0`
- OS/architecture: Windows x64
- CPU: Intel Core Ultra 7 268V
- RAM: 33,895,956,480 bytes (approximately 31.6 GiB)

## Deterministic semantic-parser benchmark

Command:

```powershell
npm run benchmark -- C:\git\MIG_k2-msa\pkg
```

The benchmark warms up twice and measures seven parsing-only iterations. File
loading happens before the timer. Median and p95 are calculated from the seven
raw results.

| Dataset | Files | Bytes | Symbols | Median | p95 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Generated many-file fixture | 1,000 | 179,780 | 3,000 | 6.53 ms | 8.13 ms |
| Generated large-file fixture | 1 | 322,945 | 4,001 | 15.27 ms | 26.94 ms |
| Local PL/SQL package tree | 184 | 4,336,109 | 2,478 | 81.86 ms | 84.41 ms |

The local tree revision was
`64cd2604f14b76e70ab81f942653000be0865a61`.

These figures cover the semantic extraction added for repository navigation;
they do not include VS Code file discovery, disk reads, the legacy parser, or
other extensions. CI runs the generated fixtures as informational evidence.
A blocking regression threshold should be introduced only after several
stable CI runs; the initial candidate is a repeatable increase greater than
20% in both median and p95.

## Extension Host smoke baseline

The isolated smoke test downloads a clean VS Code profile, installs only the
required Oracle SQL Developer dependency, opens `examples/`, activates this
extension, explicitly re-indexes the workspace, and exercises three navigation
requests through the VS Code command API. The test has a three-minute outer
timeout and ten-to-thirty-second operation timeouts so a deadlock cannot hang
CI.

Run it with:

```powershell
npm run test:integration
```

The post-hardening examples run completed successfully with
`SMOKE_INDEX_MS=210`. This is an end-to-end command measurement inside the
Extension Host, not directly comparable with the parsing-only table above.

For a user-visible CPU profile on the large repository, use `Developer: Show
Running Extensions`, record initial indexing plus repeated edits and
Ctrl+Click, and save the resulting `.cpuprofile`. Record three cold runs before
using those observations as a release gate.
