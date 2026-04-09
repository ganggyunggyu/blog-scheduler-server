export type LoginFailureCategory =
  | 'network_unstable'
  | 'rate_limited'
  | 'captcha_required'
  | 'two_factor_required'
  | 'account_locked'
  | 'invalid_credentials'
  | 'account_not_found'
  | 'session_unstable'
  | 'login_incomplete'
  | 'unknown_login'
  | 'not_login_failure';

export interface LoginFailureAssessment {
  category: LoginFailureCategory;
  isLoginFailure: boolean;
  retryable: boolean;
  scope: 'account' | 'job' | 'none';
  normalizedMessage: string;
}

interface LoginFailureRule {
  category: Exclude<LoginFailureCategory, 'unknown_login' | 'not_login_failure'>;
  patterns: string[];
  retryable: boolean;
  scope: 'account' | 'job';
  canonicalMessage?: string;
}

interface AssessLoginFailureOptions {
  allowGenericFallback?: boolean;
  forceLoginContext?: boolean;
}

const NETWORK_UNSTABLE_MESSAGE = '로그인 실패: 접속하신 네트워크 환경이 불안정합니다. 다른 네트워크를 이용하시거나 잠시 후 다시 시도하세요.';
const LOGIN_RATE_LIMIT_MESSAGE = '로그인 재시도 제한에 걸렸습니다. 잠시 후 다시 시도하세요.';
const LOGIN_INCOMPLETE_MESSAGE = '로그인 실패: 로그인 페이지에 머물러 있습니다.';
const UNKNOWN_LOGIN_MESSAGE = '로그인 실패: 원인을 알 수 없습니다.';

const LOGIN_FAILURE_RULES: LoginFailureRule[] = [
  {
    category: 'account_locked',
    patterns: ['계정 잠금', '보호조치', '이용이 제한', '휴면 아이디'],
    retryable: false,
    scope: 'account',
  },
  {
    category: 'invalid_credentials',
    patterns: [
      '비밀번호 오류',
      '비밀번호를 다시 확인',
      '아이디 또는 비밀번호',
      '비밀번호가 일치하지',
      '입력하신 정보가 일치하지 않습니다',
    ],
    retryable: false,
    scope: 'account',
  },
  {
    category: 'account_not_found',
    patterns: ['존재하지 않는 계정', '존재하지 않는 아이디', '아이디를 확인해주세요'],
    retryable: false,
    scope: 'account',
  },
  {
    category: 'captcha_required',
    patterns: ['보안문자 입력 필요', '보안문자 자동 풀기 실패', '캡차 필요', 'captcha'],
    retryable: false,
    scope: 'account',
  },
  {
    category: 'two_factor_required',
    patterns: ['2차 인증이 필요합니다', '새로운 기기에서 로그인', '본인 확인이 필요합니다'],
    retryable: false,
    scope: 'account',
  },
  {
    category: 'network_unstable',
    patterns: [
      '접속하신 네트워크 환경이 불안정합니다',
      '다른 네트워크를 이용하시거나 잠시 후 다시 시도하세요',
    ],
    retryable: true,
    scope: 'job',
    canonicalMessage: NETWORK_UNSTABLE_MESSAGE,
  },
  {
    category: 'rate_limited',
    patterns: ['login rate limit exceeded', 'too many login attempts', '로그인 재시도 제한'],
    retryable: true,
    scope: 'job',
    canonicalMessage: LOGIN_RATE_LIMIT_MESSAGE,
  },
  {
    category: 'session_unstable',
    patterns: [
      'mainframe',
      'frame not found',
      'frame was detached',
      'execution context was destroyed',
      'target page, context or browser has been closed',
      'session expired',
      '세션 만료',
    ],
    retryable: true,
    scope: 'job',
  },
  {
    category: 'login_incomplete',
    patterns: ['로그인이 완료되지 않았습니다', '로그인 페이지에 머물러 있습니다'],
    retryable: true,
    scope: 'job',
    canonicalMessage: LOGIN_INCOMPLETE_MESSAGE,
  },
];

