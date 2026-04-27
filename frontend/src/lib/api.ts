import axios, { AxiosError, type InternalAxiosRequestConfig } from "axios";
import { useAuthStore } from "@/store/auth";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

export const api = axios.create({
  baseURL: `${API_URL}/api/v1`,
});

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = useAuthStore.getState().accessToken;
  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

let refreshPromise: Promise<string> | null = null;

api.interceptors.response.use(
  (resp) => resp,
  async (error: AxiosError) => {
    const original = error.config as InternalAxiosRequestConfig & {
      _retry?: boolean;
    };
    if (error.response?.status === 401 && !original._retry) {
      original._retry = true;
      const auth = useAuthStore.getState();
      if (!auth.refreshToken) {
        auth.clear();
        return Promise.reject(error);
      }
      try {
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
        const newToken = await refreshPromise;
        if (original.headers) {
          original.headers.Authorization = `Bearer ${newToken}`;
        }
        return api(original);
      } catch (e) {
        useAuthStore.getState().clear();
        return Promise.reject(e);
      }
    }
    return Promise.reject(error);
  },
);
