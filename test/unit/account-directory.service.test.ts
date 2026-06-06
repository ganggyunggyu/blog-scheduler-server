import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAccountLookupQuery,
  mapAccountRecord,
} from '../../src/services/account-directory.service.js';

test('buildAccountLookupQuery: accountId/blogId/nickname와 scheduler 원장 활성 조건을 함께 구성함', () => {
  assert.deepEqual(buildAccountLookupQuery('bigfish773'), {
    $and: [
      {
        $or: [
          { isEnabled: { $exists: false } },
          { isEnabled: true },
        ],
      },
      {
        $or: [
          { accountId: 'bigfish773' },
          { blogId: 'bigfish773' },
          { nickname: 'bigfish773' },
        ],
      },
    ],
  });
});

test('mapAccountRecord: DB 레코드를 원장 계정 형식으로 변환함', () => {
  assert.deepEqual(mapAccountRecord({
    accountId: 'bigfish773',
    nickname: '고래낚시',
    blogId: 'bigfish773',
    category: '추상의구체화',
  }), {
    id: 'bigfish773',
    password: undefined,
    name: '고래낚시',
    blogId: 'bigfish773',
    category: '추상의구체화',
  });
});

test('mapAccountRecord: accountId가 없으면 null을 반환함', () => {
  assert.equal(mapAccountRecord({
    nickname: '고래낚시',
  }), null);
});
