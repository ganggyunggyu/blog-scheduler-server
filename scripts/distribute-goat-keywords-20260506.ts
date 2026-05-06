import fs from 'fs';

const parseCsvLine = (line: string): string[] => {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
};

const parseCsv = (text: string): Record<string, string>[] => {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx] ?? '';
    });
    return row;
  });
};

const USED_KEYWORDS = new Set<string>([
  '공진단효능','콜레스테롤수치낮추는음식','소음인특징','만성피로해결','흑염소진액효능','고혈압에좋은음식','임산부유산균','기립성저혈압증상','갱년기영양제','관절에좋은영양제','면역력높이는영양제','소화불량원인','동충하초효능','혈당낮추는음식','빈혈영양제','뼈에좋은영양제',
  '수족냉증','홍삼효능','소음인체질','비타민E효능','임산부철분제','면역력높이는음식','흑염소효능','십전대보탕효능','당귀효능','빈혈증상','만성피로증후군','관절에좋은음식','콜레스테롤영양제','영지버섯효능','혈액순환에좋은음식','키성장영양제',
  '수족냉증원인','녹용효능','소음인흑염소','비타민B12효능','임산부흑염소','간에좋은음식','흑염소진액복용법','경옥고효능','기력회복','빈혈원인','도라지효능','만성피로증상','면역력영양제','혈압영양제','골밀도높이는법','혈액순환개선제',
  '수족냉증치료','수족냉증증상','수족냉증영양제','수족냉증에좋은차','수족냉증음식','수족냉증약','수족냉증에좋은음식','수족냉증다한증','수족냉증선물','수족냉증땀','수족냉증치료법','손발이차가운원인','손발이차가울때','손발저림증상','손발저림영양제',
  '손발저림원인','손끝저림','수족냉증치료방법','수족냉증치료음식','수족냉증양말','수족냉증임신','수족냉증족욕','수족냉증한약','수족냉증한의원','족냉증','말초신경병증증상','남자수족냉증',
  '임산부수족냉증','발이차가운원인','손발이차가울때영양제','손발이차가울때좋은차','손발차가움','저체온증증상','저체온증','손발저림','손가락저림','손저림원인','손목저림','팔다리저림','소음인','소음인남자','소음인여자','소양인여자특징','소음인식단','소음인운동',
  // 직전에 등록 후 취소된 30개도 포함 (재배정 안 되도록)
  '소음인여자음식','임산부소화제','임산부철분','임산부마그네슘','임산부오메가3','임산부영양제시기','산모영양제','임산부음식추천','임산부속쓰림','임신초기아랫배통증',
  '소음인남자특징','임산부감기','임산부체온','임산부비타민D','초기임산부선물','임산부영양제추천','수유부영양제','임산부금지음식','임신준비흑염소','임신초기영양제',
  '소음인홍삼','임산부독감','임산부칼슘','임산부엽산추천','임산부영양제복용시기','산후영양제','임산부엽산','임산부비타민','임신초기증상','임신극초기증상',
]);

// 오늘 이미 발행된 키워드의 메인 그룹 (제외)
// 발행된 글: 소양인 여자 체질, 소음인 체질 음식, 소음인 식단, 소음인남자, 소음인 운동, 소음인여자
// → '소음인', '소양인' 그룹 전부 제외
const BLOCKED_PREFIXES = ['소음인', '소양인', '체질'];

const classifyGroup = (keyword: string): string => {
  if (keyword.startsWith('임산부영양제')) return '임산부영양제';
  if (keyword.startsWith('임산부')) return '임산부';
  if (keyword.startsWith('임신초기')) return '임신초기';
  if (keyword.startsWith('임신')) return '임신';
  if (keyword.startsWith('산모') || keyword.startsWith('산후') || keyword.startsWith('수유부')) return '산모/산후';
  if (keyword.startsWith('소음인') || keyword.startsWith('소양인')) return '소음인/소양인';
  if (keyword.startsWith('흑염소진액')) return '흑염소진액';
  if (keyword.startsWith('흑염소') || keyword.includes('염소')) return '흑염소';
  if (keyword.startsWith('갱년기')) return '갱년기';
  if (keyword.startsWith('동충하초')) return '동충하초';
  if (keyword.startsWith('홍삼')) return '홍삼';
  if (keyword.startsWith('녹용')) return '녹용';
  if (keyword.startsWith('공진단')) return '공진단';
  if (keyword.startsWith('경옥고')) return '경옥고';
  if (keyword.startsWith('도라지')) return '도라지';
  if (keyword.startsWith('영지')) return '영지';
  if (keyword.startsWith('비타민')) return '비타민';
  if (keyword.startsWith('당귀')) return '당귀';
  if (keyword.startsWith('십전대보탕')) return '십전대보';
  if (keyword.includes('빈혈')) return '빈혈';
  if (keyword.includes('만성피로') || keyword.includes('피로')) return '피로';
  if (keyword.includes('면역력')) return '면역력';
  if (keyword.includes('혈당') || keyword.includes('당뇨')) return '혈당';
  if (keyword.includes('혈압')) return '혈압';
  if (keyword.includes('콜레스테롤')) return '콜레스테롤';
  if (keyword.includes('관절')) return '관절';
  if (keyword.includes('뼈') || keyword.includes('골밀도')) return '뼈';
  if (keyword.includes('소화')) return '소화';
  if (keyword.includes('기립성') || keyword.includes('저혈압')) return '저혈압';
  if (keyword.includes('수족냉증') || keyword.includes('손발') || keyword.includes('손저림') || keyword.includes('팔다리') || keyword.includes('손가락') || keyword.includes('손목') || keyword.includes('저체온')) return '수족냉증';
  if (keyword.includes('기력') || keyword.includes('체력')) return '기력';
  if (keyword.includes('혈액순환')) return '혈액순환';
  if (keyword.includes('키성장') || keyword.includes('성장')) return '성장';
  return '기타';
};

