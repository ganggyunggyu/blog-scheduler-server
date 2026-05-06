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
]);

const main = () => {
  const csv = fs.readFileSync('/tmp/goat-keywords-20260506.csv', 'utf-8');
  const rows = parseCsv(csv);

  const seen = new Set<string>();
  const unused: string[] = [];
  const usedFromSheet: string[] = [];
  let totalNewLogic = 0;
  let exposed = 0;

  for (const row of rows) {
    const keyword = (row['키워드'] ?? '').trim();
    const newLogic = (row['신규로직'] ?? '').trim().toLowerCase();
    const exposure = (row['노출여부'] ?? '').trim();

    if (!keyword) continue;
    if (newLogic !== 'o') continue;
    if (exposure !== '') {
      exposed += 1;
      continue;
    }
    if (seen.has(keyword)) continue;
    seen.add(keyword);
    totalNewLogic += 1;

    if (USED_KEYWORDS.has(keyword)) {
      usedFromSheet.push(keyword);
    } else {
      unused.push(keyword);
    }
  }

  console.log(`전체 신규로직=o & 노출여부 빈 행: ${totalNewLogic}`);
  console.log(`사용된 키워드: ${usedFromSheet.length}`);
  console.log(`미사용 키워드: ${unused.length}`);
  console.log(`노출여부 채워진 행: ${exposed}`);
  console.log('\n=== 미사용 키워드 (앞 50개) ===');
  console.log(unused.slice(0, 50).join('\n'));
  console.log('\n=== 전체 미사용 ===');
  console.log(JSON.stringify(unused, null, 2));
};

main();
