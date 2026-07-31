<script setup lang="ts">
/*
  로그인/회원가입이 공유하는 좌우 분할 레이아웃.
  왼쪽은 이 도구가 뭘 하는지 한 화면에 보여주고, 오른쪽이 폼이다.
  좁은 화면에서는 왼쪽을 접고 폼만 남긴다.
*/
interface Props {
  eyebrow: string;
  headline: string;
  description: string;
}

const props = defineProps<Props>();

const CAPABILITIES = [
  { label: '계정별 큐', detail: '생성과 발행을 계정 단위로 나눠서 돌립니다' },
  { label: '도메인 프리셋', detail: '맛집, 애견, 흑염소, 안과, 알리바바' },
  { label: '예약 발행', detail: '하루 배분과 시각을 자동으로 계산합니다' },
];
</script>

<template>
  <div class="grid min-h-[100dvh] grid-cols-1 bg-surface lg:grid-cols-[1.1fr_1fr]">
    <section
      class="relative hidden overflow-hidden border-r border-line bg-surface-raised lg:flex lg:flex-col lg:justify-between"
    >
      <!-- 장식이 아니라 여백에 질감을 주는 용도. 대비를 해치지 않을 만큼만 깐다. -->
      <div
        class="pointer-events-none absolute inset-0 opacity-[0.35]"
        style="
          background-image:
            linear-gradient(to right, rgba(255, 255, 255, 0.03) 1px, transparent 1px),
            linear-gradient(to bottom, rgba(255, 255, 255, 0.03) 1px, transparent 1px);
          background-size: 56px 56px;
        "
      />
      <div
        class="pointer-events-none absolute -left-40 top-1/3 h-[420px] w-[420px] rounded-full"
        style="background: radial-gradient(circle, rgba(52, 211, 153, 0.07), transparent 70%)"
      />

      <header class="relative px-12 pt-12">
        <span class="text-[13px] font-semibold tracking-tight text-ink">발행 스케줄러</span>
      </header>

      <div class="relative px-12">
        <p class="mb-5 font-mono text-[11px] uppercase tracking-[0.18em] text-accent">
          {{ props.eyebrow }}
        </p>
        <h1 class="max-w-[13ch] text-[42px] font-semibold leading-[1.12] tracking-tight text-ink">
          {{ props.headline }}
        </h1>
        <p class="mt-5 max-w-[42ch] text-[14px] leading-relaxed text-ink-muted">
          {{ props.description }}
        </p>
      </div>

      <dl class="relative divide-y divide-line border-t border-line">
        <div
          v-for="item in CAPABILITIES"
          :key="item.label"
          class="flex items-baseline gap-6 px-12 py-4"
        >
          <dt class="w-24 shrink-0 text-[12px] font-medium text-ink">{{ item.label }}</dt>
          <dd class="text-[12px] leading-relaxed text-ink-faint">{{ item.detail }}</dd>
        </div>
      </dl>
    </section>

    <section class="flex items-center justify-center px-6 py-12">
      <div class="w-full max-w-[352px]">
        <slot />
      </div>
    </section>
  </div>
</template>
