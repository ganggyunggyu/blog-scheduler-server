/*
  input/select/textarea 를 컴포넌트로 감싸면 v-model 전달만 늘어나서
  클래스 상수로 두고 네이티브 엘리먼트를 그대로 쓴다.
*/
export const INPUT_CLASS = [
  'w-full rounded-[6px] border border-line bg-surface px-3 py-2',
  'text-[13px] text-ink placeholder:text-ink-faint',
  'transition-colors duration-150',
  'hover:border-line-strong focus:border-accent focus:outline-none',
  'disabled:opacity-45',
].join(' ');
