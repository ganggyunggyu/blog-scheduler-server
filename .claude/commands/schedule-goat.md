# 흑염소 예약발행 스케쥴

흑염소/건강 도메인 예약발행 curl 명령어를 생성합니다.

## 도메인 설정 (고정)

| 항목 | 값 |
|------|-----|
| manuscript_type | `hanryeodamwon` |
| image_source | `product` |
| keyword_category | `한려담원` |

운영 메모:
- 흑염소 스케쥴은 **모든 예약 시각을 `23:50`으로 고정**함
- `schedule_mode` 는 하루 배치 수만 결정하고, 같은 날에 배치된 건들은 모두 `23:50` 기준으로 계산함

## 실행 흐름

### 1단계: 사용자에게 입력 요청

```
흑염소 스케쥴 생성함냥. 아래 정보 알려줘냥:

1. **계정 + 키워드 리스트** (아래 형식으로)
   계정이름
   키워드1
   키워드2
   ...

   계정이름2
   키워드1
   ...

2. **날짜** (YYYY-MM-DD, 생략 시 오늘)
3. **모드** (1/2/3/2121, 생략 시 2)
```

### 2단계: 계정 매칭

계정 정보는 **MongoDB `cafe-bot.accounts` 컬렉션을 source of truth**로 사용해서 조회합니다.

- 사용자가 입력한 계정이름은 DB의 `nickname` 우선, 없으면 `accountId`로 매칭
- 조회 결과에서 `accountId`, `password`를 사용
- `blog_name`은 UTM 용도로 사용자 입력 계정이름을 그대로 유지합니다
- DB 매칭 실패 시 사용자에게 알려주고 DB 레코드 확인 또는 올바른 계정이름을 다시 요청
- `src/constants/account-presets.ts` 같은 로컬 preset 파일은 더 이상 계정 source of truth로 사용하지 않음

### 3단계: 예약시간 선계산

**운영 순서는 기존과 동일하게 `시트 내보내기 -> 스케쥴 생성`을 유지합니다.**

다만 UTM 시트의 **Medium** 값을 `MMDD + 계정이름` 형식으로 맞추기 위해, 시트 내보내기 **직전에만** `calculateSchedule()`로 예약시간을 먼저 계산합니다. 흑염소는 이때도 **모든 시각을 `23:50`으로 고정**합니다.

- 이 선계산은 **시트 내보내기용 날짜코드(MMDD)를 만들기 위한 내부 준비 단계**입니다.
- 외부 작업 순서는 바뀌지 않습니다. 여전히 **UTM 시트 append를 먼저** 하고, 그 다음에 실제 `/bot/auto-schedule` 호출을 합니다.
- 선계산 결과로 나온 각 키워드의 `scheduledAt`에서 `MMDD`를 추출합니다.
- 예시:
  - `2026-03-12T23:50:00+09:00` -> `0312`
  - `2026-04-01T23:50:00+09:00` -> `0401`

```typescript
import { buildScheduleTimingOptions, calculateSchedule } from './src/services/schedule.service.js';

const items = calculateSchedule(
  ['키워드1', '키워드2', '키워드3'],
  '2026-04-01',
  '3',
  buildScheduleTimingOptions({ manuscriptType: 'hanryeodamwon' }),
);
```

**절대 규칙:**
- `calculateSchedule()`는 **한 번만** 계산합니다.
- 시트 append용으로 한 번 계산하고, 스케쥴 생성 때 다시 새로 계산하면 안 됩니다.
- 미래 날짜는 시작 시각/간격에 랜덤이 있어서, 두 번 계산하면 결과가 달라질 수 있습니다.
- 따라서 **같은 `items`를 시트 append와 실제 스케쥴 생성에 함께 재사용**해야 합니다.

### 4단계: UTM 시트 등록

스케쥴 등록 **전에** 구글시트(`블로그 UTM 변환기 26.03`)에 UTM 데이터를 먼저 append합니다.

이때 **3단계에서 선계산한 예약시간**을 사용해서 각 키워드의 `MMDD`를 만든 뒤 시트에 기록합니다.

**중요 규칙:**
- 시트 append와 실제 스케쥴 생성은 **같은 날짜 / 같은 모드 기준의 계산 결과**를 사용해야 합니다.
- `시트 내보내기 -> 스케쥴 생성` 순서는 유지합니다.
- 단순히 현재 월(`MM`)만 쓰면 안 됩니다.
- 반드시 **각 키워드의 실제 예약일자에서 뽑은 `MMDD`**를 써야 합니다.
- 여러 날로 퍼지는 스케쥴이면 각 행의 Medium도 날짜에 따라 달라질 수 있습니다.
  - 예: 1일차 키워드 `0401테스트1`, 2일차 키워드 `0402테스트1`

`src/services/google-sheets.service.ts`의 `appendScheduledBlogUtmRows`로, **미리 계산한 동일한 `items`**를 append에 사용합니다.

