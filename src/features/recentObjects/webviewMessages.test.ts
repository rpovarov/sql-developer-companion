import assert from 'node:assert/strict';
import test from 'node:test';
import { RecentItem } from './recentObjectsManager';
import { resolveRecentObjectsMessage } from './webviewMessages';

const item: RecentItem = {
    label: '<script>alert(1)</script>',
    uriString: 'dbtools:/demo/object/APP/PACKAGE/SAFE_API.pls',
    scheme: 'dbtools',
    timestamp: 1,
};

test('accepts only known recent-object actions and URIs', () => {
    assert.deepEqual(
        resolveRecentObjectsMessage(
            { type: 'open', uriString: item.uriString },
            [item],
        ),
        { type: 'open', item },
    );
    assert.deepEqual(
        resolveRecentObjectsMessage(
            { type: 'remove', uriString: item.uriString },
            [item],
        ),
        { type: 'remove', uriString: item.uriString },
    );
    assert.deepEqual(
        resolveRecentObjectsMessage({ type: 'clearHistory' }, [item]),
        { type: 'clearHistory' },
    );
    assert.deepEqual(
        resolveRecentObjectsMessage({ type: 'ready' }, [item]),
        { type: 'ready' },
    );
});

test('rejects malformed messages, unknown actions, and unknown URIs', () => {
    const rejected: unknown[] = [
        undefined,
        null,
        'open',
        {},
        { type: 1 },
        { type: 'unknown' },
        { type: 'open' },
        { type: 'open', uriString: 1 },
        { type: 'open', uriString: 'file:///not-in-history.sql' },
        { type: 'remove', uriString: 'file:///not-in-history.sql' },
    ];

    for (const message of rejected) {
        assert.equal(resolveRecentObjectsMessage(message, [item]), undefined);
    }
});

