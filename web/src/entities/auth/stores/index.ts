import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { isAxiosError } from 'axios';
import { fetchMe, login as loginApi } from '../api';
import { clearToken, getStoredUsername, getToken, setStoredUsername, setToken } from '../lib';
import type { AppUser } from '../model';

export const useAuthStore = defineStore('scheduler-auth', () => {
  const user = ref<AppUser | null>(null);
  const isLoading = ref(false);
  const error = ref('');
  // 새로고침 직후 /me 응답 전에도 라우터 가드가 통과해야 해서 토큰 유무를 1차 기준으로 둔다.
  const hasToken = ref(Boolean(getToken()));

  const isAuthenticated = computed(() => hasToken.value);
  const displayName = computed(() => user.value?.label || user.value?.username || getStoredUsername());

  const login = async (username: string, password: string): Promise<boolean> => {
    isLoading.value = true;
    error.value = '';
    try {
      const result = await loginApi({ username, password });
      setToken(result.accessToken);
      setStoredUsername(result.user.username);
      hasToken.value = true;
      user.value = result.user;
      return true;
    } catch (e: unknown) {
      if (isAxiosError(e) && e.response?.status === 401) {
        error.value = '아이디 또는 비밀번호가 올바르지 않습니다.';
      } else if (isAxiosError(e) && e.response?.data?.message) {
        error.value = String(e.response.data.message);
      } else {
        error.value = '로그인에 실패했습니다. 서버 상태를 확인해주세요.';
      }
      return false;
    } finally {
      isLoading.value = false;
    }
  };

  const loadMe = async (): Promise<void> => {
    if (!getToken()) return;
    try {
      user.value = await fetchMe();
    } catch {
      logout();
    }
  };

  const logout = (): void => {
    clearToken();
    hasToken.value = false;
    user.value = null;
  };

  return { user, isLoading, error, isAuthenticated, displayName, login, loadMe, logout };
});
