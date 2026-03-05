// Client-side API helpers — call the local proxy routes

export async function shortcutRequest<T>(
  token: string,
  method: "GET" | "POST",
  path: string,
  options?: { params?: Record<string, string>; body?: unknown }
): Promise<T> {
  const res = await fetch("/api/shortcut", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, method, path, ...options }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Shortcut ${method} /${path} → ${res.status}: ${text}`);
  }
  return res.json();
}

export async function linearRequest<T>(
  token: string,
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const res = await fetch("/api/linear", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, query, variables }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Linear API error ${res.status}: ${text}`);
  }
  const json = await res.json();
  if (json.errors?.length) {
    // Include extensions detail so transient vs validation errors are distinguishable
    const first = json.errors[0];
    const detail = first.extensions
      ? `${first.message} [${JSON.stringify(first.extensions)}]`
      : first.message;
    throw new Error(detail);
  }
  return json.data;
}

// Small delay to avoid hitting rate limits during migration
export const delay = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

// Transient server-side errors that are safe to retry (not user/input errors)
function isTransientError(err: unknown): boolean {
  const msg = String(err).toLowerCase();
  return (
    msg.includes("query runner already released") ||
    msg.includes("connection") ||
    msg.includes("econnreset") ||
    msg.includes("socket hang up") ||
    msg.includes("etimedout") ||
    msg.includes("service unavailable") ||
    msg.includes("internal server error")
  );
}

// Retry a function up to maxAttempts times on transient errors, with exponential backoff.
// Non-transient errors (bad input, validation, etc.) throw immediately.
export async function withRetry<T>(
  fn: () => Promise<T>,
  { maxAttempts = 3, baseDelayMs = 1500, label = "" } = {}
): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const transient = isTransientError(err);
      if (!transient || attempt === maxAttempts) throw err;
      const wait = baseDelayMs * attempt;
      console.warn(`[retry] ${label} attempt ${attempt} failed (transient), retrying in ${wait}ms…`, err);
      await delay(wait);
    }
  }
  throw new Error("withRetry: unreachable");
}
