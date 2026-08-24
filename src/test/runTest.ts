import path from 'node:path';
import { runTests, runVSCodeCommand } from '@vscode/test-electron';

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

async function withTimeout<T>(
    work: Promise<T>,
    timeoutMs: number,
    message: string,
): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
        return await Promise.race([
            work,
            new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new Error(message)), timeoutMs);
            }),
        ]);
    } finally {
        if (timer) {
            clearTimeout(timer);
        }
    }
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});

