import axios from 'axios';
import { createSign } from 'node:crypto';
import { env } from '../config/env.js';
import { BLOG_UTM_CONVERTER_SHEET } from '../constants/blog-utm-converter-sheet.js';
import { logger } from '../lib/logging/logger.js';
import { calculateSchedule, type ScheduleItem, type ScheduleMode } from './schedule.service.js';

const GOOGLE_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_SHEETS_API_BASE_URL = 'https://sheets.googleapis.com/v4/spreadsheets';
const GOOGLE_SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const GOOGLE_TOKEN_EXPIRY_BUFFER_SECONDS = 60;
const DEFAULT_RANGE = 'A:ZZ';

const log = logger.child({ scope: 'GoogleSheets' });

interface GoogleSheetsMetadataResponse {
  sheets?: Array<{
    properties?: {
      sheetId?: number;
      title?: string;
    };
  }>;
}

interface GoogleSheetsValuesResponse {
  range?: string;
  values?: string[][];
}

interface GoogleAccessTokenResponse {
  access_token: string;
  expires_in: number;
}

interface CachedGoogleAccessToken {
  accessToken: string;
  expiresAt: number;
}

export interface GoogleSheetTarget {
  spreadsheetId: string;
  gid?: number;
}

export interface ReadGoogleSheetValuesOptions {
  spreadsheet: string;
  gid?: number | string;
  range?: string;
}

export interface GoogleSheetValuesResult {
  spreadsheetId: string;
  gid?: number;
  sheetTitle: string;
  range: string;
  values: string[][];
}

let cachedGoogleAccessToken: CachedGoogleAccessToken | null = null;

export const normalizeGooglePrivateKey = (privateKey: string): string =>
  privateKey.replace(/\\n/g, '\n').trim();

const parseNumericGid = (gid?: number | string): number | undefined => {
  if (gid === undefined || gid === null || gid === '') return undefined;

  const parsed = typeof gid === 'number' ? gid : Number(gid);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid Google Sheet gid: ${gid}`);
  }

  return parsed;
};

const extractSpreadsheetIdFromUrl = (spreadsheetUrl: URL): string => {
  const match = spreadsheetUrl.pathname.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!match?.[1]) {
    throw new Error(`Invalid Google Sheet URL: ${spreadsheetUrl.toString()}`);
  }

  return match[1];
};

const extractGidFromUrl = (spreadsheetUrl: URL): number | undefined => {
  const searchGid = spreadsheetUrl.searchParams.get('gid');
  if (searchGid) {
    return parseNumericGid(searchGid);
  }

  const hashMatch = spreadsheetUrl.hash.match(/gid=(\d+)/);
  if (hashMatch?.[1]) {
    return parseNumericGid(hashMatch[1]);
  }

  return undefined;
};

export const parseGoogleSheetTarget = (
  spreadsheet: string,
  explicitGid?: number | string,
): GoogleSheetTarget => {
  const normalizedSpreadsheet = spreadsheet.trim();
  const overrideGid = parseNumericGid(explicitGid);

  if (/^https?:\/\//.test(normalizedSpreadsheet)) {
    const spreadsheetUrl = new URL(normalizedSpreadsheet);
    return {
      spreadsheetId: extractSpreadsheetIdFromUrl(spreadsheetUrl),
      gid: overrideGid ?? extractGidFromUrl(spreadsheetUrl),
    };
  }

  if (!/^[a-zA-Z0-9-_]+$/.test(normalizedSpreadsheet)) {
    throw new Error(`Invalid Google spreadsheet id: ${spreadsheet}`);
  }

  return {
    spreadsheetId: normalizedSpreadsheet,
    gid: overrideGid,
  };
};

const extractSheetTitleFromRange = (range: string): string | undefined => {
  const bangIndex = range.indexOf('!');
  if (bangIndex < 0) return undefined;

  const rawSheetTitle = range.slice(0, bangIndex).trim();
  if (rawSheetTitle.startsWith("'") && rawSheetTitle.endsWith("'")) {
    return rawSheetTitle.slice(1, -1).replace(/''/g, "'");
  }

  return rawSheetTitle;
};

const quoteSheetTitle = (sheetTitle: string): string =>
  `'${sheetTitle.replace(/'/g, "''")}'`;

