import { useMutation, useQuery } from '@tanstack/vue-query';
import { checkBlogCredential, getBlogAccountList } from '../api';

export const blogAccountKeys = {
  all: ['blog-accounts'] as const,
  list: () => [...blogAccountKeys.all, 'list'] as const,
};

export const useBlogAccounts = () =>
  useQuery({
    queryKey: blogAccountKeys.list(),
    queryFn: getBlogAccountList,
    staleTime: 60_000,
  });

export const useCredentialCheck = () => useMutation({ mutationFn: checkBlogCredential });
