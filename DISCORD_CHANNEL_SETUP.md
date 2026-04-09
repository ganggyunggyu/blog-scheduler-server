# Claude Code × Discord 채널 셋팅 가이드

## 1. 사전 준비

### Bun 설치

```bash
# 설치
curl -fsSL https://bun.sh/install | bash

# 확인
bun --version
```

### Claude Code 버전 확인

```bash
claude --version
# v2.1.80 이상이어야 함
```

---

## 2. Discord 봇 생성

### 2-1. 애플리케이션 생성

1. [Discord Developer Portal](https://discord.com/developers/applications) 접속
2. **New Application** 클릭
3. 이름 입력 (예: `claude-code-bot`) → **Create**

### 2-2. 봇 토큰 발급

1. 좌측 메뉴 → **Bot** 클릭
2. **Reset Token** → 토큰 복사 (한 번만 보여주니까 바로 복사해둘 것)
   <DISCORD_BOT_TOKEN>

### 2-3. Intent 활성화

1. Bot 페이지 하단 → **Privileged Gateway Intents** 섹션
2. **Message Content Intent** → 활성화 (토글 ON)
3. **Save Changes**

### 2-4. 봇을 서버에 초대

1. 좌측 메뉴 → **OAuth2** → **URL Generator**
2. SCOPES에서 `bot` 체크
3. BOT PERMISSIONS에서 필요한 권한 체크:
   - Send Messages
   - Read Message History
   - View Channels
4. 하단 생성된 URL 복사 → 브라우저에서 열기
5. 원하는 서버 선택 → **Authorize**

---

## 3. Claude Code에서 플러그인 설치

Claude Code 터미널에서 아래 명령어 순서대로 실행:

```bash
# 1. Discord 플러그인 설치
/plugin install discord@claude-plugins-official

# 2. 봇 토큰 설정 (위에서 복사한 토큰 붙여넣기)
/discord:configure <DISCORD_BOT_TOKEN>

# 3. 채널 모드로 Claude Code 재시작
claude --channels plugin:discord@claude-plugins-official
```

---

## 4. 페어링 (본인 인증)

1. Discord에서 방금 초대한 봇에게 **DM** 보내기 (아무 메시지)
2. 봇이 **페어링 코드**를 응답함
3. Claude Code 터미널에서:

```bash
/discord:access pair <받은_코드>
```

4. 보안 잠금 (본인만 사용 가능하게):

```bash
/discord:access policy allowlist
```

---

## 5. 사용법

- Discord DM으로 봇에게 메시지 보내면 → 열려있는 Claude Code 세션에 전달됨
- 터미널 없이 폰으로도 Claude Code 조작 가능

---

## 주의사항

- Claude Code **세션이 열려있는 동안만** 메시지 수신 가능
- 항상 켜두려면 `tmux` 또는 `screen` 등으로 백그라운드 실행 필요:

```bash
tmux new -s claude-channel
claude --channels plugin:discord@claude-plugins-official
# Ctrl+B → D 로 detach
```

- Team/Enterprise 플랜은 어드민이 먼저 활성화해야 함
  - `claude.ai → Admin settings → Claude Code → Channels`
- research preview 단계라 명령어가 바뀔 수 있음