const getGoogleServiceAccountCredentials = (): { email: string; privateKey: string } => {
  if (!env.GOOGLE_SERVICE_ACCOUNT_EMAIL) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_EMAIL is not configured');
  }

  if (!env.GOOGLE_PRIVATE_KEY) {
    throw new Error('GOOGLE_PRIVATE_KEY is not configured');
  }

  return {
    email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    privateKey: normalizeGooglePrivateKey(env.GOOGLE_PRIVATE_KEY),
  };
};

const encodeBase64Url = (value: string): string =>
  Buffer.from(value).toString('base64url');

const buildGoogleServiceAccountJwt = (email: string, privateKey: string): string => {
  const now = Math.floor(Date.now() / 1000);
  const header = {
    alg: 'RS256',
    typ: 'JWT',
  };
  const payload = {
    iss: email,
    scope: GOOGLE_SHEETS_SCOPE,
    aud: GOOGLE_OAUTH_TOKEN_URL,
    exp: now + 3600,
    iat: now,
  };

  const encodedHeader = encodeBase64Url(JSON.stringify(header));
  const encodedPayload = encodeBase64Url(JSON.stringify(payload));
  const unsignedToken = `${encodedHeader}.${encodedPayload}`;

  const signer = createSign('RSA-SHA256');
  signer.update(unsignedToken);
  signer.end();

  const signature = signer.sign(privateKey).toString('base64url');
  return `${unsignedToken}.${signature}`;
};

const getGoogleAccessToken = async (): Promise<string> => {
  const now = Math.floor(Date.now() / 1000);

  if (cachedGoogleAccessToken && cachedGoogleAccessToken.expiresAt > now + GOOGLE_TOKEN_EXPIRY_BUFFER_SECONDS) {
    return cachedGoogleAccessToken.accessToken;
  }

  const { email, privateKey } = getGoogleServiceAccountCredentials();
  const assertion = buildGoogleServiceAccountJwt(email, privateKey);

  log.info('google-sheets.token.request');

  const response = await axios.post<GoogleAccessTokenResponse>(
    GOOGLE_OAUTH_TOKEN_URL,
    new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }).toString(),
    {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 30000,
    },
  );

  cachedGoogleAccessToken = {
    accessToken: response.data.access_token,
    expiresAt: now + response.data.expires_in,
  };

  log.info('google-sheets.token.done', { expiresInSeconds: response.data.expires_in });

  return response.data.access_token;
};

const getGoogleSheetsMetadata = async (
  spreadsheetId: string,
  accessToken: string,
): Promise<GoogleSheetsMetadataResponse> => {
  log.info('google-sheets.metadata.request', { spreadsheetId });

  const response = await axios.get<GoogleSheetsMetadataResponse>(
    `${GOOGLE_SHEETS_API_BASE_URL}/${spreadsheetId}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: {
        fields: 'sheets.properties(sheetId,title)',
      },
      timeout: 30000,
    },
  );

  return response.data;
};

const resolveSheetFromMetadata = (
  metadata: GoogleSheetsMetadataResponse,
  gid?: number,
): { gid?: number; sheetTitle: string } => {
  const sheets = metadata.sheets ?? [];

  if (gid !== undefined) {
    const matchedSheet = sheets.find((sheet) => sheet.properties?.sheetId === gid);
    if (!matchedSheet?.properties?.title) {
      throw new Error(`Could not find a Google Sheet tab for gid=${gid}`);
    }

    return {
      gid,
      sheetTitle: matchedSheet.properties.title,
    };
  }

  const firstSheet = sheets[0]?.properties;
  if (!firstSheet?.title) {
    throw new Error('Could not resolve a default Google Sheet tab');
  }

  return {
    gid: firstSheet.sheetId,
    sheetTitle: firstSheet.title,
  };
};

const resolveSheetRange = async (
  spreadsheetId: string,
  accessToken: string,
  range: string,
  gid?: number,
): Promise<{ gid?: number; sheetTitle: string; resolvedRange: string }> => {
  const explicitSheetTitle = extractSheetTitleFromRange(range);
  if (explicitSheetTitle) {
    return {
      gid,
      sheetTitle: explicitSheetTitle,
      resolvedRange: range,
    };
  }

  const metadata = await getGoogleSheetsMetadata(spreadsheetId, accessToken);
  const resolvedSheet = resolveSheetFromMetadata(metadata, gid);

  return {
    gid: resolvedSheet.gid,
    sheetTitle: resolvedSheet.sheetTitle,
    resolvedRange: `${quoteSheetTitle(resolvedSheet.sheetTitle)}!${range}`,
  };
};

export const readGoogleSheetValues = async ({
  spreadsheet,
  gid,
  range = DEFAULT_RANGE,
}: ReadGoogleSheetValuesOptions): Promise<GoogleSheetValuesResult> => {
  const target = parseGoogleSheetTarget(spreadsheet, gid);
  const accessToken = await getGoogleAccessToken();
  const resolved = await resolveSheetRange(
    target.spreadsheetId,
    accessToken,
    range,
    target.gid,
  );

  log.info('google-sheets.values.request', {
    spreadsheetId: target.spreadsheetId,
    gid: resolved.gid,
    range: resolved.resolvedRange,
  });

  const response = await axios.get<GoogleSheetsValuesResponse>(
    `${GOOGLE_SHEETS_API_BASE_URL}/${target.spreadsheetId}/values/${encodeURIComponent(resolved.resolvedRange)}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: {
        majorDimension: 'ROWS',
      },
      timeout: 30000,
    },
  );

  const values = response.data.values ?? [];

  log.info('google-sheets.values.done', {
    spreadsheetId: target.spreadsheetId,
    gid: resolved.gid,
    sheetTitle: resolved.sheetTitle,
    rowCount: values.length,
  });

  return {
    spreadsheetId: target.spreadsheetId,
    gid: resolved.gid,
    sheetTitle: resolved.sheetTitle,
    range: resolved.resolvedRange,
    values,
  };
};

