import type { DomainPreset } from '../model';

/*
  .claude/commands/schedule-*.md 의 고정값을 그대로 옮긴 것.
  스킬 문서가 바뀌면 여기도 같이 고쳐야 한다.
*/
export const DOMAIN_PRESETS: DomainPreset[] = [
  {
    id: 'restaurant',
    label: '맛집',
    service: 'restaurant',
    imageSource: 'google',
    manuscriptType: 'restaurant/v1',
    keywordCategory: '맛집',
    scheduleMode: '2',
    requiresBusinessName: true,
    alternatingTypes: ['restaurant/v1', 'restaurant/v2'],
    note: '업체명은 전체 배치에서 한 번도 겹치면 안 되고, 계정마다 권역을 고정합니다.',
  },
  {
    id: 'pet',
    label: '서리펫(애견)',
    service: 'default',
    imageSource: 'product',
    manuscriptType: 'pet',
    keywordCategory: '애견',
    scheduleMode: '2',
    requiresBusinessName: false,
    note: '애견은 image_source 를 반드시 product 로 보냅니다. keyword/ai 는 금지입니다.',
  },
  {
    id: 'goat',
    label: '흑염소(한려담원)',
    service: 'default',
    imageSource: 'product',
    manuscriptType: 'hanryeodamwon',
    keywordCategory: '한려담원',
    scheduleMode: '2',
    requiresBusinessName: false,
    note: '미노출 키워드만 골라서 등록합니다.',
  },
  {
    id: 'eye',
    label: '안과(풀패키지)',
    service: 'default',
    imageSource: 'product',
    manuscriptType: 'default',
    keywordCategory: '안과',
    scheduleMode: '2',
    requiresBusinessName: false,
    note: '기본은 풀패키지(안과)입니다. 기본 모드는 안과기본, 브랜드 계정은 안과브랜드로 바꿔주세요.',
  },
  {
    id: 'alibaba',
    label: '알리바바',
    service: 'default',
    imageSource: 'product',
    manuscriptType: 'alibaba',
    keywordCategory: '기타',
    scheduleMode: '3',
    requiresBusinessName: false,
    note: '하루 3건은 서버에서 강제되므로 모드를 바꿔 보내도 3으로 처리됩니다.',
  },
  {
    id: 'designated',
    label: '업체지정블로그',
    service: 'default',
    imageSource: 'ai',
    manuscriptType: 'default',
    keywordCategory: '',
    scheduleMode: '2',
    requiresBusinessName: false,
    note: 'keyword_category 는 계정에 설정된 카테고리를 그대로 씁니다.',
  },
];

const FALLBACK_PRESET = DOMAIN_PRESETS[0] as DomainPreset;

export const findPreset = (id: string): DomainPreset =>
  DOMAIN_PRESETS.find((preset) => preset.id === id) ?? FALLBACK_PRESET;
