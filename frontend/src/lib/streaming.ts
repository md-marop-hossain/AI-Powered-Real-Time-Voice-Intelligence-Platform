/**
 * Stream a multipart upload to a server endpoint that responds with NDJSON.
 * Each newline-delimited JSON object in the response body is yielded as it arrives.
 */
export async function* streamNdjsonUpload<T = unknown>(
  url: string,
  formData: FormData,
  init: { token?: string | null; signal?: AbortSignal } = {},
): AsyncGenerator<T> {
  const headers: Record<string, string> = {};
  if (init.token) headers.Authorization = `Bearer ${init.token}`;

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: formData,
    signal: init.signal,
  });

  if (!response.ok || !response.body) {
    let detail = response.statusText;
    try {
      const j = await response.json();
      detail = j.detail ?? detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newlineIdx: number;
    while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newlineIdx).trim();
      buffer = buffer.slice(newlineIdx + 1);
      if (!line) continue;
      try {
        yield JSON.parse(line) as T;
      } catch {
        // Skip malformed lines — don't crash the whole stream.
      }
    }
  }
  // Flush any trailing line.
  const tail = buffer.trim();
  if (tail) {
    try {
      yield JSON.parse(tail) as T;
    } catch {
      /* ignore */
    }
  }
}