export const readBlogUtmConverterSheet = async (
  range: string = DEFAULT_RANGE,
): Promise<GoogleSheetValuesResult> =>
  readGoogleSheetValues({
    spreadsheet: BLOG_UTM_CONVERTER_SHEET.url,
    gid: BLOG_UTM_CONVERTER_SHEET.gid,
    range,
  });

export interface UpdateGoogleSheetValuesOptions {
  spreadsheet: string;
  gid?: number | string;
  range: string;
  values: string[][];
}

export interface UpdateGoogleSheetValuesResult {
  spreadsheetId: string;
  updatedRange: string;
  updatedRows: number;
}

interface GoogleSheetsUpdateResponse {
  updatedRange?: string;
  updatedRows?: number;
}

export const updateGoogleSheetValues = async ({
  spreadsheet,
  gid,
  range,
  values,
}: UpdateGoogleSheetValuesOptions): Promise<UpdateGoogleSheetValuesResult> => {
  const target = parseGoogleSheetTarget(spreadsheet, gid);
  const accessToken = await getGoogleAccessToken();
  const resolved = await resolveSheetRange(
    target.spreadsheetId,
    accessToken,
    range,
    target.gid,
  );

  log.info('google-sheets.update.request', {
    spreadsheetId: target.spreadsheetId,
    gid: resolved.gid,
    range: resolved.resolvedRange,
    rowCount: values.length,
  });

  const response = await axios.put<GoogleSheetsUpdateResponse>(
    `${GOOGLE_SHEETS_API_BASE_URL}/${target.spreadsheetId}/values/${encodeURIComponent(resolved.resolvedRange)}`,
    { values },
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: { valueInputOption: 'USER_ENTERED' },
      timeout: 30000,
    },
  );

  const { updatedRange = '', updatedRows = 0 } = response.data;

  log.info('google-sheets.update.done', {
    spreadsheetId: target.spreadsheetId,
    updatedRange,
    updatedRows,
  });

  return {
    spreadsheetId: target.spreadsheetId,
    updatedRange,
    updatedRows,
  };
};

export interface BlogUtmAccount {
  name: string;
  keywords: string[];
}

export interface BlogUtmScheduledAccount {
  name: string;
  items: Pick<ScheduleItem, 'keyword' | 'scheduledAt'>[];
}

export interface BlogUtmScheduledEntry {
  name: string;
  keyword: string;
  scheduledAt: string | Date;
}

const HEADER_ROW_COUNT = 6;
const EXAMPLE_ROW_COUNT = 3;
const DATA_START_ROW = HEADER_ROW_COUNT + EXAMPLE_ROW_COUNT + 1;

const MEDIUM_COL = 4;
const DETAIL_COL = 5;
const CAMPAIGN_URL_COL = 7;

const normalizeUtmKey = (value: string): string =>
  value.replace(/\s/g, '').toLowerCase();

