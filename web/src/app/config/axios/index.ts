import axios from 'axios';
import { getToken, clearToken } from '@/entities/auth/lib';

export const axiosInstance = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? '',
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
});

axiosInstance.interceptors.request.use((config) => {
  const token = getToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

axiosInstance.interceptors.response.use(
  (response) => response,
  (error) => {
    // 토큰이 죽으면 라우터 가드가 잡도록 지우고 로그인으로 되돌린다.
    if (error.response?.status === 401 && getToken()) {
      clearToken();
      window.location.assign('/login');
    }
    return Promise.reject(error);
  },
);
