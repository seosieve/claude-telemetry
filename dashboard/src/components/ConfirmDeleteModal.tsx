import { useState, useEffect } from "react";

interface ConfirmDeleteModalProps {
  machineName: string;
  isOpen: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDeleteModal({
  machineName,
  isOpen,
  onConfirm,
  onCancel,
}: ConfirmDeleteModalProps) {
  const [confirmText, setConfirmText] = useState("");

  useEffect(() => {
    if (isOpen) setConfirmText("");
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  const canConfirm = confirmText === machineName;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Overlay */}
      <div
        className="absolute inset-0 bg-black/60"
        onClick={onCancel}
      />

      {/* Modal */}
      <div className="relative z-10 w-full max-w-md rounded-xl border border-white/[0.06] bg-slate-900 p-6 shadow-2xl">
        <h3 className="text-sm font-semibold text-rose-400">Delete Machine</h3>
        <p className="mt-2 text-xs text-slate-400 leading-relaxed">
          Are you sure you want to delete{" "}
          <span className="font-medium text-white">{machineName}</span>? All
          usage data from this machine will be permanently deleted.
        </p>

        <div className="mt-4">
          <label className="block text-xs text-slate-500 mb-1">
            Type <span className="font-mono font-medium text-slate-300">{machineName}</span> to confirm
          </label>
          <input
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={machineName}
            className="w-full rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-sm text-white placeholder-slate-700 outline-none focus:border-rose-500/50"
            autoFocus
          />
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-lg border border-white/[0.06] px-4 py-2 text-xs font-medium text-slate-400 hover:bg-white/[0.04]"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={!canConfirm}
            className="rounded-lg bg-rose-600 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-rose-700 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Delete Machine
          </button>
        </div>
      </div>
    </div>
  );
}
