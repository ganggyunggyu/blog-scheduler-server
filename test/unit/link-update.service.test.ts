import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.MONGO_URI ??= 'mongodb://localhost:27017/test';

const loadLinkUpdateService = async () =>
  import('../../src/services/link-update.service.js');

test('prepareLinkUpdatePairs: 입력 순서와 파싱된 키워드 정보를 유지함', async () => {
  const { prepareLinkUpdatePairs } = await loadLinkUpdateService();

  const [prepared] = prepareLinkUpdatePairs(
    [
      {
        inputIndex: 3,
        keyword: '흑염소진액먹는법:한려담원',
        blogId: 'regular14631',
        logNo: '224250994305',
        matchedAccount: {
          id: 'regular14631',
          password: 'secret',
          name: '소원',
          blogId: 'regular14631',
        },
      },
    ],
    '2026-04-14T17:00:00+09:00',
  );

  assert.deepEqual(prepared, {
    inputIndex: 3,
    rawKeyword: '흑염소진액먹는법:한려담원',
    keyword: '흑염소진액먹는법',
    category: '한려담원',
    blogId: 'regular14631',
    logNo: '224250994305',
    matchedAccount: {
      id: 'regular14631',
      password: 'secret',
      name: '소원',
      blogId: 'regular14631',
    },
    scheduledAt: '2026-04-14T17:00:00+09:00',
  });
});

test('buildLinkUpdateUtmAccount: UTM append용 계정 payload를 생성함', async () => {
  const { buildLinkUpdateUtmAccount } = await loadLinkUpdateService();

  assert.deepEqual(
    buildLinkUpdateUtmAccount('소원', [
      {
        inputIndex: 0,
        rawKeyword: '흑염소진액먹는법',
        keyword: '흑염소진액먹는법',
        blogId: 'regular14631',
        logNo: '224250994305',
        matchedAccount: {
          id: 'regular14631',
          password: 'secret',
          name: '소원',
          blogId: 'regular14631',
        },
        scheduledAt: '2026-04-14T17:00:00+09:00',
      },
      {
        inputIndex: 1,
        rawKeyword: '흑염소진액효과',
        keyword: '흑염소진액효과',
        blogId: 'regular14631',
        logNo: '224250994306',
        matchedAccount: {
          id: 'regular14631',
          password: 'secret',
          name: '소원',
          blogId: 'regular14631',
        },
        scheduledAt: '2026-04-14T17:05:00+09:00',
      },
    ]),
    {
      name: '소원',
      items: [
        {
          keyword: '흑염소진액먹는법',
          scheduledAt: new Date('2026-04-14T17:00:00+09:00'),
        },
        {
          keyword: '흑염소진액효과',
          scheduledAt: new Date('2026-04-14T17:05:00+09:00'),
        },
      ],
    },
  );
});
