# Security and performance verification for the VS Code extension

Status: implementation checklist, verified against first-party documentation on 2026-08-24.

## Scope and current risk profile

SQL Developer Companion is a Node/TypeScript extension that reads workspace files, parses PL/SQL, contributes definition providers and renders one scripted Webview. It does not currently execute workspace code or spawn a shell. The main review surfaces are therefore:

- the Recent Objects Webview and messages crossing its process boundary;
- URI handling delegated to Oracle SQL Developer;
- npm and GitHub Actions dependencies;
- eager activation and repository-wide PL/SQL indexing in the shared Extension Host.

The current Webview already has a restrictive CSP with nonces and escapes values inserted through `innerHTML`. Two hardening gaps are visible: `localResourceRoots` is not explicitly restricted, and received messages are switched on without a runtime shape check. The `open` path subsequently resolves the URI against the extension's own recent-item list, which is a useful allow-list; the same principle should apply to `remove`.

The manifest includes `onStartupFinished`, and the indexer then finds, reads and parses all matching PL/SQL files sequentially. VS Code says this activation event runs after startup and does not delay startup itself, but the work still runs in the Extension Host, whose thread is shared with other extensions. The indexer already records a useful end-to-end duration in the Output channel.

## Security controls

### Webview

VS Code's official guidance is to grant the minimum capabilities, explicitly restrict local resources, define a CSP, load remote resources only over HTTPS, and sanitize all user-controlled content. If no local resource is needed, `localResourceRoots: []` is the strongest setting. Sanitization is defense in depth and does not replace CSP. See [Webview security](https://code.visualstudio.com/api/extension-guides/webview#security).

Repository acceptance criteria:

- `enableScripts` remains enabled only because the view requires interaction.
- `localResourceRoots` is explicitly `[]` unless a reviewed local resource is added later.
- CSP retains `default-src 'none'`; every executable script and inline style is nonce-authorized; no `unsafe-inline`, `unsafe-eval`, `http:` or wildcard source is introduced.
- All labels, paths, connection names, schema names, object names and other workspace/database values are inserted with DOM text APIs or the existing HTML escaping function. Add tests containing `<`, `>`, `&`, quotes and a script-shaped string.
- Treat `onDidReceiveMessage` input as `unknown`. Accept only a small discriminated union of known message types and primitive fields. Ignore malformed or unknown messages without throwing.
- `open` and `remove` may operate only on a URI present in the extension-owned recent-item list. Do not open a URI supplied solely by the Webview.
- Add focused tests for malformed messages and rejected unknown URIs.

The message validation bullets are a project-specific trust-boundary rule inferred from the Webview's ability to send JSON messages to the extension and VS Code's warning that Webview content is a security boundary; they are stricter than the examples in the API guide.

### Workspace Trust

