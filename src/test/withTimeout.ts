export async function withTimeout<T>(
    work: PromiseLike<T>,
    timeoutMs: number,
    message: string,
): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
        return await Promise.race([
            Promise.resolve(work),
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
