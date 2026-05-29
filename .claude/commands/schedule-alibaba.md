# 알리바바 예약발행 스케쥴

알리바바(1688/구매대행) 도메인 예약발행 curl 명령어를 생성합니다.

## 도메인 설정 (고정)

| 항목 | 값 |
|------|-----|
| manuscript_type | `alibaba` |
| image_source | `product` |
| keyword_category | `기타` |
| schedule_mode | `3` (하루 3건 고정, 서버에서 강제) |

운영 메모:
- 알리바바 원고는 `/generate/blog-filler` 엔드포인트로 생성됨
- `schedule_mode`는 요청에 뭘 보내든 서버(`resolveScheduleMode`)가 `3`으로 강제함
- 에디터 파이프라인은 `ALIBABA_CONTENT_PIPELINE` (라이브러리제외 → spacing → content → spacing → multiImages → whiteText)

## 실행 흐름

### 1단계: 사용자에게 입력 요청

```
알리바바 스케쥴 생성함냥. 아래 정보 알려줘냥:

1. **계정 + 키워드 리스트** (아래 형식으로)
   계정이름
   키워드1
   키워드2
   ...

   계정이름2
   키워드1
   ...

2. **날짜** (YYYY-MM-DD, 생략 시 오늘)

※ 모드는 하루 3건 고정이라 입력 불필요함냥.
```

### 2단계: 계정 매칭

계정 정보는 **MongoDB `cafe-bot.accounts` 컬렉션을 source of truth**로 사용해서 조회합니다.

- 사용자가 입력한 계정이름은 DB의 `nickname` 우선, 없으면 `accountId`로 매칭
- 조회 결과에서 `accountId`, `password`를 사용
- DB 매칭 실패 시 사용자에게 알려주고 DB 레코드 확인 또는 올바른 계정이름을 다시 요청
- `src/constants/account-presets.ts` 같은 로컬 preset 파일은 더 이상 계정 source of truth로 사용하지 않음

### 3단계: curl 명령어 생성

```bash
curl -X POST http://localhost:8001/bot/auto-schedule \
  -H "Content-Type: application/json" \
  -d '{
  "queues": [
    {
      "account": { "id": "{계정ID}", "password": "{비밀번호}" },
      "keywords": ["{키워드1}", "{키워드2}", ...]
    }
  ],
  "schedule_date": "{날짜 또는 생략}",
  "schedule_mode": "3",
  "generate_images": true,
  "image_count": 5,
  "image_source": "product",
  "manuscript_type": "alibaba",
  "delay_between_posts": 10,
  "keyword_category": "기타"
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
- **실제 예약 건수**, **방금 등록한 알리바바 키워드/제목 존재 여부**, **예약 시각** 확인
- 스케쥴 날짜에 `오늘`이 포함되어 이미 발행된 글이 있다면 `https://blog.naver.com/PostList.naver?blogId={blogId}&from=postList` 로 이동
- **오늘 발행된 제목 존재 여부**, **글목록 최상단 반영 여부**, **하루 배분 개수(3건)** 를 한 번 더 확인

보고 규칙:
- `완료`, `정상 등록`, `개수 맞음` 같은 확정 표현은 이 실확인 후에만 사용
- 실확인 전에는 `내부 상태상 성공`, `실확인 전`, `진행 중`처럼 구분해서 보고

### 6단계: 요약 출력

| 항목 | 값 |
|------|-----|
| 도메인 | 알리바바 |
| 계정 | 계정명(ID) × N개 |
| 총 키워드 | N개 |
| 원고 | alibaba |
| 이미지 | product |
| 모드 | 3 (하루 3개 고정) |
| 예상 소요일 | 계정별 키워드수 ÷ 3 |

### 7단계: 발행 현황 시트 기록 (필수)

실확인까지 완료한 후, 아래 구글시트에 결과를 정리합니다.

**시트 URL**: https://docs.google.com/spreadsheets/d/1oUo85a9m3MTTzWeX8FGnKZqCDfPRNdGZFxr4-vZqSrM/edit?gid=0#gid=0

기록 항목:
- 날짜, 도메인(알리바바), 계정명, 계정ID, 키워드, 발행상태(예약/발행완료/실패), 모드(3), 실확인결과
- 실확인에서 확인된 제목, 예약시각 등도 함께 기록
