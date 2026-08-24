import path from 'node:path';
import { runTests, runVSCodeCommand } from '@vscode/test-electron';
import { withTimeout } from './withTimeout';

async function main(): Promise<void> {
    const repositoryRoot = path.resolve(__dirname, '../..');
    const version = process.env.VSCODE_TEST_VERSION ?? 'stable';

    if (process.env.SKIP_ORACLE_EXTENSION_INSTALL !== '1') {
        await runVSCodeCommand(
            ['--install-extension', 'Oracle.sql-developer', '--force'],
            { version, reuseMachineInstall: false },
        );
    }

    const run = runTests({
        version,
        reuseMachineInstall: false,
        extensionDevelopmentPath: repositoryRoot,
        extensionTestsPath: path.join(__dirname, 'suite', 'index.js'),
        launchArgs: [
            path.join(repositoryRoot, 'examples'),
            '--disable-updates',
            '--skip-welcome',
            '--skip-release-notes',
        ],
    });
    await withTimeout(run, 180_000, 'Extension Host smoke test timed out');
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
