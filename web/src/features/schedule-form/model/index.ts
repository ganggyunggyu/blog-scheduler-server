import type { DomainPreset, ManuscriptType } from '@/entities/schedule';

export interface ParsedTarget {
  keyword: string;
  businessName: string;
  manuscriptType: ManuscriptType;
}

export interface AccountBlock {
  uid: string;
  /** dabut 에 등록된 네이버 계정 id. 비어 있으면 아이디/비밀번호를 직접 넣는 모드. */
  dabutAccountId: string;
  accountId: string;
  password: string;
  blogName: string;
  rawKeywords: string;
  startOffset: 0 | 1;
}

export const createAccountBlock = (uid: string): AccountBlock => ({
  uid,
  dabutAccountId: '',
  accountId: '',
  password: '',
  blogName: '',
  rawKeywords: '',
  startOffset: 0,
});

/**
 * 한 줄에 하나씩 입력받는다.
 * 맛집처럼 업체명이 필요한 도메인은 `키워드 | 업체명` 으로 구분한다.
 */
export const parseTargets = (block: AccountBlock, preset: DomainPreset): ParsedTarget[] => {
  const lines = block.rawKeywords
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.map((line, index) => {
    const [keywordPart, businessPart] = line.split('|').map((part) => part.trim());

    const alternating = preset.alternatingTypes;
    const manuscriptType = alternating
      ? ((index + block.startOffset) % 2 === 0 ? alternating[0] : alternating[1])
      : preset.manuscriptType;

    return {
      keyword: keywordPart ?? '',
      businessName: businessPart ?? '',
      manuscriptType,
    };
  });
};

export interface ValidationIssue {
  level: 'error' | 'warning';
  message: string;
}

export const validateBlocks = (
  blocks: AccountBlock[],
  preset: DomainPreset,
): ValidationIssue[] => {
  const issues: ValidationIssue[] = [];
  const seenBusinessNames = new Map<string, string>();

  blocks.forEach((block, blockIndex) => {
    const label = block.accountId || block.blogName || `${blockIndex + 1}번 계정`;
    const targets = parseTargets(block, preset);

    // dabut 계정을 고른 경우엔 서버가 비밀번호를 꺼내 쓰므로 직접 입력을 요구하지 않는다.
    if (!block.dabutAccountId) {
      if (!block.accountId.trim()) {
        issues.push({
          level: 'error',
          message: `${blockIndex + 1}번 계정: 블로그를 고르거나 계정 ID를 넣어주세요.`,
        });
      }
      if (!block.password) {
        issues.push({ level: 'error', message: `${label}: 비밀번호가 비어 있습니다.` });
      }
    }
    if (!targets.length) {
      issues.push({ level: 'error', message: `${label}: 키워드가 없습니다.` });
    }

    targets.forEach((target, index) => {
      if (!target.keyword) {
        issues.push({ level: 'error', message: `${label} ${index + 1}번째 줄: 키워드가 비었습니다.` });
        return;
      }

      if (!preset.requiresBusinessName) return;

      if (!target.businessName) {
        issues.push({
          level: 'error',
          message: `${label} "${target.keyword}": 업체명이 없습니다. "키워드 | 업체명" 형식으로 넣어주세요.`,
        });
        return;
      }

      const owner = seenBusinessNames.get(target.businessName);
      if (owner) {
        issues.push({
          level: 'error',
          message: `업체명 "${target.businessName}" 이 ${owner} 와 ${label} 에서 중복됩니다.`,
        });
        return;
      }
      seenBusinessNames.set(target.businessName, label);
    });
  });

  return issues;
};
