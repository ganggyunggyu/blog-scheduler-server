/*
  axios 인터셉터가 Pinia 를 거치지 않고 토큰을 읽어야 해서(순환 참조)
  토큰 저장소만 별도 모듈로 뺀다.
*/
const TOKEN_KEY = 'scheduler-access-token';
const USERNAME_KEY = 'scheduler-username';

export const getToken = (): string => localStorage.getItem(TOKEN_KEY) ?? '';

export const setToken = (token: string): void => {
  localStorage.setItem(TOKEN_KEY, token);
};

export const clearToken = (): void => {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USERNAME_KEY);
};

export const getStoredUsername = (): string => localStorage.getItem(USERNAME_KEY) ?? '';

export const setStoredUsername = (username: string): void => {
  localStorage.setItem(USERNAME_KEY, username);
};
