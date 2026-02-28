export interface AccountPreset {
  name: string;
  id: string;
  password: string;
  mvpn?: string;
  category?: string;
  blogId?: string;
}

export const DEFAULT_ACCOUNT_CATEGORY = '기타';

export const ACCOUNT_PRESETS: AccountPreset[] = [
  // 흑염소
  {
    name: '패밀리넛',
    id: 'ecjroe6558',
    password: 'skg10i03',
    mvpn: 'gkgb6060',
    category: '흑염소',
  },
  {
    name: '꿈꾸는 나날',
    id: 'shcint',
    password: 'sadito0229!',
    mvpn: 'gkgb2000',
    category: '흑염소',
  },

  // 약재효능
  {
    name: '빨간모자앤 - 준3',
    id: 'dhtksk1p',
    password: 'dhtksk1pp',
    mvpn: 'gkgb6060',
    category: '흑염소',
  },
  {
    name: '정의 - 준4',
    id: 'eqsdxv2863',
    password: '1ll2$8rl',
    mvpn: 'gkgb9900',
    category: '흑염소',
  },

  // 다이어트 보조제
  {
    name: '찐찐찐찐찐이야',
    id: 'ags2oigb',
    password: 'dlrbghdqudtls',
    mvpn: 'gkgb9900',
    category: '다이어트 보조제',
  },

  // 안과
  {
    name: '에스앤비안과 1',
    id: 'mixxut',
    password: 'sadito0229!',
    mvpn: 'gkgb4040',
    category: '안과',
  },
  {
    name: '에스앤비안과 2',
    id: 'ynattg',
    password: 'sadito0229!',
    mvpn: 'gkgb4040',
    category: '안과',
  },

  // 피부과
  {
    name: '얼음땡 - 준4',
    id: 'cookie4931',
    password: 'akfalwk12!',
    mvpn: 'gkgb660',
    category: '피부시술',
  },

  // 치과
  {
    name: '투디치과 스킨블',
    id: 'wound12567',
    password: 'akfalwk12',
    mvpn: 'gkgb660',
    category: '치과',
  },

  // 약처방
  {
    name: '토토리토',
    id: 'precede1451',
    password: 'akfalwk12!!',
    mvpn: 'gkgb660',
    category: '약처방',
  },

  // 도그마루 글밥
  {
    name: '운명의 마법사',
    id: 'dyulp',
    password: 'sadito0229!',
    mvpn: 'gkgb5050',
    category: '도그마루 글밥',
  },
  {
    name: '맛집 탐험대',
    id: 'lesyt',
    password: 'sadito0229!',
    mvpn: 'gkgb5050',
    category: '도그마루 글밥',
  },
  {
    name: '먹방 여행기',
    id: 'aryunt',
    password: 'sadito0229!',
    mvpn: 'gkgb5050',
    category: '도그마루 글밥',
  },
  {
    name: '라우드',
    id: 'loand3324',
    password: 'akfalwk123!',
    mvpn: 'gkgb5005',
    category: '도그마루 글밥',
  },
  {
    name: '고구마스틱',
    id: 'fail5644',
    password: 'akfalwk11!',
    mvpn: 'gkgb5005',
    category: '도그마루 글밥',
  },
  {
    name: '룰루랄라',
    id: 'compare14310',
    password: 'akfalwk112!',
    mvpn: 'gkgb5005',
    category: '도그마루 글밥',
  },
  {
    name: '글로벌',
    id: 'gmezz',
    password: 'sadito0006',
    mvpn: 'gkgb6600',
    category: '도그마루 글밥',
  },

  // 서리펫
  {
    name: '새로운 여행지',
    id: 'zhuwl',
    password: 'akfalwk12',
    mvpn: 'gkgb6600',
    category: '서리펫',
  },
  {
    name: '은길',
    id: 'enugii',
    password: 'sadito0229!',
    mvpn: 'gkgb6600',
    category: '서리펫',
  },
  {
    name: '떠나는날의 이야기',
    id: 'nnhha',
    password: 'akfalwk12',
    mvpn: 'gkgb6600',
    category: '서리펫',
  },
  {
    name: '투데이',
    id: 'aqahdp5252',
    password: 'cebtg95289',
    mvpn: 'gkgb3000',
    category: '서리펫',
  },

  // 법률
  {
    name: '해리포터',
    id: 'selzze',
    password: 'sadito0229!',
    mvpn: 'gkgb4400',
    category: '흑염소',
  },

  // 인터넷가입
  {
    name: '불꽃',
    id: 'bjwuo',
    password: 'sadito0229!',
    mvpn: 'gkgb4400',
    category: '흑염소',
  },

  // 수족냉증+질병 관련
  {
    name: '새로운 발견',
    id: 'ebbte',
    password: 'sadito0229!',
    mvpn: 'gkgb2000',
    category: '흑염소',
  },
  {
    name: '미식가',
    id: 'yenalk',
    password: 'sadito0229!',
    mvpn: 'gkgb3000',
    category: '흑염소',
  },

  // 원기회복+(건강관련)
  {
    name: '다이어리',
    id: 'ganir',
    password: 'sadito0229!',
    mvpn: 'gkgb2000',
    category: '흑염소',
  },
  {
    name: '새로운 시작',
    id: 'dyust',
    password: 'sadito0229!',
    mvpn: 'gkgb3000',
    category: '흑염소',
  },

  // 탈모관련병원
  {
    name: '숙면구출',
    id: 'momenft5251',
    password: 'sadito022!!_1224',
    category: '흑염소',
  },

  // 정형외과
  {
    name: '고뇌물렁',
    id: 'column13365',
    password: 'seo250526!asd',
    category: '흑염소',
  },

  // 기타
  {
    name: '수정 테스트 계정',
    id: 'sihhnl',
    password: 'sadito0229!',
    mvpn: 'gkgb6060',
    category: '테스트',
  },
  {
    name: '레플전용',
    id: 'boy848',
    password: 'jito308154',
    mvpn: 'gkgb6060',
    category: '기타',
  },
  {
    name: '타래',
    id: 'dhfosk1p',
    password: 'dhtksk1pp',
    mvpn: 'gkgb6060',
    category: '기타',
  },
  {
    name: 'chill guy - 준3',
    id: 'dlfgydnjs1p',
    password: 'dlfgydnjs1ppa12',
    mvpn: 'gkgb9900',
    category: '기타',
  },
  {
    name: '에스앤비안과-준4',
    id: 'vocabulary1215',
    password: 'AKFALWK12',
    mvpn: 'gkgb4040',
    category: '안과',
  },
  {
    name: '에스앤비안과 정보',
    id: 'nahhjo',
    password: 'dptmdosql2020',
    category: '에스앤비안과',
  },
  {
    name: '에스앤비안과, 28년 경력',
    id: 'mzuul',
    password: 'dptmdosql2020',
    category: '에스앤비안과',
  },
  {
    name: '에스앤비안과의원',
    id: 'hagyga',
    password: 'dptmdosql2020',
    category: '에스앤비안과',
  },
  {
    name: '모험',
    id: 'geenl',
    password: 'dptmdosql2020',
    category: '에스앤비안과-백업',
  },
  {
    name: '탐험기',
    id: 'ghhoy',
    password: 'snbeye2020!',
    category: '에스앤비안과-백업',
  },
  {
    name: '에스앤비안과-준6',
    id: 'zoeofx5611',
    password: 'ddito3088',
    mvpn: 'gkgb4040',
    category: '안과',
  },
  {
    name: '토토로-준3',
    id: 'tjthtjs5p',
    password: 'tjthtjs7pp',
    mvpn: 'gkgb6600',
    category: '기타',
  },
  {
    name: '지구탐구생활-준5',
    id: 'wd6edn3b',
    password: 'akfalwk12',
    mvpn: 'gkgb6600',
    category: '기타',
  },
  {
    name: '부활 - 준6',
    id: 'ihut9094',
    password: 'AKFALWK12',
    mvpn: 'gkgb6600',
    category: '기타',
  },
  {
    name: '으라차차-준3',
    id: '3goc9xkq',
    password: 'akfalwk12',
    mvpn: 'gkgb6600',
    category: '기타',
  },
  {
    name: '도그마루(강아지) - 웨드',
    id: 'weddindg1218',
    password: 'akfalwk12!',
    mvpn: 'gkgb5050',
    category: '도그마루',
  },
  {
    name: '도그마루(강아지) - 에일리',
    id: 'alien8118',
    password: 'akfalwk12',
    mvpn: 'gkgb5050',
    category: '도그마루',
  },
  {
    name: '도그마루(고양이) - 마이블',
    id: 'disadvantage6171',
    password: 'akfalwk12',
    mvpn: 'gkgb5050',
    category: '도그마루',
  },
  {
    name: '블루망고 부활',
    id: 'busansmart',
    password: '01036873573aaBB',
    mvpn: 'gkgb550',
    category: '맛집',
  },
  {
    name: '제이제이 (26.06.15 만료)',
    id: 'dnation09',
    password: 'ee1186zz**',
    mvpn: 'gkgb550',
    category: '맛집',
  },
  {
    name: '철인삼남매(25.12.12 만료)',
    id: 'dreamclock33',
    password: 'ehfpalvk8888',
    mvpn: 'gkgb5500',
    category: '맛집',
  },
  {
    name: '사랑채마켓 (26.06.30 만료)',
    id: 'snk92789',
    password: 'hee152700*#',
    mvpn: 'gkgb5500',
    category: '맛집',
  },
  {
    name: '전화하지마세요- 윤우 (26.05.28 만료)',
    id: 'surreal805',
    password: 'Company4567',
    blogId: 'surreal805',
    category: '맛집',
  },
  {
    name: '호이호이',
    id: 'sw078',
    password: 'mmhr307511!',
    mvpn: 'gkgb0101',
    category: '기타',
  },
  {
    name: '바글바글',
    id: 'seowoo7603',
    password: 'sksekgh11!',
    mvpn: 'gkgb0101',
    category: '기타',
  },
  {
    name: '테스트1',
    id: 'akepzkthf12',
    password: 'rkdrudrb123!',
    category: '테스트',
  },
  {
    name: '테스트2',
    id: 'qwzx16',
    password: 'rkdrudrb123!',
    category: '테스트',
  },
  {
    name: '테스트3',
    id: 'ggg8019',
    password: '12Qwaszx!@',
    category: '테스트',
  },
];

const presetMap = new Map(ACCOUNT_PRESETS.map((preset) => [preset.id, preset]));

export const findAccountById = (id: string): AccountPreset | undefined =>
  presetMap.get(id);
