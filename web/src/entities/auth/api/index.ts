import { axiosInstance } from '@/app/config/axios';
import type { AppUser, LoginResponse } from '../model';

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
