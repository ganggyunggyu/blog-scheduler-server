/**
 * 코드에 박혀 있던 내장 본문 순서를 특정 계정 소유의 DB 문서로 옮겨 심는다.
 *
 * 파이프라인은 ownerId 귀속인데 내장 순서는 아무 계정에도 안 묶여 있어서,
 * 화면에 목록이 비어 보이고 고칠 수도 없었다. 기본 운영 계정(21lab) 앞으로
 * 심어두면 그대로 보이고 거기서 수정해 쓸 수 있다.
 *
 * 이미 있는 key 는 건드리지 않는다. 사용자가 고쳐둔 순서를 내장값으로
 * 되돌려버리면 안 되기 때문이다.
 *
 * 사용법:
 *   pnpm tsx scripts/seed-content-pipelines.ts --owner-username 21lab
 *   pnpm tsx scripts/seed-content-pipelines.ts --owner-username 21lab --apply
 */
import mongoose from 'mongoose';
import { env } from '../src/config/env.js';
import { ContentPipelineModel } from '../src/schemas/content-pipeline.schema.js';
import { assertValidBlocks, listBuiltinPipelines } from '../src/services/content-pipeline.service.js';

const LABELS: Record<string, string> = {
  default: '기본',
  애견: '애견',
  안과: '안과',
  안과기본: '안과 기본',
  안과브랜드: '안과 브랜드',
  한려담원: '한려담원',
  알리바바: '알리바바',
};

const readFlag = (name: string): string | undefined => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const resolveOwnerId = async (username: string): Promise<string> => {
  if (!env.DABUT_APP_MONGO_URI) {
    throw new Error('DABUT_APP_MONGO_URI 가 없어서 계정을 찾을 수 없음');
  }

  const connection = mongoose.createConnection(env.DABUT_APP_MONGO_URI, {
    dbName: env.DABUT_APP_DB_NAME,
  });
  await connection.asPromise();

  try {
    const user = await connection.collection('users').findOne({ username });
    if (!user) {
      throw new Error(`다붓 계정을 찾지 못함: ${username}`);
    }
    return String(user._id);
  } finally {
    await connection.close();
  }
};

const run = async (): Promise<void> => {
  const isApply = process.argv.includes('--apply');

  // 배포된 서버는 다른 다붓 DB 를 보므로 같은 이름이어도 계정 id 가 다르다.
  // 그 경우 로컬에서 이름으로 찾으면 엉뚱한 주인 앞으로 심게 되어 id 를 직접 받는다.
  const explicitId = readFlag('owner-id');
  const username = readFlag('owner-username') ?? '21lab';

  const ownerId = explicitId ?? (await resolveOwnerId(username));
  console.log(`대상 계정: ${explicitId ? '(id 직접 지정)' : username} (${ownerId})`);

  await mongoose.connect(env.MONGO_URI);

  const builtins = listBuiltinPipelines();
  const existing = await ContentPipelineModel.find({ ownerId }).select('key').lean();
  const existingKeys = new Set(existing.map((doc) => doc.key));

  const planned = builtins.map((builtin, index) => ({
    key: builtin.key,
    label: LABELS[builtin.key] ?? builtin.key,
    blocks: [...builtin.blocks],
    order: index,
    skipped: existingKeys.has(builtin.key),
  }));

  planned.forEach((item) => {
    assertValidBlocks(item.blocks);
    const mark = item.skipped ? '건너뜀(이미 있음)' : '심음';
    console.log(`  [${mark}] ${item.key} — ${item.blocks.join(' > ')}`);
  });

  const toInsert = planned.filter((item) => !item.skipped);

  if (!isApply) {
    console.log(`\n미리보기임. 실제로 넣으려면 --apply 를 붙일 것. (넣을 개수 ${toInsert.length})`);
    await mongoose.disconnect();
    return;
  }

  for (const item of toInsert) {
    await ContentPipelineModel.create({
      ownerId,
      key: item.key,
      label: item.label,
      description: '코드에 있던 내장 순서를 옮겨 심은 것',
      blocks: item.blocks,
      isActive: true,
      order: item.order,
    });
  }

  console.log(`\n완료. 새로 넣은 개수 ${toInsert.length}, 건너뛴 개수 ${planned.length - toInsert.length}`);
  await mongoose.disconnect();
};

run().catch((error: unknown) => {
  console.error('실패:', error instanceof Error ? error.message : error);
  process.exit(1);
});
