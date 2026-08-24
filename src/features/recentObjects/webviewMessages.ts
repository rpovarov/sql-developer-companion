import type { RecentItem } from './recentObjectsManager';

export type RecentObjectsAction =
    | { type: 'open'; item: RecentItem }
    | { type: 'remove'; uriString: string }
    | { type: 'clearHistory' }
    | { type: 'ready' };

/** Validate a message crossing from the scripted Webview into the Extension Host. */
export function resolveRecentObjectsMessage(
    message: unknown,
    items: readonly RecentItem[],
): RecentObjectsAction | undefined {
    if (!isRecord(message) || typeof message.type !== 'string') {
        return undefined;
    }
    if (message.type === 'clearHistory' || message.type === 'ready') {
        return { type: message.type };
    }
    if ((message.type !== 'open' && message.type !== 'remove') ||
        typeof message.uriString !== 'string') {
        return undefined;
    }

    const item = items.find(candidate => candidate.uriString === message.uriString);
    if (!item) {
        return undefined;
    }
    return message.type === 'open'
        ? { type: 'open', item }
        : { type: 'remove', uriString: item.uriString };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

