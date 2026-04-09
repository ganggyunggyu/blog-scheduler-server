# 큐 클린업

모든 BullMQ 큐를 완전히 비웁니다 (waiting, active, completed, failed, delayed 전부).

## 실행 흐름

### 1단계: obliterate 스크립트 실행

```typescript
import IORedis from 'ioredis';
import { Queue } from 'bullmq';
import { env } from './src/config/env.js';

const connection = { host: env.REDIS_HOST, port: env.REDIS_PORT, db: env.REDIS_DB };
const redis = new IORedis(connection);

const keys = await redis.keys('bull:*');
const queueNames = [...new Set(keys.map(k => k.split(':')[1]).filter(Boolean))];

for (const name of queueNames) {
  try {
    const q = new Queue(name, { connection });
    await q.obliterate({ force: true });
    await q.close();
  } catch {}
}

console.log(`obliterated ${queueNames.length} queues`);
await redis.quit();
```

위 스크립트를 `_tmp_clean.mts`에 저장하고 `npx tsx`로 실행한 뒤 파일을 삭제합니다.

### 2단계: 대시보드 확인

```bash
curl -s http://localhost:8001/api/queues/dashboard | jq '.totals'
```

generate/publish 모두 0인지 확인하고 결과를 사용자에게 알려줍니다.
