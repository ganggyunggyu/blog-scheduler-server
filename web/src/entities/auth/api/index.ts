import { axiosInstance } from '@/app/config/axios';
import type { AppUser, LoginResponse, SignupParams } from '../model';

export const login = async (params: {
  username: string;
  password: string;
}): Promise<LoginResponse> => {
  const { data } = await axiosInstance.post('/api/auth/login', params);
  return { accessToken: data.accessToken, user: data.user };
};

export const fetchMe = async (): Promise<AppUser> => {
  const { data } = await axiosInstance.get('/api/auth/me');
  return data.user;
};

/** dabut 앱 계정을 새로 만든다. 가입 후 곧바로 로그인시킨다. */
export const signup = async (params: SignupParams): Promise<AppUser> => {
  const { data } = await axiosInstance.post('/api/auth/signup', {
    username: params.username,
    password: params.password,
    label: params.label ?? '',
  });
  return data.user;
};