const isBlocked = (keyword: string): boolean =>
  BLOCKED_PREFIXES.some((p) => keyword.startsWith(p));

const main = () => {
  const csv = fs.readFileSync('/tmp/goat-keywords-20260506.csv', 'utf-8');
  const rows = parseCsv(csv);

  const seen = new Set<string>();
  const candidates: string[] = [];
  for (const row of rows) {
    const keyword = (row['키워드'] ?? '').trim();
    const newLogic = (row['신규로직'] ?? '').trim().toLowerCase();
    const exposure = (row['노출여부'] ?? '').trim();
    if (!keyword) continue;
    if (newLogic !== 'o') continue;
    if (exposure !== '') continue;
    if (seen.has(keyword)) continue;
    seen.add(keyword);
    if (USED_KEYWORDS.has(keyword)) continue;
    if (isBlocked(keyword)) continue;
    candidates.push(keyword);
  }

  // 그룹별 분류
  const groups: Record<string, string[]> = {};
  for (const k of candidates) {
    const g = classifyGroup(k);
    if (!groups[g]) groups[g] = [];
    groups[g].push(k);
  }

  console.log('=== 그룹별 미사용 키워드 분포 ===');
  const groupNames = Object.keys(groups).sort((a, b) => groups[b].length - groups[a].length);
  for (const g of groupNames) {
    console.log(`${g}: ${groups[g].length}개`);
  }
  console.log();

  // 라운드로빈으로 30개 추출 (한 그룹 최대 5개 = 16.7%)
  const NEEDED = 30;
  const MAX_PER_GROUP = 5;
  const groupQueue: { name: string; items: string[]; takenCount: number }[] = groupNames
    .filter((g) => groups[g].length > 0)
    .map((g) => ({ name: g, items: [...groups[g]], takenCount: 0 }));

  const picked: { keyword: string; group: string }[] = [];
  while (picked.length < NEEDED) {
    let progressed = false;
    for (const gq of groupQueue) {
      if (picked.length >= NEEDED) break;
      if (gq.takenCount >= MAX_PER_GROUP) continue;
      if (gq.items.length === 0) continue;
      const k = gq.items.shift()!;
      picked.push({ keyword: k, group: gq.name });
      gq.takenCount += 1;
      progressed = true;
    }
    if (!progressed) break;
  }

  console.log(`=== 추출된 ${picked.length}개 (그룹별 카운트) ===`);
  const groupCount: Record<string, number> = {};
  picked.forEach((p) => {
    groupCount[p.group] = (groupCount[p.group] ?? 0) + 1;
  });
  for (const [g, c] of Object.entries(groupCount).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${g}: ${c}개`);
  }
  console.log();

  // 3계정에 라운드로빈 분배 (각 10개), 그룹이 한 계정에 몰리지 않게 stride 분배
  const accounts = [
    { id: 'q9v3m7a2', nickname: '포비' },
    { id: 'eghfsa5478', nickname: '오세아니야' },
    { id: 'pixelninja3', nickname: '건강박사석사' },
  ];
  const distribution: Record<string, { keyword: string; group: string }[]> = {};
  accounts.forEach((a) => { distribution[a.id] = []; });

  picked.forEach((item, idx) => {
    const acc = accounts[idx % accounts.length];
    distribution[acc.id].push(item);
  });

  console.log('=== 계정별 분배 ===');
  for (const acc of accounts) {
    console.log(`\n[${acc.nickname} / ${acc.id}] (${distribution[acc.id].length}개)`);
    const accGroupCount: Record<string, number> = {};
    distribution[acc.id].forEach((p) => {
      accGroupCount[p.group] = (accGroupCount[p.group] ?? 0) + 1;
    });
    distribution[acc.id].forEach((p) => {
      console.log(`  - ${p.keyword} [${p.group}]`);
    });
    console.log(`  그룹 분포: ${Object.entries(accGroupCount).map(([g, c]) => `${g}=${c}`).join(', ')}`);
  }

  // JSON 출력 (curl payload 용)
  console.log('\n=== JSON ===');
  console.log(JSON.stringify(
    accounts.map((a) => ({
      account: a.id,
      nickname: a.nickname,
      keywords: distribution[a.id].map((p) => p.keyword),
    })),
    null,
    2,
  ));
};

main();
