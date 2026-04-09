import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAccountLookupQuery,
  mapAccountRecord,
} from '../../src/services/account-directory.service.js';

test('buildAccountLookupQuery: accountId/blogId/nickname와 active 조건을 함께 구성함', () => {
  assert.deepEqual(buildAccountLookupQuery('bigfish773'), {
    $and: [
      {
        $or: [
          { isActive: { $exists: false } },
          { isActive: true },
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

test('mapAccountRecord: DB 레코드를 큐 계정 형식으로 변환함', () => {
  assert.deepEqual(mapAccountRecord({
    accountId: 'bigfish773',
    password: '%3p#lape1',
    nickname: '고래낚시',
    blogId: 'bigfish773',
    category: '추상의구체화',
  }), {
    id: 'bigfish773',
    password: '%3p#lape1',
    name: '고래낚시',
    blogId: 'bigfish773',
    category: '추상의구체화',
  });
});

test('mapAccountRecord: 필수 credential이 없으면 null을 반환함', () => {
  assert.equal(mapAccountRecord({
    accountId: 'bigfish773',
  }), null);
});
