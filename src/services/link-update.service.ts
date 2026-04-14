import type { ResolvedAccount } from './account-directory.service.js';
import { parseKeywordWithCategory } from './schedule.service.js';

export interface LinkUpdatePair {
  inputIndex: number;
  keyword: string;
  blogId: string;
  logNo: string;
  matchedAccount: ResolvedAccount;
}

export interface PreparedLinkUpdatePair {
  inputIndex: number;
  rawKeyword: string;
  keyword: string;
  category?: string;
  blogId: string;
  logNo: string;
  matchedAccount: ResolvedAccount;
  scheduledAt: string;
}

export const prepareLinkUpdatePairs = (
  pairs: LinkUpdatePair[],
  scheduledAt: string,
): PreparedLinkUpdatePair[] =>
  pairs.map((pair) => {
    const parsedKeyword = parseKeywordWithCategory(pair.keyword);

    return {
      inputIndex: pair.inputIndex,
      rawKeyword: pair.keyword,
      keyword: parsedKeyword.keyword,
      category: parsedKeyword.category,
      blogId: pair.blogId,
      logNo: pair.logNo,
      matchedAccount: pair.matchedAccount,
      scheduledAt,
    };
  });

export const buildLinkUpdateUtmAccount = (
  blogName: string,
  pairs: PreparedLinkUpdatePair[],
): {
  name: string;
  items: Array<{ keyword: string; scheduledAt: Date }>;
} => ({
  name: blogName,
  items: pairs.map(({ keyword, scheduledAt }) => ({
    keyword,
    scheduledAt: new Date(scheduledAt),
  })),
});
