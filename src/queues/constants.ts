export const QUEUES = {
  GENERATE: 'generate',
  PUBLISH: 'publish',
} as const;

export const defaultJobOptions = {
  attempts: 3,
  backoff: {
    type: 'exponential' as const,
    delay: 60000,
  },
  removeOnComplete: 100,
  removeOnFail: 50,
};

export const NON_RETRYABLE_ERRORS = [
  '계정 잠금',
  '비밀번호 오류',
  '캡차 필요',
  '존재하지 않는 계정',
];
