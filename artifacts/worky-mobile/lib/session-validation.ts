type SessionValidationOptions = {
  retryDelaysMs?: readonly number[];
  wait?: (milliseconds: number) => Promise<void>;
};

export function getSessionValidationStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const value = error as { status?: unknown; response?: { status?: unknown } };
  if (typeof value.status === 'number') return value.status;
  if (typeof value.response?.status === 'number') return value.response.status;
  return undefined;
}

function isTransientFailure(status: number | undefined) {
  return status === undefined || status === 408 || status === 429 || status >= 500;
}

export async function loadAccountWithRetry<T>(
  load: () => Promise<T>,
  {
    retryDelaysMs = [1200, 2500],
    wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  }: SessionValidationOptions = {},
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await load();
    } catch (error) {
      if (attempt >= retryDelaysMs.length || !isTransientFailure(getSessionValidationStatus(error))) {
        throw error;
      }
      await wait(retryDelaysMs[attempt]);
    }
  }
}
