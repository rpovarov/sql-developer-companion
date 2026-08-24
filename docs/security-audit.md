# Security audit

Audited: 2026-08-24  
Scope: SQL Developer Companion `1.3.0`, including the security/performance
hardening branch.

## Outcome

No known high or critical production dependency vulnerability remains. The
extension code does not spawn processes, evaluate generated JavaScript, load
dynamic workspace modules, or make its own network requests. Two concrete
Webview boundary gaps and one manifest ambiguity were found and fixed.

CodeQL results are intentionally not claimed here until the checked-in workflow
has run on GitHub. Oracle SQL Developer remains an external trusted dependency
and is outside this repository's code audit.

## Evidence

| Check | Result |
| --- | --- |
| `npm audit --omit=dev --audit-level=high` | 0 vulnerabilities |
| Full `npm audit` after removing Mocha | 0 vulnerabilities |
| TypeScript strict compilation | Pass |
| Unit suite | Pass; see CI/local test output |
| Isolated VS Code Extension Host smoke | Pass on VS Code 1.134.0 with Oracle SQL Developer 26.2.1 |
| VSIX central-directory allow/deny assertions | Required grammar/examples/runtime present; source, tests, maps, `.env`, `.scratch`, CI and benchmark files excluded |

The initial integration-test proposal used Mocha. Its dependency graph produced
three development-only advisories, including one high-severity advisory. Mocha
was not needed by the Extension Host API, so it was removed rather than waived.

## Findings and remediation

### SDC-SEC-001 — Webview accepted unvalidated messages

Severity: medium  
Status: fixed

`onDidReceiveMessage` previously switched directly on an untyped object, and
the remove action accepted any supplied URI. A pure runtime validator now
accepts only `open`, `remove`, `clearHistory`, and `ready`; URI actions resolve
against the extension-owned recent-item list. Malformed input, unknown actions,
and unknown URIs are ignored. Focused regression tests cover the boundary.

### SDC-SEC-002 — Webview local resource access was implicit

Severity: low  
Status: fixed

The Recent Objects Webview needs inline nonce-authorized CSS/JavaScript but no
workspace or extension files. Its options now set `localResourceRoots: []`.
The existing CSP retains `default-src 'none'`, nonce-limited scripts/styles,
and no remote source. Display values continue to pass through DOM text escaping.

### SDC-SEC-003 — Workspace Trust behavior was undeclared

Severity: low  
Status: fixed

The manifest now explicitly declares
`capabilities.untrustedWorkspaces.supported: true`. Current workspace handling
only reads and parses text; it does not execute workspace content. A manifest
test locks the decision. Any future shell, compiler, script execution, dynamic
module loading, or workspace-selected executable must revisit this declaration.

## Supply-chain controls

- The lockfile is committed and CI installs with `npm ci`.
- Production audit is blocking at high severity; the complete developer audit
  is reported separately so build-only findings can be triaged explicitly.
- `@vscode/vsce` and `@vscode/test-electron` are exact devDependency versions.
- CI and CodeQL Actions are pinned to immutable commit SHAs; Dependabot tracks
  both npm and GitHub Actions weekly.
- CodeQL scans `javascript-typescript` on main, pull requests, and weekly.
- VSIX packaging and central-directory inspection run in CI before artifact
  upload.

## Residual/manual checks

- Enable Dependabot alerts in the fork's GitHub security settings. The checked-in
  `dependabot.yml` controls update pull requests but cannot enable alerts itself.
- Review the first CodeQL run and record any alert disposition before sharing a
  release candidate.
- Keep the Oracle extension version used for manual testing in release notes;
  its implementation and marketplace delivery are a separate trust boundary.
- A saved CPU profile from the proprietary large workspace remains a manual
  release artefact because VS Code records it interactively.

