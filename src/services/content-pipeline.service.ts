/**
 * 본문 블록 순서(원고 작성 순서)를 계정별로 만들어 쓰게 하는 서비스.
 *
 * 지금까지 `CONTENT_PIPELINES` 가 코드 안 객체 리터럴이라, 새 업종을 넣거나
 * 순서를 바꾸려면 이 서버를 고쳐 배포해야 했음. 계정마다 다른 순서를 쓰고 싶어도
 * 방법이 없었음. 그래서 DB 문서로 빼고, 문서가 없으면 기존 내장 순서로 떨어지게 함.
 *
 * 블록 "종류"는 사용자가 못 만듦. 각 블록은 실제 에디터 조작 코드에 대응하기 때문에
 * 카탈로그에 있는 것만 골라 담을 수 있음. 다붓 파이프라인 스텝과 같은 방침임.
 */
import { ContentPipelineModel } from '../schemas/content-pipeline.schema.js';
import {
  ALIBABA_CONTENT_PIPELINE,
  CONTENT_PIPELINES,
  getContentPipeline,
  type ContentBlock,
} from './naver-blog-pipeline.js';
import type { ManuscriptType } from './manuscript.service.js';

export interface ContentBlockInfo {
  type: ContentBlock;
  label: string;
  description: string;
}

/** 프론트가 그대로 읽어서 편집 화면을 그림. 라벨과 설명은 화면 노출 문구임. */
export const CONTENT_BLOCK_CATALOG: ContentBlockInfo[] = [
  { type: 'excluded1', label: '제외 이미지 1', description: '제외 키워드 이미지 첫 번째 묶음을 넣습니다.' },
  { type: 'excluded2', label: '제외 이미지 2', description: '제외 키워드 이미지 두 번째 묶음을 넣습니다.' },
  { type: 'excluded3', label: '제외 이미지 3', description: '제외 키워드 이미지 세 번째 묶음을 넣습니다.' },
  { type: 'allExcluded', label: '제외 이미지 전체', description: '제외 키워드 이미지를 한 번에 모두 넣습니다.' },
  { type: 'maps', label: '지도', description: '업체 위치 지도를 넣습니다.' },
  { type: 'phone', label: '전화번호', description: '전화번호 블록을 넣습니다.' },
  { type: 'content', label: '원고 본문', description: '생성된 원고 본문입니다. 반드시 한 번만 넣어야 합니다.' },
  { type: 'excludeLibraryLinks', label: '라이브러리 링크 제외', description: '네이버 라이브러리 링크가 붙지 않게 처리합니다.' },
  { type: 'spacing', label: '여백', description: '위아래 간격을 벌립니다.' },
  { type: 'bottomSpacing', label: '하단 여백', description: '본문 아래쪽 간격을 벌립니다.' },
  { type: 'link', label: '링크', description: 'UTM 링크나 지정한 외부 링크를 넣습니다.' },
  { type: 'multiImages', label: '슬라이드/콜라주 이미지', description: '여러 장을 묶은 이미지를 넣습니다.' },
  { type: 'whiteText', label: '흰 글씨', description: '배경과 같은 색 텍스트를 넣습니다.' },
];

const KNOWN_BLOCKS = new Set<string>(CONTENT_BLOCK_CATALOG.map((block) => block.type));

/**
 * content 가 빠지면 원고 본문이 통째로 안 들어가고, 두 번이면 같은 글이 두 번 붙음.
 * 화면에서 순서를 짜다 흔히 내는 실수라 저장 전에 막음.
 */
export const assertValidBlocks = (blocks: string[]): void => {
  if (blocks.length === 0) {
    throw new Error('블록이 비어 있음');
  }

  const unknown = blocks.filter((block) => !KNOWN_BLOCKS.has(block));
  if (unknown.length > 0) {
    throw new Error(`알 수 없는 블록: ${unknown.join(', ')}`);
  }

  const contentCount = blocks.filter((block) => block === 'content').length;
  if (contentCount !== 1) {
    throw new Error(`content 블록이 정확히 한 번 있어야 함 (지금 ${contentCount}번)`);
  }
};

interface ResolveContentPipelineInput {
  /** DB 에서 찾은 계정별 커스텀 순서. 없으면 내장으로 떨어짐. */
  custom?: string[];
  keywordCategory?: string;
  manuscriptType?: ManuscriptType;
  hasExcludeLibrary?: boolean;
}

/**
 * 커스텀이 있으면 사용자가 짠 순서를 그대로 씀.
 * 안과 spacing 자동 제외 같은 내장 보정은 내장 경로에만 적용함.
 * 사용자가 직접 짠 순서를 서버가 말없이 고치면 화면과 결과가 어긋나기 때문임.
 */
export const resolveContentPipelineBlocks = ({
  custom,
  keywordCategory,
  manuscriptType,
  hasExcludeLibrary,
}: ResolveContentPipelineInput): ContentBlock[] => {
  if (custom?.length) {
    return [...custom] as ContentBlock[];
  }

  return getContentPipeline({ keywordCategory, manuscriptType, hasExcludeLibrary });
};

export interface ContentPipelineInput {
  ownerId: string;
  key: string;
  label: string;
  blocks: string[];
  description?: string;
  isActive?: boolean;
  order?: number;
}

export const listContentPipelines = async (ownerId: string) =>
  ContentPipelineModel.find({ ownerId }).sort({ order: 1, createdAt: 1 }).lean();

export const findContentPipeline = async (ownerId: string, key: string) =>
  ContentPipelineModel.findOne({ ownerId, key }).lean();

export const saveContentPipeline = async (input: ContentPipelineInput) => {
  assertValidBlocks(input.blocks);

  return ContentPipelineModel.findOneAndUpdate(
    { ownerId: input.ownerId, key: input.key },
    {
      $set: {
        label: input.label,
        blocks: input.blocks,
        description: input.description ?? '',
        isActive: input.isActive ?? true,
        order: input.order ?? 0,
      },
    },
    { new: true, upsert: true },
  ).lean();
};

export const deleteContentPipeline = async (ownerId: string, key: string): Promise<boolean> => {
  const result = await ContentPipelineModel.deleteOne({ ownerId, key });
  return result.deletedCount > 0;
};

/** 내장 순서를 화면에 출발점으로 보여주기 위한 목록. 읽기 전용임. */
export const listBuiltinPipelines = (): Array<{ key: string; blocks: ContentBlock[] }> => [
  ...Object.entries(CONTENT_PIPELINES).map(([key, blocks]) => ({ key, blocks: [...blocks] })),
  { key: '알리바바', blocks: [...ALIBABA_CONTENT_PIPELINE] },
];
