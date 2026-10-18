export async function api<T = unknown>(path: string, body?: unknown): Promise<T> {
  const form = body instanceof FormData;
  const res = await fetch(`/api/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined || form ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : form ? body : JSON.stringify(body),
    cache: "no-store",
  });
  const result = await res.json();
  if (!res.ok) throw new Error(result.error || "操作未完成");
  return result;
}
