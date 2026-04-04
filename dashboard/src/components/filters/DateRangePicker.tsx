interface DateRangePickerProps {
  value: string;
  onChange: (range: string) => void;
}

const PRESETS = [
  { label: "7d", value: "7d" },
  { label: "30d", value: "30d" },
  { label: "90d", value: "90d" },
];

export function DateRangePicker({ value, onChange }: DateRangePickerProps) {
  return (
    <div className="flex items-center gap-1 rounded-lg border border-white/[0.06] bg-white/[0.02] p-1">
      {PRESETS.map((preset) => (
        <button
          key={preset.value}
          onClick={() => onChange(preset.value)}
          className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
            value === preset.value
              ? "bg-white/[0.08] text-white"
              : "text-slate-400 hover:text-slate-200"
          }`}
        >
          {preset.label}
        </button>
      ))}
    </div>
  );
}
