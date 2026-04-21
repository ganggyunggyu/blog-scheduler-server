import { readFileSync, writeFileSync } from 'fs';

const PLAN_PATH = '/tmp/goat-modify-plan-all.json';
const OUT_PATH = '/tmp/goat-today-batch.json';
const PER_ACCOUNT = Number(process.argv[2] ?? 50);
const OFFSET = Number(process.argv[3] ?? 0);

interface PlanItem {
  accountId: string;
  password: string;
  blogId: string;
  nickname: string;
  logNo: string;
  oldTitle: string;
  oldKeyword: string;
  newKeyword: string;
}

const main = () => {
  const plan: PlanItem[] = JSON.parse(readFileSync(PLAN_PATH, 'utf-8'));

  const byAccount = new Map<string, PlanItem[]>();
  for (const p of plan) {
    if (!byAccount.has(p.accountId)) byAccount.set(p.accountId, []);
    byAccount.get(p.accountId)!.push(p);
  }

  const today: PlanItem[] = [];
  for (const [, items] of byAccount) {
    today.push(...items.slice(OFFSET, OFFSET + PER_ACCOUNT));
  }

  writeFileSync(OUT_PATH, JSON.stringify(today, null, 2));

  console.log(`계정당 ${PER_ACCOUNT}개 추출 (offset ${OFFSET})`);
  console.log(`계정 수: ${byAccount.size}`);
  console.log(`오늘 배치 총: ${today.length}개`);
  console.log(`저장: ${OUT_PATH}\n`);

  const uniqueKws = new Set(today.map((p) => p.newKeyword));
  console.log(`오늘 배치 고유 키워드: ${uniqueKws.size}개`);

  console.log(`\n계정별 배분:`);
  for (const [acc, items] of byAccount) {
    const nick = items[0].nickname;
    const taken = items.slice(OFFSET, OFFSET + PER_ACCOUNT).length;
    console.log(`  ${nick.padEnd(16)} (${acc.padEnd(14)}): ${taken}개 (전체 ${items.length}중 ${OFFSET}~${OFFSET + taken - 1})`);
  }
};

main();