export const formatBlogUtmDateCode = (scheduledAt: string | Date): string => {
  if (typeof scheduledAt === 'string') {
    const match = scheduledAt.match(/^\d{4}-(\d{2})-(\d{2})/);

    if (!match) {
      throw new Error(`Invalid scheduledAt: ${scheduledAt}`);
    }

    const [, month, day] = match;
    return `${month}${day}`;
  }

  const month = String(scheduledAt.getMonth() + 1).padStart(2, '0');
  const day = String(scheduledAt.getDate()).padStart(2, '0');

  return `${month}${day}`;
};

export const lookupBlogUtmUrl = async (
  dateCode: string,
  blogName: string,
  keyword: string,
): Promise<string | null> => {
  const sheet = await readBlogUtmConverterSheet();
  const mediumKey = normalizeUtmKey(`${dateCode}${blogName}`);
  const detailKey = normalizeUtmKey(keyword);

  for (let i = DATA_START_ROW; i < sheet.values.length; i++) {
    const row = sheet.values[i];
    if (!row) continue;

    const rowMedium = normalizeUtmKey(row[MEDIUM_COL] ?? '');
    const rowDetail = normalizeUtmKey(row[DETAIL_COL] ?? '');

    if (rowMedium === mediumKey && rowDetail === detailKey) {
      const url = row[CAMPAIGN_URL_COL]?.trim();
      log.info('utm.lookup.found', { dateCode, blogName, keyword, row: i, url: url?.slice(0, 60) });
      return url || null;
    }
  }

  log.warn('utm.lookup.miss', { dateCode, blogName, keyword, mediumKey, detailKey });
  return null;
};

const buildUtmUrl = (baseUrl: string, params: Record<string, string>): string => {
  const query = Object.entries(params)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&');
  return `${baseUrl}?${query}`;
};

const findFirstEmptyRow = (values: string[][]): number => {
  for (let i = DATA_START_ROW; i < values.length; i++) {
    const row = values[i];
    const hasContent = row && row.some((cell, idx) => idx >= 1 && idx <= 7 && cell && cell.trim() !== '');
    if (!hasContent) return i;
  }
  return values.length;
};

export const buildBlogUtmSheetRows = (
  entries: BlogUtmScheduledEntry[],
  startSeq: number,
): string[][] => {
  const { baseProductUrl, source, defaultKeyword } = BLOG_UTM_CONVERTER_SHEET;

  return entries.map(({ name, keyword, scheduledAt }, index) => {
    const medium = `${formatBlogUtmDateCode(scheduledAt)}${name.replace(/\s/g, '')}`;
    const detail = keyword.replace(/\s/g, '');
    const campaignUrl = buildUtmUrl(baseProductUrl, {
      nt_source: source,
      nt_medium: medium,
      nt_detail: detail,
      nt_keyword: defaultKeyword,
    });

    return [
      '',
      String(startSeq + index),
      baseProductUrl,
      source,
      medium,
      detail,
      defaultKeyword,
      campaignUrl,
    ];
  });
};

export const appendScheduledBlogUtmRows = async (
  accounts: BlogUtmScheduledAccount[],
): Promise<UpdateGoogleSheetValuesResult> => {
  const existing = await readBlogUtmConverterSheet();
  const startRow = findFirstEmptyRow(existing.values);

  let seq = 1;
  for (let i = DATA_START_ROW; i < startRow; i++) {
    const num = Number(existing.values[i]?.[1]);
    if (Number.isInteger(num) && num >= seq) seq = num + 1;
  }

  const rows = buildBlogUtmSheetRows(
    accounts.flatMap(({ name, items }) =>
      items.map(({ keyword, scheduledAt }) => ({
        name,
        keyword,
        scheduledAt,
      })),
    ),
    seq,
  );

  const sheetRow = startRow + 1;
  const range = `A${sheetRow}:H${sheetRow + rows.length - 1}`;

  return updateGoogleSheetValues({
    spreadsheet: BLOG_UTM_CONVERTER_SHEET.url,
    gid: BLOG_UTM_CONVERTER_SHEET.gid,
    range,
    values: rows,
  });
};

export const appendBlogUtmRows = async (
  accounts: BlogUtmAccount[],
  scheduleDate?: string,
  scheduleMode: ScheduleMode = '2',
): Promise<UpdateGoogleSheetValuesResult> => {
  return appendScheduledBlogUtmRows(
    accounts.map(({ name, keywords }) => ({
      name,
      items: calculateSchedule(keywords, scheduleDate, scheduleMode),
    })),
  );
};
