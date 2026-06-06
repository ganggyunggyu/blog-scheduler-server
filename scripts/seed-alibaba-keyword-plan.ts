import 'dotenv/config';
import mongoose from 'mongoose';

interface AlibabaKeywordPlanSeed {
  domain: 'alibaba';
  category: '알리바바';
  groupLabel: '1/3/5' | '2/4/6';
  accountIds: string[];
  scheduleDate: string;
  keywords: string[];
}

const GROUP_246 = ['mad1651', 'weed3122', 'individual14144'];
const GROUP_135 = ['crvfwy7062', 'heavymouse448', 'rqr1io45'];

const rows246: Array<{ date: string; keywords: string[] }> = [
  { date: '2026-05-18', keywords: ['타오바오', '1688', '타오바오 직구방법'] },
  { date: '2026-05-19', keywords: ['타오바오 한국어', '1688사이트', '1688 사이트'] },
  { date: '2026-05-20', keywords: ['타오바오 회원가입', '1688구매대행', '타오바오구매대행'] },
  { date: '2026-05-21', keywords: ['타오바오 구매대행', 'TAOBAO', '타오바오 직구'] },
  { date: '2026-05-22', keywords: ['타오바오직구', '타오바오 배대지', '타오바오배대지'] },
  { date: '2026-05-23', keywords: ['타오바오 한국어 설정', '1688배송대행', '타오바오 배송기간'] },
  { date: '2026-05-24', keywords: ['타오바오 환불', '타오바오배대지추천', '1688.COM'] },
  { date: '2026-05-25', keywords: ['타오바오 주소입력', '타오바오 코리아', '타오바오배송조회'] },
  { date: '2026-05-26', keywords: ['타오바오 배송', '타오바오직배송', '1688회원가입'] },
  { date: '2026-05-27', keywords: ['1688결제대행', '1688구매대행업체', '1688배대지'] },
  { date: '2026-05-28', keywords: ['타오바오할인코드', '타오바오 구매방법', '타오바오한국직배송'] },
  { date: '2026-05-29', keywords: ['타오바오가입', '타오바오 배송비', '타오바오 쿠폰'] },
  { date: '2026-05-30', keywords: ['1688닷컴', '도매꾹1688', '중국 배대지'] },
  { date: '2026-05-31', keywords: ['중국구매대행', '중국쇼핑몰', '중국이우시장'] },
  { date: '2026-06-01', keywords: ['중국도매사이트', '중국OEM', '중국배대지추천'] },
  { date: '2026-06-02', keywords: ['중국배송대행', '중국직구', '이우배대지'] },
  { date: '2026-06-03', keywords: ['중국소싱', '중국직구사이트', '중국수입대행'] },
  { date: '2026-06-04', keywords: ['해외직구 통관조회', '네이버 해외직구', '해외직구'] },
  { date: '2026-06-05', keywords: ['배대지', '구매대행', '해외구매대행'] },
  { date: '2026-06-06', keywords: ['직구배송조회', '직구사이트', '해외직구 사이트'] },
  { date: '2026-06-07', keywords: ['해외통관번호조회', '해외직구 배송조회', '사입'] },
  { date: '2026-06-08', keywords: ['도매꾹', '도매매', '오너클랜'] },
  { date: '2026-06-09', keywords: ['도매토피아', '도매사이트', '도매창고'] },
  { date: '2026-06-10', keywords: ['알리바바닷컴', '알리바바구매대행', '알리바바직구'] },
];

