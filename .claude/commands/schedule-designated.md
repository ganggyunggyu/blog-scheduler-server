# 업체지정블로그 예약발행 스케쥴

업체지정블로그(추상의구체화/윤슬) 예약발행 curl 명령어를 생성합니다. 도메인 특화 설정이 필요하면 `/schedule-pet`, `/schedule-eye`, `/schedule-goat`를 사용하세요.

## 도메인 설정 (고정)

| 항목 | 값 |
|------|-----|
| manuscript_type | `default` |
| image_source | `ai` |
| keyword_category | 계정의 category 사용 |

## 키워드 시트 (추상의구체화 / 윤슬)

추상의구체화·윤슬 카테고리는 **같은 스프레드시트 안의 서로 다른 시트(gid)** 에서 키워드를 가져옵니다:

| 카테고리 | 시트 URL | gviz CSV URL |
|------|-----|-----|
| 추상의구체화 | `https://docs.google.com/spreadsheets/d/1c9TJ1gETtunuCmzfzap-2lyqXj1cwzITOb1k8W4tL8c/edit?gid=1729073770#gid=1729073770` | `https://docs.google.com/spreadsheets/d/1c9TJ1gETtunuCmzfzap-2lyqXj1cwzITOb1k8W4tL8c/gviz/tq?tqx=out:csv&gid=1729073770` |
| 윤슬 | `https://docs.google.com/spreadsheets/d/1c9TJ1gETtunuCmzfzap-2lyqXj1cwzITOb1k8W4tL8c/edit?gid=1449378227#gid=1449378227` | `https://docs.google.com/spreadsheets/d/1c9TJ1gETtunuCmzfzap-2lyqXj1cwzITOb1k8W4tL8c/gviz/tq?tqx=out:csv&gid=1449378227` |

### 키워드 선별 규칙
1. 시트에서 **미노출** 키워드를 가져옴 (노출여부가 비어있는 행)
2. 메인 키워드와 서브/롱테일 키워드를 **랜덤으로 섞어서** 배분
3. 같은 계정에 유사 키워드가 연속 배치되지 않도록 분산
4. 계정별 `하루 모드 수` 만큼 키워드 배정

### 대상 계정
- **추상의구체화**: 똑똑한건희씨(orangeswan630), 고래낚시(bigfish773)
- **윤슬**: 앵그리맨(angrykoala270), 티니피쉬(tinyfish183)

### 시트 선택 규칙
1. 계정 또는 DB `category` 가 `추상의구체화`면 **반드시 `gid=1729073770`** 에서 키워드를 가져옴
2. 계정 또는 DB `category` 가 `윤슬`이면 **반드시 `gid=1449378227`** 에서 키워드를 가져옴
3. 두 카테고리를 같은 `gid` 로 취급하지 않음

### 키워드 시트가 없는 카테고리
시트가 등록되지 않은 카테고리는 기존처럼 사용자에게 직접 키워드를 입력받습니다.

## 실행 흐름

### 1단계: 사용자에게 입력 요청

키워드 시트가 있는 카테고리(추상의구체화/윤슬)인 경우:
```
스케쥴 생성함냥. 아래 정보 알려줘냥:

1. **계정** (추상의구체화/윤슬 중 사용할 계정)
2. **며칠치** (생략 시 1일)
3. **날짜** (YYYY-MM-DD, 생략 시 오늘)
4. **모드** (1/2/3/2121, 생략 시 2)

키워드는 시트에서 미노출 건 자동으로 가져옴냥.
```

키워드 시트가 없는 카테고리인 경우:
```
스케쥴 생성함냥. 아래 정보 알려줘냥:

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
- `category`가 DB에 있으면 그 값을 `keyword_category`로 우선 사용하고, 없으면 현재 도메인/카테고리 문맥값을 사용
- DB 매칭 실패 시 사용자에게 알려주고 DB 레코드 확인 또는 올바른 계정이름을 다시 요청
- `src/constants/account-presets.ts` 같은 로컬 preset 파일은 더 이상 계정 source of truth로 사용하지 않음

### 3단계: 키워드 준비

**시트 연동 카테고리**: 카테고리별 gviz CSV URL로 해당 시트를 fetch → 미노출 키워드 추출 → 메인/서브 랜덤 섞기 → 계정별 배분
**수동 입력 카테고리**: 사용자가 입력한 키워드 그대로 사용

### 4단계: curl 명령어 생성

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
  "schedule_mode": "{모드}",
  "generate_images": true,
  "image_count": 5,
  "image_source": "ai",
  "manuscript_type": "default",
  "delay_between_posts": 10,
  "keyword_category": "{계정 category}"
}'
```

### 5단계: 로그 모니터링 (필수)

스케쥴 등록 성공 후 반드시 `/loop 2m` 모니터링을 세팅합니다. **모델은 sonnet으로 지정합니다.**

```
/loop 2m curl -s http://localhost:8001/api/queues/dashboard | jq '[.accounts[] | select(.generate.active > 0 or .generate.waiting > 0 or .publish.active > 0 or .publish.waiting > 0 or .generate.failed > 0 or .publish.failed > 0) | {account: .accountId, gen: "\(.generate.completed)/\(.generate.completed + .generate.waiting + .generate.active)", pub: "\(.publish.completed)/\(.publish.completed + .publish.waiting + .publish.active)", failed: (.generate.failed + .publish.failed)}]'
```

### 6단계: 네이버 실확인 (필수)

모니터링이 끝났다고 바로 완료 처리하지 않습니다. 반드시 **OpenClaw 브라우저**로 네이버에 직접 로그인해서 최종 확인합니다.

기본 확인 흐름:
- 계정으로 네이버 로그인
- `https://blog.naver.com/{blogId}?Redirect=Write` 진입
- 상단의 `예약 발행 N건` 버튼 클릭
- **실제 예약 건수**, **방금 등록한 키워드/제목 존재 여부**, **예약 시각** 확인
- 스케쥴 날짜에 `오늘`이 포함되어 이미 발행된 글이 있다면 `https://blog.naver.com/PostList.naver?blogId={blogId}&from=postList` 로 이동
- **오늘 발행된 제목 존재 여부**, **글목록 최상단 반영 여부**, **하루 배분 개수**를 한 번 더 확인

보고 규칙:
- `완료`, `정상 등록`, `개수 맞음` 같은 확정 표현은 이 실확인 후에만 사용
- 실확인 전에는 `내부 상태상 성공`, `실확인 전`, `진행 중`처럼 구분해서 보고

### 7단계: 요약 출력

| 항목 | 값 |
|------|-----|
| 도메인 | 기본 |
| 계정 | 계정명(ID) × N개 |
| 총 키워드 | N개 |
| 원고 | default |
| 이미지 | ai |
| 모드 | N (하루 N개) |
| 예상 소요일 | 계정별 키워드수 ÷ 모드 |

### 8단계: 발행 현황 시트 기록 (필수)

실확인까지 완료한 후, 아래 구글시트에 결과를 정리합니다.

**시트 URL**: https://docs.google.com/spreadsheets/d/1oUo85a9m3MTTzWeX8FGnKZqCDfPRNdGZFxr4-vZqSrM/edit?gid=0#gid=0

기록 항목:
- 날짜, 도메인, 계정명, 계정ID, 키워드, 발행상태(예약/발행완료/실패), 모드, 실확인결과
- 실확인에서 확인된 제목, 예약시각 등도 함께 기록
