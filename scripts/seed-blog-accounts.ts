import 'dotenv/config';
import mongoose from 'mongoose';

interface BlogAccountSeed {
  accountId: string;
  blogId: string;
  nickname: string;
  category: string;
  isEnabled: boolean;
  status?: string;
  note?: string;
}

const accounts: BlogAccountSeed[] = [
  { nickname: '빨간모자앤  1', blogId: 'dhtksk1p', accountId: 'dhtksk1p', category: '흑염소', isEnabled: true },
  { nickname: '소원 1', blogId: 'regular14631', accountId: 'regular14631', category: '흑염소', isEnabled: true },
  { nickname: '똑똑한건희씨', blogId: 'orangeswan630', accountId: 'orangeswan630', category: '추상의구체화', isEnabled: true },
  { nickname: '고래낚시 1', blogId: 'bigfish773', accountId: 'bigfish773', category: '추상의구체화', isEnabled: true },
  { nickname: '에스앤비안과 1 (노출)', blogId: 'nes1p2kx', accountId: 'nes1p2kx', category: '안과', isEnabled: true },
  { nickname: '에스앤비안과 2 (노출)', blogId: 'mh8j62wm', accountId: 'mh8j62wm', category: '안과', isEnabled: true },
  { nickname: '에스앤비안과 정보', blogId: 'h9ag469z', accountId: 'h9ag469z', category: '에스앤비안과', isEnabled: true },
  { nickname: '에스앤비안과, 29년 경력 (노출)', blogId: 'dq1h3bjy', accountId: 'dq1h3bjy', category: '에스앤비안과', isEnabled: true },
  { nickname: '에스앤비안과의원 - 교체', blogId: 'hagyga', accountId: 'hagyga', category: '에스앤비안과', isEnabled: true },
  { nickname: '모험 - 교체', blogId: 'geenl', accountId: 'geenl', category: '에스앤비안과-백업', isEnabled: true },
  { nickname: '탐험기 - 교체', blogId: 'ghhoy', accountId: 'ghhoy', category: '에스앤비안과-백업', isEnabled: true },
  { nickname: '앵그리맨', blogId: 'angrykoala270', accountId: 'angrykoala270', category: '윤슬', isEnabled: true },
  { nickname: '티니피쉬 1', blogId: 'tinyfish183', accountId: 'tinyfish183', category: '윤슬', isEnabled: true },
  { nickname: '알리바바 신규1', blogId: 'crvfwy7062', accountId: 'crvfwy7062', category: '알리바바', isEnabled: true },
  { nickname: '알리바바 신규2', blogId: 'mad1651', accountId: 'mad1651', category: '알리바바', isEnabled: true },
  { nickname: '알리바바 신규3', blogId: 'heavymouse448', accountId: 'heavymouse448', category: '알리바바', isEnabled: true },
  { nickname: '알리바바 신규4', blogId: 'weed3122', accountId: 'weed3122', category: '알리바바', isEnabled: true },
  { nickname: '알리바바 신규5', blogId: 'rqr1io45', accountId: 'rqr1io45', category: '알리바바', isEnabled: true },
  { nickname: '알리바바 신규6', blogId: 'individual14144', accountId: 'individual14144', category: '알리바바', isEnabled: true },
  { nickname: '강아지강하지 1', blogId: 'k7d9x2m4', accountId: 'k7d9x2m4', category: '도그마루 글밥', isEnabled: true },
  { nickname: '라우드 2 (5개) 1', blogId: 'loand3324', accountId: 'loand3324', category: '도그마루 글밥', isEnabled: true, status: 'credential_error', note: '비밀번호 오류 표시 계정' },
  { nickname: '고구마스틱2 (10개) 1', blogId: 'fail5644', accountId: 'fail5644', category: '도그마루 글밥', isEnabled: true },
  { nickname: '룰루랄라 2 (12개) 1', blogId: 'compare14310', accountId: 'compare14310', category: '도그마루 글밥', isEnabled: true },
  { nickname: '오리의 다락방', blogId: 'pwg7r3sl', accountId: 'pwg7r3sl', category: '법률', isEnabled: true },
  { nickname: '실눈캐', blogId: 'ghostrush7', accountId: 'ghostrush7', category: '도그마루 글밥', isEnabled: true },
  { nickname: 'b6x2k9w3', blogId: 'b6x2k9w3', accountId: 'b6x2k9w3', category: '도그마루 글밥', isEnabled: true },
  { nickname: '햄부기', blogId: 'ahfflwl123', accountId: 'ahfflwl123', category: '서리펫', isEnabled: true },
  { nickname: '바삭바삭해 1', blogId: 'ahffkdlek12', accountId: 'ahffkdlek12', category: '서리펫', isEnabled: true },
  { nickname: '8ua1womn', blogId: '8ua1womn', accountId: '8ua1womn', category: '서리펫', isEnabled: true },
  { nickname: '쉽고간단하게', blogId: 'ahsxkfldk12', accountId: 'ahsxkfldk12', category: '서리펫', isEnabled: true },
  { nickname: '긍정이백퍼  1', blogId: 'ahffkekd12', accountId: 'ahffkekd12', category: '흑염소', isEnabled: true },
  { nickname: '포비 1', blogId: 'q9v3m7a2', accountId: 'q9v3m7a2', category: '흑염소', isEnabled: true },
  { nickname: '도도 1', blogId: 'laghunter8', accountId: 'laghunter8', category: '흑염소', isEnabled: true },
  { nickname: '오세아니야 1', blogId: 'eghfsa5478', accountId: 'eghfsa5478', category: '흑염소', isEnabled: true },
  { nickname: '건강박사석사 1', blogId: 'pixelninja3', accountId: 'pixelninja3', category: '흑염소', isEnabled: true },
  { nickname: '고양이밥 1', blogId: 'n7c3w8z2', accountId: 'n7c3w8z2', category: '서리펫', isEnabled: true },
  { nickname: '리스팩식스팩 1', blogId: 'respawnking9', accountId: 'respawnking9', category: '서리펫', isEnabled: true },
];

const main = async (): Promise<void> => {
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is required');
  }

  await mongoose.connect(process.env.MONGO_URI);
  const collection = mongoose.connection.collection('blogaccounts');

  await collection.createIndex({ accountId: 1 }, { unique: true });
  await collection.createIndex({ blogId: 1 });
  await collection.createIndex({ category: 1, isEnabled: 1 });

  const now = new Date();
  const result = await collection.bulkWrite(accounts.map((account) => ({
    updateOne: {
      filter: { accountId: account.accountId },
      update: {
        $set: {
          ...account,
          updatedAt: now,
        },
        $setOnInsert: {
          createdAt: now,
        },
        $unset: {
          password: '',
        },
      },
      upsert: true,
    },
  })));

  console.log(JSON.stringify({
    matched: result.matchedCount,
    modified: result.modifiedCount,
    upserted: result.upsertedCount,
    total: accounts.length,
  }, null, 2));

  await mongoose.disconnect();
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
