import { readFile } from 'fs/promises';
import axios from 'axios';
import { createSign } from 'node:crypto';
import { env } from '../src/config/env.js';

const SPREADSHEET_ID = '1Wa7weETl8R7y4HX9GzjBkhri_iWZuk31KMld-Q-PzDg';
const NEW_SHEET_TITLE = '한려담원 Sonnet4.6 에이전트 테스트 (0408)';

interface Result {
  keyword: string;
  title: string;
  content: string;
  length?: number;
}

const encodeBase64Url = (str: string): string =>
  Buffer.from(str).toString('base64url');

const getToken = async (): Promise<string> => {
  const email = env.GOOGLE_SERVICE_ACCOUNT_EMAIL!;
  const privateKey = env.GOOGLE_PRIVATE_KEY!.replace(/\\n/g, '\n').trim();
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600, iat: now,
  };
  const unsigned = `${encodeBase64Url(JSON.stringify(header))}.${encodeBase64Url(JSON.stringify(payload))}`;
  const signer = createSign('RSA-SHA256');
  signer.update(unsigned); signer.end();
  const signature = signer.sign(privateKey).toString('base64url');
  const { data } = await axios.post('https://oauth2.googleapis.com/token',
    new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` }).toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );
  return data.access_token;
};

const main = async () => {
  const raw = await readFile('/tmp/hanryeo-sonnet-manuscripts.json', 'utf-8');
  const results: Result[] = JSON.parse(raw);
  const token = await getToken();

  console.log('새 시트 생성 중...');
  const { data: batchRes } = await axios.post(
    `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}:batchUpdate`,
    { requests: [{ addSheet: { properties: { title: NEW_SHEET_TITLE } } }] },
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const newGid = batchRes.replies[0].addSheet.properties.sheetId;
  console.log(`시트 생성: "${NEW_SHEET_TITLE}" (gid: ${newGid})`);

  const header = ['#', '키워드', '제목', '본문', '글자수', '모델'];
  const rows = results.map((r, i) => [
    String(i + 1), r.keyword, r.title, r.content, String(r.content.length), 'claude-sonnet-4-6 (agent)',
  ]);
  const values = [header, ...rows];
  const range = `'${NEW_SHEET_TITLE}'!A1:F${values.length}`;

  console.log(`데이터 쓰기: ${values.length}행...`);
  await axios.put(
    `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
    { values },
    { headers: { Authorization: `Bearer ${token}` } }
  );

  console.log(`✅ 10개 원고 내보내기 완료`);
  console.log(`URL: https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/edit#gid=${newGid}`);
};

main().catch(console.error);
