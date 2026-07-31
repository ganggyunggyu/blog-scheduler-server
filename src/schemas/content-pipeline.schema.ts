import { Schema, model } from 'mongoose';
import { randomUUID } from 'node:crypto';

/**
 * 계정별 본문 블록 순서.
 *
 * ownerId 는 다붓 JWT 의 sub(로그인 계정)임. 같은 계정 안에서 key 로 구분하고,
 * key 는 보통 keywordCategory 와 같은 값을 씀(애견, 안과 …). 그래야 발행할 때
 * 넘어온 카테고리로 바로 찾을 수 있음.
 */
export const contentPipelineSchema = new Schema(
  {
    _id: { type: String, default: () => `cpl_${randomUUID()}` },
    ownerId: { type: String, required: true, index: true },
    key: { type: String, required: true },
    label: { type: String, required: true },
    description: { type: String, default: '' },
    blocks: { type: [String], required: true },
    isActive: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
  },
  { timestamps: true },
);

contentPipelineSchema.index({ ownerId: 1, key: 1 }, { unique: true });

export const ContentPipelineModel = model('ContentPipeline', contentPipelineSchema);
