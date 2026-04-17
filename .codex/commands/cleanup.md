---
description: BullMQ 큐 전체 비우기
argument-hint: 없음
---

# 큐 클린업

이 파일은 Codex 자동완성용 브리지입니다.

실행 시 먼저 `.claude/commands/cleanup.md` 를 읽고 그 절차를 그대로 따릅니다.

핵심 흐름:
- BullMQ 큐를 waiting, active, completed, failed, delayed 포함 전부 비웁니다.
- 이후 대시보드 totals 를 확인해서 `generate` 와 `publish` 가 모두 0인지 검증합니다.
