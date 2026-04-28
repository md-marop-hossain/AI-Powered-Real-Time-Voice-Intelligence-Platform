import axios from "axios";
import { useAuthStore } from "@/store/auth";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

/**
 * Refresh the access token via the backend's /auth/refresh endpoint.
 * Returns the new access token, or throws if the refresh fails.
 * Mirrors the axios interceptor in lib/api.ts so streaming requests
 * stay authenticated even after the 15-minute access token expires.
 */
let refreshPromise: Promise<string> | null = null;

async function refreshAccessToken(): Promise<string> {
  const auth = useAuthStore.getState();
  if (!auth.refreshToken) throw new Error("No refresh token available");
  if (!refreshPromise) {
    refreshPromise = axios
      .post(`${API_URL}/api/v1/auth/refresh`, {
        refresh_token: auth.refreshToken,
      })
      .then((r) => {
        const { access_token, refresh_token } = r.data;
        useAuthStore.getState().setTokens(access_token, refresh_token);
        return access_token as string;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

/**
 * Stream a multipart upload to a server endpoint that responds with NDJSON.
 * Each newline-delimited JSON object in the response body is yielded as it arrives.
 * Handles 401 by refreshing the access token and retrying once.
 */
export async function* streamNdjsonUpload<T = unknown>(
  url: string,
  formData: FormData,
  init: { token?: string | null; signal?: AbortSignal } = {},
): AsyncGenerator<T> {
  let token = init.token ?? useAuthStore.getState().accessToken;

  const send = async (authToken: string | null): Promise<Response> => {
    const headers: Record<string, string> = {};
    if (authToken) headers.Authorization = `Bearer ${authToken}`;
    return fetch(url, {
      method: "POST",
      headers,
      body: formData,
      signal: init.signal,
    });
  };

  let response = await send(token);

  if (response.status === 401) {
    // Try to refresh once, then retry the upload with the new token.
    try {
      token = await refreshAccessToken();
    } catch (e) {
      useAuthStore.getState().clear();
      throw new Error("Session expired. Please sign in again.");
    }
    response = await send(token);
  }

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
