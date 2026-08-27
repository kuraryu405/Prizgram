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

export type ToastVariant = "success" | "error" | "warning" | "info";

export type ToastInput = Readonly<{
  message: string;
  variant?: ToastVariant;
  durationMs?: number;
}>;

type Toast = ToastInput & { id: number; variant: ToastVariant };

type ToastContextValue = Readonly<{
  notify: (toast: ToastInput) => void;
  dismiss: (id: number) => void;
}>;

const ToastContext = createContext<ToastContextValue | null>(null);

const DEFAULT_DURATION_MS = 6_000;
const MAX_TOASTS = 4;

const variantLabels: Readonly<Record<ToastVariant, string>> = {
  success: "成功",
  error: "エラー",
  warning: "注意",
  info: "お知らせ",
};

const variantIcons: Readonly<Record<ToastVariant, string>> = {
  success: "✓",
  error: "!",
  warning: "⚠",
  info: "i",
};

export function ToastProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);
  const timers = useRef(new Map<number, number>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const notify = useCallback(
    ({
      message,
      variant = "info",
      durationMs = DEFAULT_DURATION_MS,
    }: ToastInput) => {
      const trimmedMessage = message.trim();
      if (trimmedMessage === "") return;

      const id = nextId.current++;
      setToasts((current) => {
        const duplicate = current.find(
          (toast) =>
            toast.message === trimmedMessage && toast.variant === variant,
        );
        if (duplicate !== undefined) return current;

        const nextToast: Toast = {
          id,
          message: trimmedMessage,
          variant,
          durationMs,
        };
        return [...current, nextToast].slice(-MAX_TOASTS);
      });
    },
    [],
  );

  useEffect(() => {
    const activeIds = new Set(toasts.map((toast) => toast.id));
    for (const [id, timer] of timers.current) {
      if (!activeIds.has(id)) {
        window.clearTimeout(timer);
        timers.current.delete(id);
      }
    }
    for (const toast of toasts) {
      if (timers.current.has(toast.id)) continue;
      const timer = window.setTimeout(
        () => dismiss(toast.id),
        toast.durationMs ?? DEFAULT_DURATION_MS,
      );
      timers.current.set(toast.id, timer);
    }
  }, [dismiss, toasts]);

  useEffect(
    () => () => {
      for (const timer of timers.current.values()) window.clearTimeout(timer);
      timers.current.clear();
    },
    [],
  );

  const value = useMemo(() => ({ notify, dismiss }), [dismiss, notify]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div aria-label="通知" className="toast-region">
        {toasts.map((toast) => (
          <div
            className={`toast toast-${toast.variant}`}
            key={toast.id}
            role={toast.variant === "error" ? "alert" : "status"}
            aria-live={toast.variant === "error" ? "assertive" : "polite"}
          >
            <span aria-hidden="true" className="toast-icon">
              {variantIcons[toast.variant]}
            </span>
            <span className="toast-content">
              <strong>{variantLabels[toast.variant]}</strong>
              <span>{toast.message}</span>
            </span>
            <button
              aria-label="通知を閉じる"
              className="toast-dismiss"
              onClick={() => dismiss(toast.id)}
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

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (context === null) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
}
