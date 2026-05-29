// 차트 팔레트 — Tailwind indigo/violet 패밀리로 통일.
// 명도 단계로 우선순위/규모를 표현, hue는 indigo → violet 사이에서만 이동.

export const MACHINE_COLORS = [
  "#c7d2fe", // P성민 — indigo-200
  "#a78bfa", // K성민 — violet-400
  "#7c3aed", // 충원 — violet-600
  "#4c1d95", // 대성 — violet-900
] as const;

// 모델 비용 차트(스택드): Opus가 사용량 대부분 → 가장 진한 메인 컬러.
export const MODEL_COLORS = {
  Opus: "#8b5cf6", // violet-500
  Sonnet: "#a78bfa", // violet-400
  Haiku: "#c7d2fe", // indigo-200
} as const;

// 단일 시리즈(Monthly Cost, Projects 막대 등)
export const BRAND_VIOLET = "#8b5cf6"; // violet-500
