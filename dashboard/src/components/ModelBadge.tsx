// 모델 배지 공통 컴포넌트.
// Sessions/Blocks/Projects에 중복돼 있던 동일 마크업을 추출 — 시각적 변화 없음.
// 색상은 colors.ts(MODEL_BADGE_CLASS) 단일 소스 참조.

import { MODEL_BADGE_CLASS, modelKey } from "../lib/colors";

interface ModelBadgeProps {
  model: string | null | undefined;
}

export function ModelBadge({ model }: ModelBadgeProps) {
  const name = model?.split("-").pop() || model || "?";
  const colorClass = MODEL_BADGE_CLASS[modelKey(model)];
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${colorClass}`}>
      {name}
    </span>
  );
}
