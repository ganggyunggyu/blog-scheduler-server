# 안과 예약발행 스케쥴

안과 도메인 예약발행 curl 명령어를 생성합니다.

## 도메인 설정

| 항목 | 값 |
|------|-----|
| manuscript_type | `default` |
| image_source | `product` |
| keyword_category | **모드별 분기 (아래)** |

## 파이프라인 모드 (keyword_category 값)

| 모드 | keyword_category | 포함 블록 | 사용 상황 |
|------|------------------|-----------|----------|
| **기본** | `안과기본` | maps → content → multiImages | 라이브러리제외 이미지/링크 없이 발행 |
| **풀패키지** | `안과` | allExcluded → excludeLibraryLinks → maps → content → multiImages | 라이브러리제외 이미지 + 링크 삽입까지 포함 |
| **브랜드** | `안과브랜드` | content(슬라이드 일반 이미지 교차 삽입) → multiImages(남은 개별/콜라주만) | `adplan3th` 에스앤비 브랜드 글 패턴 |

모드 선택은 1단계에서 사용자에게 묻습니다. 생략 시 일반 안과 계정은 **풀패키지**, `adplan3th` 브랜드 계정은 **브랜드** 기본값.

### 브랜드 계정 패턴

기준 글: `https://blog.naver.com/adplan3th/224312025673`

- 네이버 카테고리: `에스앤비 안과`
- 이미지: 세로형 slide 이미지 6장
- 본문 시작: 제목 필드와 별개로 원고 본문 첫 줄에 제목을 한 번 더 노출
- 배치: `정밀검사로 한 사람 한 사람 눈을 들여다보는 에스앤비안과입니다` 인사말 직후 첫 이미지, 이후 `[IMG] ...` 자리표시자 또는 소제목 뒤에 slide 이미지를 일반 이미지로 삽입
- 제거: `[IMG] ...` 자리표시자와 단독 URL 줄은 본문 텍스트로 쓰지 않음
- 제외: 지도, 전화, 외부 링크, 라이브러리제외 이미지/링크는 넣지 않음
- `keyword_category: "안과브랜드"`는 에디터 파이프라인 키이며, 발행 카테고리는 서버에서 기본 `에스앤비 안과`로 분리 처리함

## 키워드 관리 규칙

- **키워드 시트**에서 미사용 키워드를 우선 배정
- 시트의 키워드를 **한 바퀴 다 돌면 리셋**하고 처음부터 다시 사용 가능
- 같은 계정에 **같은 메인 키워드 루트**(예: 라식→라식라섹→라식가격) 연속 배정 금지
- 하루 3개 키워드는 **서로 다른 루트**로 구성
- 사용 키워드는 `memory/project_used_keywords.md`에 기록

## 실행 흐름

### 1단계: 사용자에게 입력 요청

```
안과 스케쥴 생성함냥. 아래 정보 알려줘냥:

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
4. **파이프라인** (브랜드 / 기본 / 풀패키지, 생략 시 adplan3th는 브랜드, 그 외는 풀패키지)
   - 브랜드: adplan3th 기준 글 패턴, 슬라이드 6장을 본문에 교차 삽입
   - 기본: 라이브러리제외 이미지·링크 없이 지도/본문/다중이미지만
   - 풀패키지: 라이브러리제외 이미지 + 라이브러리제외 링크까지 풀 삽입
```

### 2단계: 계정 매칭

계정 정보는 **scheduler-server Atlas MongoDB `blogaccounts` 컬렉션을 source of truth**로 사용해서 조회합니다.

- 사용자가 입력한 계정이름은 DB의 `nickname` 우선, 없으면 `accountId`/`blogId`로 매칭
- 조회 결과에서 `accountId`, `blogId`, `nickname`, `category`, `isEnabled`를 확인
- 비밀번호는 DB에 저장하지 않고 실행 payload에만 일회성으로 사용
- DB 매칭 실패 시 명시 계정이 있으면 해당 ID로 진행 가능 여부를 보고하고, 없으면 올바른 계정이름을 다시 요청
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
  "schedule_mode": "{모드}",
  "generate_images": true,
  "image_count": 6,
  "image_source": "product",
  "manuscript_type": "default",
  "delay_between_posts": 10,
  "keyword_category": "{파이프라인값}"
}'
```

`{파이프라인값}`은 사용자 선택에 따라 아래 값 중 하나:

- 풀패키지(기본): `"안과"`
- 기본: `"안과기본"`
- 브랜드(adplan3th): `"안과브랜드"`

이미지 수는 브랜드(adplan3th) 6장, 그 외 기존 안과 계정은 5장을 사용합니다.

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
- **실제 예약 건수**, **방금 등록한 안과 키워드/제목 존재 여부**, **예약 시각** 확인
- 스케쥴 날짜에 `오늘`이 포함되어 이미 발행된 글이 있다면 `https://blog.naver.com/PostList.naver?blogId={blogId}&from=postList` 로 이동
- **오늘 발행된 제목 존재 여부**, **글목록 최상단 반영 여부**, **하루 배분 개수**를 한 번 더 확인

보고 규칙:
- `완료`, `정상 등록`, `개수 맞음` 같은 확정 표현은 이 실확인 후에만 사용
- 실확인 전에는 `내부 상태상 성공`, `실확인 전`, `진행 중`처럼 구분해서 보고

### 6단계: 요약 출력

| 항목 | 값 |
|------|-----|
| 도메인 | 안과 |
| 계정 | 계정명(ID) × N개 |
| 총 키워드 | N개 |
| 원고 | default |
| 이미지 | product |
| 모드 | N (하루 N개) |
| 예상 소요일 | 계정별 키워드수 ÷ 모드 |

### 7단계: 발행 현황 시트 기록 (필수)

실확인까지 완료한 후, 아래 구글시트에 결과를 정리합니다.

**시트 URL**: https://docs.google.com/spreadsheets/d/1oUo85a9m3MTTzWeX8FGnKZqCDfPRNdGZFxr4-vZqSrM/edit?gid=0#gid=0

기록 항목:
- 날짜, 도메인(안과), 계정명, 계정ID, 키워드, 발행상태(예약/발행완료/실패), 모드, 실확인결과
- 실확인에서 확인된 제목, 예약시각 등도 함께 기록
