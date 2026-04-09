import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BLOG_UTM_CONVERTER_SHEET } from '../../src/constants/blog-utm-converter-sheet.js';

process.env.MONGO_URI ??= 'mongodb://localhost:27017/test';

const loadGoogleSheetsService = async () =>
  import('../../src/services/google-sheets.service.js');

test('parseGoogleSheetTarget: URL에서 spreadsheetId와 gid를 추출함', async () => {
  const { parseGoogleSheetTarget } = await loadGoogleSheetsService();

  assert.deepEqual(
    parseGoogleSheetTarget(BLOG_UTM_CONVERTER_SHEET.url),
    {
      spreadsheetId: BLOG_UTM_CONVERTER_SHEET.spreadsheetId,
      gid: BLOG_UTM_CONVERTER_SHEET.gid,
    },
  );
});

test('parseGoogleSheetTarget: 명시적 gid가 URL gid보다 우선함', async () => {
  const { parseGoogleSheetTarget } = await loadGoogleSheetsService();

  assert.deepEqual(
    parseGoogleSheetTarget(BLOG_UTM_CONVERTER_SHEET.url, '7'),
    {
      spreadsheetId: BLOG_UTM_CONVERTER_SHEET.spreadsheetId,
      gid: 7,
    },
  );
});

test('normalizeGooglePrivateKey: escaped newline을 실제 개행으로 바꿈', async () => {
  const { normalizeGooglePrivateKey } = await loadGoogleSheetsService();

  assert.equal(
    normalizeGooglePrivateKey('-----BEGIN PRIVATE KEY-----\\nline-1\\nline-2\\n-----END PRIVATE KEY-----\\n'),
    '-----BEGIN PRIVATE KEY-----\nline-1\nline-2\n-----END PRIVATE KEY-----',
  );
});

test('formatBlogUtmDateCode: scheduledAt에서 MMDD 형식 날짜코드를 추출함', async () => {
  const { formatBlogUtmDateCode } = await loadGoogleSheetsService();

  assert.equal(
    formatBlogUtmDateCode('2026-03-12T07:00:00+09:00'),
    '0312',
  );
});

test('buildBlogUtmSheetRows: medium에 MMDD+블로그명 형식을 사용함', async () => {
  const { buildBlogUtmSheetRows } = await loadGoogleSheetsService();

  const [row] = buildBlogUtmSheetRows(
    [
      {
        name: '테스트3',
        keyword: '90대 할머니 선물',
        scheduledAt: '2026-03-12T07:00:00+09:00',
      },
    ],
    79,
  );

  assert.deepEqual(row, [
    '',
    '79',
    BLOG_UTM_CONVERTER_SHEET.baseProductUrl,
    BLOG_UTM_CONVERTER_SHEET.source,
    '0312테스트3',
    '90대할머니선물',
    BLOG_UTM_CONVERTER_SHEET.defaultKeyword,
    'https://mkt.shopping.naver.com/link/69ae7140cabd8a23450de0c2?nt_source=blog&nt_medium=0312%ED%85%8C%EC%8A%A4%ED%8A%B83&nt_detail=90%EB%8C%80%ED%95%A0%EB%A8%B8%EB%8B%88%EC%84%A0%EB%AC%BC&nt_keyword=%EC%8B%A0%EB%A1%9C%EC%A7%81',
  ]);
});
