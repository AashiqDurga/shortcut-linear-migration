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
    throw new Error(json.errors[0].message);
  }
  return json.data;
}

// Small delay to avoid hitting rate limits during migration
export const delay = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));
