import { z } from 'zod';

/**
 * /api/queues/:accountId/clean 요청 스키마.
 *
 * 정리 대상은 이미 끝난 잡(completed/failed)뿐이다. waiting/active/delayed 를
 * 여기로 받으면 실행 중이거나 실행 예정인 예약이 통째로 사라진다. 큐를 비우려면
 * drain 을 쓴다.
 *
 * queue-manager 를 import 하면 redis 커넥션과 워커가 딸려오므로, 테스트에서
 * 그냥 불러 쓸 수 있도록 스키마만 여기 따로 둔다.
 */
export const cleanSchema = z.object({
  type: z.enum(['generate', 'publish']),
  /** 기본값은 completed. 쌓인 실패 잡을 걷어낼 때만 failed 로 준다. */
  status: z.enum(['completed', 'failed']).default('completed'),
  grace: z.number().min(0).default(0),
});

export type CleanRequest = z.infer<typeof cleanSchema>;