```typescript
import { appendScheduledBlogUtmRows } from './src/services/google-sheets.service.js';
import { buildScheduleTimingOptions, calculateSchedule } from './src/services/schedule.service.js';

const items = calculateSchedule(
  ['키워드1', '키워드2', '키워드3'],
  '2026-04-01',
  '3',
  buildScheduleTimingOptions({ manuscriptType: 'hanryeodamwon' }),
);

await appendScheduledBlogUtmRows([
  { name: '계정이름1', items },
]);
```

**UTM 규칙:**
- **Medium** = `MMDD` + 계정이름 (예: `0312테스트3`, `0401테스트1`)
- **Detail** = 키워드 (띄어쓰기 제거)
- **Keyword** = `신로직` (고정)
- **URL** = `https://mkt.shopping.naver.com/link/69ae7140cabd8a23450de0c2` (고정)

실행 후 append된 행 수를 사용자에게 알려줍니다.

**서버 내부 구현 기준:**
1. 요청 전체에 대해 `calculateSchedule()` 선계산
2. 계산 결과로 `appendScheduledBlogUtmRows()` 실행
3. **같은 계산 결과**를 `createSchedule({ items })`에 전달

### 5단계: curl 명령어 생성

```bash
curl -X POST http://localhost:8001/bot/auto-schedule \
  -H "Content-Type: application/json" \
  -d '{
  "queues": [
    {
      "account": { "id": "{계정ID}", "password": "{비밀번호}" },
      "keywords": ["{키워드1}", "{키워드2}", ...],
      "blog_name": "{계정이름}"
    }
  ],
  "schedule_date": "{날짜 또는 생략}",
  "schedule_mode": "{모드}",
  "generate_images": true,
  "image_count": 5,
  "image_source": "product",
  "manuscript_type": "hanryeodamwon",
  "delay_between_posts": 10,
  "keyword_category": "한려담원"
}'
```

**`blog_name`**: UTM 시트 lookup에 사용됩니다. 사용자가 입력한 계정이름(예: `테스트1`, `윈터`)을 그대로 넣습니다. DB 조회 결과의 `nickname`을 보조값으로 사용할 수 있지만, 기본은 사용자 입력 계정이름을 그대로 유지합니다.

### 6단계: 로그 모니터링 (필수)

스케쥴 등록 성공 후 반드시 `/loop 2m` 모니터링을 세팅합니다. **모델은 sonnet으로 지정합니다.**

```
/loop 2m curl -s http://localhost:8001/api/queues/dashboard | jq '[.accounts[] | select(.generate.active > 0 or .generate.waiting > 0 or .publish.active > 0 or .publish.waiting > 0 or .generate.failed > 0 or .publish.failed > 0) | {account: .accountId, gen: "\(.generate.completed)/\(.generate.completed + .generate.waiting + .generate.active)", pub: "\(.publish.completed)/\(.publish.completed + .publish.waiting + .publish.active)", failed: (.generate.failed + .publish.failed)}]'
```

### 7단계: 네이버 실확인 (필수)

모니터링이 끝났다고 바로 완료 처리하지 않습니다. 반드시 **OpenClaw 브라우저**로 네이버에 직접 로그인해서 최종 확인합니다.

기본 확인 흐름:
- 계정으로 네이버 로그인
- `https://blog.naver.com/{blogId}?Redirect=Write` 진입
- 상단의 `예약 발행 N건` 버튼 클릭
- **실제 예약 건수**, **방금 등록한 흑염소 키워드/제목 존재 여부**, **예약 시각** 확인
- 스케쥴 날짜에 `오늘`이 포함되어 이미 발행된 글이 있다면 `https://blog.naver.com/PostList.naver?blogId={blogId}&from=postList` 로 이동
- **오늘 발행된 제목 존재 여부**, **글목록 최상단 반영 여부**, **하루 배분 개수**를 한 번 더 확인

보고 규칙:
- `완료`, `정상 등록`, `개수 맞음` 같은 확정 표현은 이 실확인 후에만 사용
- 실확인 전에는 `내부 상태상 성공`, `실확인 전`, `진행 중`처럼 구분해서 보고

### 8단계: 요약 출력

| 항목 | 값 |
|------|-----|
| 도메인 | 흑염소 |
| 계정 | 계정명(ID) × N개 |
| 총 키워드 | N개 |
| 원고 | hanryeodamwon |
| 이미지 | product |
| 모드 | N (하루 N개) |
| 예상 소요일 | 계정별 키워드수 ÷ 모드 |

### 9단계: 발행 현황 시트 기록 (필수)

실확인까지 완료한 후, 아래 구글시트에 결과를 정리합니다.

**시트 URL**: https://docs.google.com/spreadsheets/d/1oUo85a9m3MTTzWeX8FGnKZqCDfPRNdGZFxr4-vZqSrM/edit?gid=0#gid=0

기록 항목:
- 날짜, 도메인(흑염소), 계정명, 계정ID, 키워드, 발행상태(예약/발행완료/실패), 모드, 실확인결과
- 실확인에서 확인된 제목, 예약시각 등도 함께 기록
