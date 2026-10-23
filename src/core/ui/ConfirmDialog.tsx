import { useState } from "react";
import Modal from "./Modal";
import { errorMessage } from "@/core/lib/errors";

/**
 * Confirmation dialog for destructive / irreversible actions.
 * With `reasonLabel`, the user must type a reason, which is passed to onConfirm.
 */
export default function ConfirmDialog({
  open, onClose, title, message, confirmLabel = "تأكيد", tone = "danger", reasonLabel, onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  tone?: "danger" | "primary";
  reasonLabel?: string;
  onConfirm: (reason: string) => Promise<void> | void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const close = () => { setReason(""); setError(""); setBusy(false); onClose(); };

  const confirm = async () => {
    if (reasonLabel && !reason.trim()) { setError("اكتب السبب أولاً"); return; }
    setBusy(true); setError("");
    try {
      await onConfirm(reason.trim());
      setReason("");
      setBusy(false);
      onClose();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={close} title={title} size="sm">
      <div className="space-y-4">
        <div className="text-sm text-text leading-relaxed">{message}</div>
        {reasonLabel && (
          <div>
            <label className="eg-label">{reasonLabel} *</label>
            <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2} className="eg-input" autoFocus />
          </div>
        )}
        {error && <p className="text-xs text-danger bg-danger/10 rounded-lg p-3">{error}</p>}
        <div className="flex gap-2">
          <button onClick={confirm} disabled={busy}
            className={tone === "danger" ? "eg-btn-danger flex-1 justify-center" : "eg-btn-primary flex-1 justify-center"}>
            {busy ? "جاري التنفيذ..." : confirmLabel}
          </button>
          <button onClick={close} disabled={busy} className="eg-btn-ghost">إلغاء</button>
        </div>
      </div>
    </Modal>
  );
}