VS Code asks extensions to declare `capabilities.untrustedWorkspaces` explicitly. `true` is appropriate only when all functionality is safe in Restricted Mode; `false` disables the extension; `limited` allows safe features while gating trust-sensitive paths. Workspace-derived settings that can affect execution can be placed in `restrictedConfigurations`. See the [Workspace Trust extension guide](https://code.visualstudio.com/api/extension-guides/workspace-trust).

For the present implementation, parsing text and returning editor locations does not execute workspace content, so `supported: true` is reasonable after the URI and Webview checks above. Re-evaluate this decision before adding any compiler, database script execution, child process, workspace-selected executable, dynamic module import or executable-path setting.

Acceptance criteria:

- `package.json` contains an intentional `capabilities.untrustedWorkspaces` declaration.
- An Extension Host smoke test opens the examples workspace in Restricted Mode and verifies activation/navigation does not execute content or fail unexpectedly.
- Any future execution-capable feature changes the declaration to `limited` or `false` and gates the code path with `workspace.isTrusted`, not merely a hidden command. VS Code notes that hidden commands can still be invoked directly.

### Dependencies and static analysis

`npm audit` submits the dependency tree from the lockfile to the registry and exits non-zero according to `audit-level`; `omit=dev` omits development dependencies from the submitted dependency tree. See the current [`npm audit` documentation](https://docs.npmjs.com/cli/v11/commands/npm-audit/).

GitHub recommends CodeQL default setup as the lowest-maintenance option. It scans supported languages on pushes to the default/protected branch, qualifying pull requests and a weekly schedule; JavaScript/TypeScript is supported. Do not configure both default and advanced setup for the same language. See [Code scanning setup types](https://docs.github.com/en/code-security/concepts/code-scanning/setup-types) and [CodeQL workflow language identifiers](https://docs.github.com/en/code-security/reference/code-scanning/workflow-configuration-options#languages-to-be-analyzed).

Dependabot alerts identify vulnerable dependencies from manifests/lockfiles. They require a one-time repository setting; a `dependabot.yml` separately schedules version-update pull requests. See [enabling Dependabot alerts](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/secure-your-dependencies/configure-dependabot-alerts) and [Dependabot version-update configuration](https://docs.github.com/en/code-security/dependabot/dependabot-version-updates/configuration-options-for-the-dependabot.yml-file).

Acceptance criteria:

- CI uses `npm ci` from the committed lockfile, then compiles and runs all tests.
- CI runs `npm audit --omit=dev --audit-level=high`. No high/critical production finding is accepted without a documented risk decision.
- A full `npm audit` is recorded for developer tooling. Its findings are triaged, but a tool-only advisory need not block a release when it cannot enter or affect the VSIX.
- CodeQL scans `javascript-typescript` through either default setup or one checked-in advanced workflow.
- Dependabot alerts are enabled in GitHub settings, and weekly npm plus GitHub Actions version updates are configured.
- CI packages the VSIX with `vsce`; the official publishing guide identifies `vsce package` as the supported packaging path. See [Publishing Extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension).
- The produced archive is inspected automatically for required grammar/example files and absence of secrets, source maps containing private paths, test fixtures with credentials, and unrelated generated files.

## Extension Host integration tests

VS Code distinguishes ordinary unit tests from integration tests that run inside an Extension Development Host with the real VS Code API. The official setup uses `@vscode/test-cli` and `@vscode/test-electron`; `--disable-extensions` isolates the run. The lower-level `@vscode/test-electron` API can install a required extension before launching tests. See [Testing Extensions](https://code.visualstudio.com/api/working-with-extensions/testing-extension) and [Continuous Integration](https://code.visualstudio.com/api/working-with-extensions/continuous-integration).

Because this extension declares `Oracle.sql-developer` as an extension dependency, the test harness must either install a pinned compatible Oracle extension into its isolated profile or explicitly document which smoke tests can run without it.

Minimum smoke suite over `examples/`:

1. Activate the extension and assert activation succeeds without uncaught errors.
2. Open package specification/body and object type specification/body examples; execute definition requests and assert the expected local files/ranges are among the results.
3. Open the Python example; assert an embedded SQL range is decorated and a package/type reference resolves into the PL/SQL examples.
4. Exercise the Recent Objects view with script-shaped display values and malformed/unknown messages; assert no HTML execution, arbitrary URI open or exception occurs.
5. Run with unrelated extensions disabled and in an isolated temporary user-data/extensions directory.

## Performance verification

VS Code runs extensions in the Extension Host and loads them lazily based on activation events. `onStartupFinished` is emitted after `*` extensions finish and is documented as not slowing startup, while targeted activation avoids unnecessary CPU/memory use. See [Activation Events](https://code.visualstudio.com/api/references/activation-events#onStartupFinished) and [Extension Host stability and performance](https://code.visualstudio.com/api/advanced-topics/extension-host#stability-and-performance).

### Reproducible baseline

Use both the small `examples/` workspace and a large real repository. Do not include database connection time in repository-index measurements.

1. Use a clean VS Code profile with the tested VSIX and its required Oracle dependency only.
2. Open the same workspace, run `Developer: Reload Window`, and capture three cold runs.
3. Record the extension's `Indexed N files with M unique symbols in Tms` line, activation timing from `Developer: Show Running Extensions`, and peak Extension Host CPU/memory from `Help: Open Process Explorer`.
4. Record a CPU profile from `Developer: Show Running Extensions` while initial indexing completes, then while editing/saving a large PL/SQL file and performing repeated Ctrl+Click navigation. VS Code's official troubleshooting procedure recommends this profiler and inspection of the resulting `.cpuprofile`. See [VS Code Performance Issues](https://github.com/microsoft/vscode/wiki/Performance-Issues#profile-the-running-extensions).
5. Save the workspace revision, VS Code version, extension commit, machine CPU/RAM, file count/bytes, three raw results and median. Without that metadata, before/after numbers are not comparable.

### Automated performance checks

- Add a deterministic benchmark around pure parsing/index extraction, using generated in-memory files rather than proprietary source. Include small, large-file and many-file cases.
- Run warm-up iterations, then multiple measured iterations; report median and p95 rather than a single sample.
- Keep a checked-in baseline report, but initially make CI informational. Set a blocking threshold only after stable CI data exists; a practical first guard is a statistically repeatable regression greater than 20% in both median and p95.
- Add a functional timeout to the Extension Host smoke test so an indexing deadlock cannot hang CI indefinitely. Do not treat a coarse CI timeout as a microbenchmark.
- Ensure cancellation/disposal during initial indexing remains tested, and test that one unreadable or malformed file does not abort the remaining index.

### Performance acceptance criteria

- The editor remains responsive during the large-repository scenario; the CPU profile shows no long synchronous parser/indexer block monopolizing the Extension Host.
- Initial indexing completes, reports file/symbol counts and does not grow retained memory after repeated reload/re-index cycles.
- Opening, changing and saving one file re-indexes that file rather than rescanning the workspace.
- Ctrl+Click latency is measured after index readiness and has no repeatable regression beyond the agreed baseline threshold.
- Any change to activation events or indexing concurrency is justified with before/after measurements and the same fixture/revision.

## Release gate

A candidate is ready for colleague testing when all unit and Extension Host smoke tests pass, CodeQL has no unresolved high-severity result, production dependency audit has no unaccepted high/critical advisory, the VSIX-content check passes, and a recorded large-workspace profile shows no Extension Host stall. A full `npm audit` report and non-blocking performance benchmark should be attached to the release notes or local issue even when they do not block the build.
