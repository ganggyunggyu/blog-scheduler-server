---
description: 오늘 발행글 RSS 검증
argument-hint: 없음
---

# 오늘 발행글 검증

이 파일은 Codex 자동완성용 브리지입니다.

실행 시 먼저 `.claude/commands/verify-posts.md` 를 읽고 그 절차를 그대로 따릅니다.

핵심 흐름:
- `scripts/verify-today-posts.ts` 를 실행합니다.
- active 계정 전체의 오늘 발행 수를 RSS 로 검증합니다.
- 문제 계정만 정리해서 보고합니다.
