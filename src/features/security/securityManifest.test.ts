import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repositoryRoot = path.resolve(__dirname, '../../..');

test('manifest explicitly supports parse-only features in untrusted workspaces', () => {
    const manifest = JSON.parse(readFileSync(
        path.join(repositoryRoot, 'package.json'),
        'utf8',
    )) as {
        capabilities?: {
            untrustedWorkspaces?: { supported?: boolean | 'limited' };
        };
    };

    assert.deepEqual(manifest.capabilities?.untrustedWorkspaces, {
        supported: true,
    });
});

