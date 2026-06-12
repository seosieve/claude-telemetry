// 차트 팔레트 — Tailwind indigo/violet 패밀리로 통일.
// 명도 단계로 우선순위/규모를 표현, hue는 indigo → violet 사이에서만 이동.

export const MACHINE_COLORS = [
  "#a78bfa", // K성민 — violet-400
  "#7c3aed", // 충원 — violet-600
  "#4c1d95", // 대성 — violet-900
] as const;

// 모델 비용 차트(스택드): 기존 violet 명도 단계는 유지하되, 주력인 Fable만
// cyan 악센트로 분리 — violet끼리는 인접 단계가 스택바에서 구분이 안 됐음.
export const MODEL_COLORS = {
  Fable: "#22d3ee", // cyan-400
  Opus: "#8b5cf6", // violet-500
  Sonnet: "#a78bfa", // violet-400
  Haiku: "#c7d2fe", // indigo-200
} as const;

// 단일 시리즈(Monthly Cost, Projects 막대 등)
export const BRAND_VIOLET = "#8b5cf6"; // violet-500

// 모델 배지/메트릭 카드용 Tailwind 클래스 단일 소스.
// 차트(MODEL_COLORS, hex)와 달리 배지/카드는 Tailwind 유틸 클래스를 쓰므로 별도 맵.
// 기존에 보이던 rose(Opus)/sky(Sonnet)/emerald(Haiku) 팔레트 그대로 유지, Fable은 violet.
type ModelKey = "fable" | "opus" | "sonnet" | "haiku";

// 작은 인라인 배지 (Sessions/Blocks/Projects)
export const MODEL_BADGE_CLASS: Record<ModelKey, string> = {
  fable: "bg-violet-500/20 text-violet-400",
  opus: "bg-rose-500/20 text-rose-400",
  sonnet: "bg-sky-500/20 text-sky-400",
  haiku: "bg-emerald-500/20 text-emerald-400",
};

// 모델 메트릭 카드 (Models 페이지)
export const MODEL_CARD_CLASS: Record<ModelKey, { border: string; text: string }> = {
  fable: { border: "border-violet-500/20 bg-violet-500/5", text: "text-violet-400" },
  opus: { border: "border-rose-500/20 bg-rose-500/5", text: "text-rose-400" },
  sonnet: { border: "border-sky-500/20 bg-sky-500/5", text: "text-sky-400" },
  haiku: { border: "border-emerald-500/20 bg-emerald-500/5", text: "text-emerald-400" },
};

// 모델 식별자 문자열(예: "claude-fable-5")을 키로 해석. 매칭 안되면 haiku 폴백
// (기존 배지 로직과 동일: fable → opus → sonnet → 그 외 전부 haiku 색).
// mythos는 fable과 동일 모델이라 같은 버킷으로 취급.
export function modelKey(model: string | null | undefined): ModelKey {
  if (model?.includes("fable") || model?.includes("mythos")) return "fable";
  if (model?.includes("opus")) return "opus";
  if (model?.includes("sonnet")) return "sonnet";
  return "haiku";
}
