"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

type ToastVariant = "success" | "error" | "warning" | "info";

type Toast = Readonly<{
  id: string;
  variant: ToastVariant;
  message: string;
}>;

type ToastContextValue = Readonly<{
  addToast: (message: string, variant?: ToastVariant) => void;
}>;

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const VARIANT_ICON: Record<ToastVariant, string> = {
  success: "✓",
  error: "✕",
  warning: "⚠",
  info: "ℹ",
};

const VARIANT_LABEL: Record<ToastVariant, string> = {
  success: "成功",
  error: "エラー",
  warning: "警告",
  info: "情報",
};

const DURATION_MS: Record<ToastVariant, number> = {
  success: 4000,
  info: 4000,
  warning: 6000,
  error: 8000,
};

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (ctx === undefined) {
    throw new Error("useToast must be used within ToastProvider");
  }
  return ctx;
}

export function ToastProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef<Map<string, number>>(new Map());

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const handle = timers.current.get(id);
    if (handle !== undefined) {
      window.clearTimeout(handle);
      timers.current.delete(id);
    }
  }, []);

  const addToast = useCallback(
    (message: string, variant: ToastVariant = "info") => {
      const trimmed = message.trim();
      if (trimmed === "") return;
      // Dedupe: if same message+variant already visible, do not stack infinitely
      setToasts((prev) => {
        const exists = prev.some(
          (t) => t.message === trimmed && t.variant === variant,
        );
        if (exists) return prev;
        // cap at 3 to avoid infinite stacking on rapid clicks
        const next: Toast = { id: newId(), variant, message: trimmed };
        const capped = prev.length >= 3 ? prev.slice(1) : prev;
        return [...capped, next];
      });
    },
    [],
  );

  // schedule auto-dismiss when toasts change
  useEffect(() => {
    for (const toast of toasts) {
      if (timers.current.has(toast.id)) continue;
      const duration = DURATION_MS[toast.variant];
      const handle = window.setTimeout(() => removeToast(toast.id), duration);
      timers.current.set(toast.id, handle);
    }
    return () => {
      // cleanup on unmount handled by removeToast; keep timers for active toasts
    };
  }, [toasts, removeToast]);

  useEffect(() => {
    const timersRef = timers.current;
    return () => {
      for (const handle of timersRef.values()) window.clearTimeout(handle);
      timersRef.clear();
    };
  }, []);

  const value = useMemo(() => ({ addToast }), [addToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        aria-relevant="additions"
        className="toast-region"
      >
        {/* error toasts are assertive, others polite — wrap each toast with appropriate live */}
        {toasts.map((toast) => (
          <div
            key={toast.id}
            aria-live={toast.variant === "error" ? "assertive" : "polite"}
            aria-atomic="true"
            className={`toast toast-${toast.variant}`}
            role={toast.variant === "error" ? "alert" : "status"}
          >
            <span aria-hidden="true" className="toast-icon">
              {VARIANT_ICON[toast.variant]}
            </span>
            <span className="toast-label">{VARIANT_LABEL[toast.variant]}</span>
            <span className="toast-message">{toast.message}</span>
            <button
              aria-label="通知を閉じる"
              className="toast-dismiss"
              onClick={() => removeToast(toast.id)}
              type="button"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