const rows135: Array<{ date: string; keywords: string[] }> = [
  { date: '2026-05-18', keywords: ['해외직구관세기준', '해외직구관세', '국제배송조회'] },
  { date: '2026-05-19', keywords: ['해외직구 조회', '직구관세', '배송대행지'] },
  { date: '2026-05-20', keywords: ['해외직구여기로', '해외통관조회', '해외구매대행사이트'] },
  { date: '2026-05-21', keywords: ['배송대행', '해외직구구매대행', '구매대행부업'] },
  { date: '2026-05-22', keywords: ['해외직구통관배송조회', '해외직구세금', '국내구매대행'] },
  { date: '2026-05-23', keywords: ['해외배송대행', '해외구매', '배대지추천'] },
  { date: '2026-05-24', keywords: ['해외직구주소적는법', '구매대행사이트', '구매대행사업'] },
  { date: '2026-05-25', keywords: ['해외직구통관', '해외직구방법', '직구대행'] },
  { date: '2026-05-26', keywords: ['상품소싱', '해외직구사이트추천', '해외직구주소'] },
  { date: '2026-05-27', keywords: ['구매대행쇼핑몰', '해외직구 배송기간', '해외통관번호발급'] },
  { date: '2026-05-28', keywords: ['글로벌소싱', '해외직구관세납부방법', '배대지 사이트'] },
  { date: '2026-05-29', keywords: ['해외직구쇼핑몰', '구매대행업체', '한국배대지'] },
  { date: '2026-05-30', keywords: ['해외직구한도', '해외직구어플', '배대지비용'] },
  { date: '2026-05-31', keywords: ['구매대행프로그램', '해외직구네이버', '중국이우'] },
  { date: '2026-06-01', keywords: ['중국물류', '중국구매대행사이트', '중국무역대행'] },
  { date: '2026-06-02', keywords: ['중국구매대행추천', '중국수입대행업체', '중국택배'] },
  { date: '2026-06-03', keywords: ['위해배대지', '광저우박람회', '중국배송대행지'] },
  { date: '2026-06-04', keywords: ['중국온라인쇼핑몰', '중국사입', '중국1688'] },
  { date: '2026-06-05', keywords: ['중국공장', '중국쇼핑사이트', '중국수출'] },
  { date: '2026-06-06', keywords: ['중국무역', '상해박람회', '중국도매쇼핑몰'] },
  { date: '2026-06-07', keywords: ['중국도매', '중국수입', '광저우사입'] },
  { date: '2026-06-08', keywords: ['중국도매시장', '중국EMS', '중국쇼핑몰사이트'] },
  { date: '2026-06-09', keywords: ['중국특송', '중국인터넷쇼핑몰', '중국구매사이트'] },
  { date: '2026-06-10', keywords: ['중국사입사이트', '광저우배대지', '중국대행'] },
  { date: '2026-06-11', keywords: ['한국에서중국택배'] },
];

const plans: AlibabaKeywordPlanSeed[] = [
  ...rows246.map((row) => ({
    domain: 'alibaba' as const,
    category: '알리바바' as const,
    groupLabel: '2/4/6' as const,
    accountIds: GROUP_246,
    scheduleDate: row.date,
    keywords: row.keywords,
  })),
  ...rows135.map((row) => ({
    domain: 'alibaba' as const,
    category: '알리바바' as const,
    groupLabel: '1/3/5' as const,
    accountIds: GROUP_135,
    scheduleDate: row.date,
    keywords: row.keywords,
  })),
];

const main = async (): Promise<void> => {
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is required');
  }

  await mongoose.connect(process.env.MONGO_URI);
  const collection = mongoose.connection.collection('blogkeywordplans');

  await collection.createIndex(
    { domain: 1, groupLabel: 1, scheduleDate: 1 },
    { unique: true },
  );
  await collection.createIndex({ category: 1, scheduleDate: 1 });

  const now = new Date();
  const result = await collection.bulkWrite(plans.map((plan) => ({
    updateOne: {
      filter: {
        domain: plan.domain,
        groupLabel: plan.groupLabel,
        scheduleDate: plan.scheduleDate,
      },
      update: {
        $set: {
          ...plan,
          updatedAt: now,
        },
        $setOnInsert: {
          createdAt: now,
        },
      },
      upsert: true,
    },
  })));

  console.log(JSON.stringify({
    matched: result.matchedCount,
    modified: result.modifiedCount,
    upserted: result.upsertedCount,
    total: plans.length,
  }, null, 2));

  await mongoose.disconnect();
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
