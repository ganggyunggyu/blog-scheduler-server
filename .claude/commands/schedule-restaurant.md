# 맛집 예약발행 스케쥴

맛집 도메인 예약발행을 등록합니다.

## 도메인 설정 (고정)

| 항목 | 값 |
|------|-----|
| manuscript_type | `restaurant1` / `restaurant2` (항목별로 번갈아) |
| image_source | `google` |
| service | `restaurant` |
| keyword_category | `맛집` |

## 대윤기획 운영 규칙 (필수)

1. **맛집1 / 맛집2 번갈아 작성** — `restaurant1`(`/generate/restaurant/v1`), `restaurant2`(`/generate/restaurant/v2`) 를 한 계정 안에서 교대로 씁니다.
2. **블로그 하나 = 같은 권역** — 계정마다 권역을 고정합니다. 현재 배분은 아래 5권역입니다.
   - 인천/부천
   - 서울 전체
   - 일산/파주
   - 수원/동탄/광교/용인/분당
   - 대구/포항/경산/구미/경주
3. **업체명은 전체에서 한 번도 겹치면 안 됨** — 글마다 다른 식당이어야 합니다.
4. **하루 2개** (`schedule_mode: "2"`).

### 업체명을 반드시 지정하는 이유

`business_name` 을 비우면 dabut 쪽 `resolve_restaurant_ref` 가 키워드만 보고 업체를 자유 선택하는데, 같은 상권 키워드는 계속 같은 식당으로 수렴합니다. 실제로 "식당 똑같은 애만 적음" 컴플레인이 여기서 나왔습니다. 그래서 항목마다 **웹검색으로 실존이 확인된** 업체명을 고정해서 넣습니다.

맛집2는 `blog_name` 으로 캐릭터를 고정합니다 (`블루망고`, `제이제이`, `삼남매`, `사랑채`, `호이호이`, `바글바글` 중 하나). 계정마다 하나로 고정해서 화자가 흔들리지 않게 합니다. 맛집1은 이 값을 무시합니다.

## 등록 방법 (권장)

플랜 JSON 을 만들고 `scripts/restaurant-schedule.ts` 로 등록합니다. 이 스크립트는 등록 전에 업체명 중복/누락과 캐릭터명을 검증해서, 규칙을 어기면 등록 자체를 중단합니다. 비밀번호가 들어가므로 플랜 파일은 레포 밖(스크래치패드)에 둡니다.

```bash
npx tsx scripts/restaurant-schedule.ts <plan.json> --dry-run   # 배정 확인
npx tsx scripts/restaurant-schedule.ts <plan.json>             # 실제 등록
```

플랜 JSON 형식:

```json
{
  "scheduleDate": "2026-07-27",
  "scheduleMode": "2",
  "accounts": [
    {
      "accountId": "{계정ID}",
      "password": "{비밀번호}",
      "region": "인천/부천",
      "blogCharacter": "블루망고",
      "startOffset": 0,
      "targets": [
        { "keyword": "부천상동맛집", "businessName": "긴꼬리초밥" }
      ]
    }
  ]
}
```

`startOffset` 이 0이면 맛집1부터, 1이면 맛집2부터 시작합니다.

## 실행 흐름

### 1단계: 사용자에게 입력 요청

```
맛집 스케쥴 생성함냥. 아래 정보 알려줘냥:

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
- DB 매칭 실패 시 사용자에게 알려주고 DB 레코드 확인 또는 올바른 계정이름을 다시 요청
- `src/constants/account-presets.ts` 같은 로컬 preset 파일은 더 이상 계정 source of truth로 사용하지 않음

### 3단계: 요청 페이로드 (스크립트를 안 쓰고 직접 부를 때)

`item_options` 는 `keywords` 와 같은 길이여야 하고, 길이가 다르면 400 으로 막힙니다.

```bash
curl -X POST http://localhost:8001/bot/auto-schedule \
  -H "Content-Type: application/json" \
  -d '{
  "queues": [
    {
      "account": { "id": "{계정ID}", "password": "{비밀번호}" },
      "keywords": ["부천상동맛집", "인천부평맛집"],
      "item_options": [
        { "businessName": "긴꼬리초밥", "manuscriptType": "restaurant1" },
        { "businessName": "복화루", "manuscriptType": "restaurant2" }
      ],
      "blog_name": "블루망고"
    }
  ],
  "schedule_date": "{날짜 또는 생략}",
  "schedule_mode": "2",
  "service": "restaurant",
  "generate_images": true,
  "image_count": 5,
  "image_source": "google",
  "manuscript_type": "restaurant1",
  "delay_between_posts": 10,
  "keyword_category": "맛집"
}'
```

### 4단계: 로그 모니터링 (필수)

스케쥴 등록 성공 후 반드시 `/loop 2m` 모니터링을 세팅합니다. **모델은 sonnet으로 지정합니다.**

```
/loop 2m curl -s http://localhost:8001/api/queues/dashboard | jq '[.accounts[] | select(.generate.active > 0 or .generate.waiting > 0 or .publish.active > 0 or .publish.waiting > 0 or .generate.failed > 0 or .publish.failed > 0) | {account: .accountId, gen: "\(.generate.completed)/\(.generate.completed + .generate.waiting + .generate.active)", pub: "\(.publish.completed)/\(.publish.completed + .publish.waiting + .publish.active)", failed: (.generate.failed + .publish.failed)}]'
```

### 5단계: 네이버 실확인 (필수)

모니터링이 끝났다고 바로 완료 처리하지 않습니다. 반드시 **OpenClaw 브라우저**로 네이버에 직접 로그인해서 최종 확인합니다.

기본 확인 흐름:
- 계정으로 네이버 로그인
- `https://blog.naver.com/{blogId}?Redirect=Write` 진입
- 상단의 `예약 발행 N건` 버튼 클릭
- **실제 예약 건수**, **방금 등록한 맛집 키워드/제목 존재 여부**, **예약 시각** 확인
- 스케쥴 날짜에 `오늘`이 포함되어 이미 발행된 글이 있다면 `https://blog.naver.com/PostList.naver?blogId={blogId}&from=postList` 로 이동
- **오늘 발행된 제목 존재 여부**, **글목록 최상단 반영 여부**, **하루 배분 개수**를 한 번 더 확인

보고 규칙:
- `완료`, `정상 등록`, `개수 맞음` 같은 확정 표현은 이 실확인 후에만 사용
- 실확인 전에는 `내부 상태상 성공`, `실확인 전`, `진행 중`처럼 구분해서 보고

### 6단계: 요약 출력

| 항목 | 값 |
|------|-----|
| 도메인 | 맛집 |
| 계정 | 계정명(ID) × N개 |
| 총 키워드 | N개 |
| 원고 | restaurant |
| 이미지 | google |
| 모드 | N (하루 N개) |
| 예상 소요일 | 계정별 키워드수 ÷ 모드 |

### 7단계: 발행 현황 시트 기록 (필수)

실확인까지 완료한 후, 아래 구글시트에 결과를 정리합니다.

**시트 URL**: https://docs.google.com/spreadsheets/d/1oUo85a9m3MTTzWeX8FGnKZqCDfPRNdGZFxr4-vZqSrM/edit?gid=0#gid=0

기록 항목:
- 날짜, 도메인(맛집), 계정명, 계정ID, 키워드, 발행상태(예약/발행완료/실패), 모드, 실확인결과
- 실확인에서 확인된 제목, 예약시각 등도 함께 기록