const normalizeText = (value: string | null | undefined): string =>
  (value ?? '').replace(/\s+/g, ' ').trim();

const toComparableText = (value: string): string => normalizeText(value).toLowerCase();

const withLoginPrefix = (message: string): string => {
  const normalized = normalizeText(message);

  if (!normalized) {
    return UNKNOWN_LOGIN_MESSAGE;
  }

  if (
    normalized.startsWith('로그인 실패:')
    || normalized.startsWith('로그인 ')
    || normalized.startsWith('2차 인증')
    || normalized.startsWith('보안문자')
  ) {
    return normalized;
  }

  if (normalized === LOGIN_RATE_LIMIT_MESSAGE) {
    return normalized;
  }

  return `로그인 실패: ${normalized}`;
};

const matchesRule = (normalizedMessage: string, rule: LoginFailureRule): boolean => {
  const comparableMessage = toComparableText(normalizedMessage);
  return rule.patterns.some((pattern) => comparableMessage.includes(toComparableText(pattern)));
};

const buildRuleMessage = (rule: LoginFailureRule, normalizedMessage: string): string =>
  rule.canonicalMessage ?? withLoginPrefix(normalizedMessage);

const hasGenericLoginSignal = (normalizedMessage: string): boolean => {
  const comparableMessage = toComparableText(normalizedMessage);

  return (
    normalizedMessage.startsWith('로그인 실패:')
    || normalizedMessage.startsWith('로그인 ')
    || normalizedMessage.includes('로그인이 완료되지 않았습니다')
    || normalizedMessage.includes('로그인 페이지에 머물러 있습니다')
    || normalizedMessage.includes('2차 인증')
    || normalizedMessage.includes('보안문자')
    || normalizedMessage.includes('세션')
    || comparableMessage.includes('login failed')
    || comparableMessage.includes('session')
  );
};

export const assessLoginFailure = (
  message: string,
  options: AssessLoginFailureOptions = {}
): LoginFailureAssessment => {
  const normalizedMessage = normalizeText(message);
  const allowGenericFallback = options.allowGenericFallback ?? true;
  const forceLoginContext = options.forceLoginContext ?? false;

  for (const rule of LOGIN_FAILURE_RULES) {
    if (!matchesRule(normalizedMessage, rule)) continue;

    return {
      category: rule.category,
      isLoginFailure: true,
      retryable: rule.retryable,
      scope: rule.scope,
      normalizedMessage: buildRuleMessage(rule, normalizedMessage),
    };
  }

  if (allowGenericFallback && (forceLoginContext || hasGenericLoginSignal(normalizedMessage))) {
    return {
      category: 'unknown_login',
      isLoginFailure: true,
      retryable: true,
      scope: 'job',
      normalizedMessage: withLoginPrefix(normalizedMessage || LOGIN_INCOMPLETE_MESSAGE),
    };
  }

  return {
    category: 'not_login_failure',
    isLoginFailure: false,
    retryable: false,
    scope: 'none',
    normalizedMessage: withLoginPrefix(normalizedMessage || UNKNOWN_LOGIN_MESSAGE),
  };
};

export const inferLoginFailureMessage = (
  rawMessage?: string | null,
  pageText?: string | null
): string => {
  const candidates = [
    { value: rawMessage, allowGenericFallback: true },
    { value: pageText, allowGenericFallback: false },
  ];

  for (const candidate of candidates) {
    const normalized = normalizeText(candidate.value);
    if (!normalized) continue;

    const assessment = assessLoginFailure(normalized, {
      allowGenericFallback: candidate.allowGenericFallback,
    });

    if (assessment.isLoginFailure) {
      return assessment.normalizedMessage;
    }
  }

  if (normalizeText(rawMessage)) {
    return withLoginPrefix(rawMessage!);
  }

  if (normalizeText(pageText)) {
    return LOGIN_INCOMPLETE_MESSAGE;
  }

  return UNKNOWN_LOGIN_MESSAGE;
};
