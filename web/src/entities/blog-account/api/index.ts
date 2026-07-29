import { axiosInstance } from '@/app/config/axios';
import type { BlogAccount } from '../model';

export const getBlogAccountList = async (): Promise<BlogAccount[]> => {
  const { data } = await axiosInstance.get<{ accounts: BlogAccount[] }>('/api/blog-accounts');
  return data.accounts;
};

export const checkBlogCredential = async (
  accountId: string,
): Promise<{ ok: boolean; loginId?: string; blogId?: string; message?: string }> => {
  const { data } = await axiosInstance.get(
    `/api/blog-accounts/${encodeURIComponent(accountId)}/credential-check`,
  );
  return data;
};
