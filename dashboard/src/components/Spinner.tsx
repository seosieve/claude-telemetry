// 로딩 스피너 공통 컴포넌트.
// 기존 인라인 마크업(h-3 w-3 / h-4 w-4)을 그대로 재현 — 시각적 변화 없음.

const SIZE_CLASS = {
  sm: "h-3 w-3",
  md: "h-4 w-4",
} as const;

interface SpinnerProps {
  size?: keyof typeof SIZE_CLASS;
}

export function Spinner({ size = "sm" }: SpinnerProps) {
  return (
    <span
      className={`inline-block ${SIZE_CLASS[size]} animate-spin rounded-full border-2 border-slate-600 border-t-sky-400`}
    />
  );
}
