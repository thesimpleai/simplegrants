import { X, LoaderCircle, ArrowUpRight, Info } from "lucide-react";
import { useLayoutEffect, useRef, type ReactNode } from "react";

const modalStack: HTMLElement[] = [];
let originalBodyOverflow: string | null = null;
const focusableSelector =
  'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"]),[contenteditable="true"]';
function focusableWithin(dialog: HTMLElement) {
  return Array.from(
    dialog.querySelectorAll<HTMLElement>(focusableSelector),
  ).filter(
    (element) =>
      element.tabIndex >= 0 &&
      element.getClientRects().length > 0 &&
      !element.closest('[hidden], [inert], [aria-hidden="true"]'),
  );
}
function focusInModal(dialog: HTMLElement) {
  const controls = focusableWithin(dialog);
  const initial =
    controls.find((element) => element.hasAttribute("autofocus")) ??
    controls.find((element) =>
      element.matches(
        'input:not([type="checkbox"]):not([type="radio"]),textarea,select',
      ),
    ) ??
    controls[0] ??
    dialog;
  initial.focus({ preventScroll: true });
}
export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    if (modalStack.length === 0) {
      originalBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    modalStack.push(dialog);
    focusInModal(dialog);
    function onKeyDown(event: KeyboardEvent) {
      if (modalStack.at(-1) !== dialog) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const controls = focusableWithin(dialog!);
      const first = controls[0];
      const last = controls.at(-1);
      if (!first || !last) {
        event.preventDefault();
        dialog!.focus();
        return;
      }
      const active = document.activeElement;
      if (
        !dialog!.contains(active) ||
        active === dialog ||
        (event.shiftKey && active === first) ||
        (!event.shiftKey && active === last)
      ) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    }
    function onFocusIn(event: FocusEvent) {
      if (
        modalStack.at(-1) === dialog &&
        event.target instanceof Node &&
        !dialog!.contains(event.target)
      )
        focusInModal(dialog!);
    }
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("focusin", onFocusIn, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("focusin", onFocusIn, true);
      const wasTop = modalStack.at(-1) === dialog;
      const index = modalStack.indexOf(dialog);
      if (index >= 0) modalStack.splice(index, 1);
      const nextDialog = modalStack.at(-1);
      if (modalStack.length === 0 && originalBodyOverflow !== null) {
        document.body.style.overflow = originalBodyOverflow;
        originalBodyOverflow = null;
      }
      if (wasTop) {
        if (opener?.isConnected && (!nextDialog || nextDialog.contains(opener)))
          opener.focus({ preventScroll: true });
        else if (nextDialog) focusInModal(nextDialog);
      }
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onClick={(event) => {
        if (
          event.target === event.currentTarget &&
          modalStack.at(-1) === dialogRef.current
        )
          onClose();
      }}
    >
      <section
        ref={dialogRef}
        tabIndex={-1}
        className={`modal ${wide ? "modal-wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-heading">
          <h2>{title}</h2>
          <button
            type="button"
            className="icon-button"
            aria-label="Close dialog"
            onClick={onClose}
          >
            <X size={22} />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
export function Badge({
  children,
  tone = "green",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}
export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      {icon}
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function Busy({ label = "Working on it…" }: { label?: string }) {
  return (
    <span className="busy">
      <LoaderCircle className="spin" size={18} />
      {label}
    </span>
  );
}
export function Notice({ children }: { children: ReactNode }) {
  return (
    <div className="notice">
      <Info size={18} />
      <div>{children}</div>
    </div>
  );
}
export function ExternalLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  if (!/^https:\/\//i.test(href)) return <span>{children}</span>;
  return (
    <a href={href} target="_blank" rel="noreferrer" className="text-link">
      {children}
      <ArrowUpRight size={15} />
    </a>
  );
}
export function money(amount: number | null | undefined) {
  return amount == null
    ? "Amount to confirm"
    : new Intl.NumberFormat("en-AU", {
        style: "currency",
        currency: "AUD",
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      }).format(amount);
}
export function date(value: string | null | undefined) {
  return value
    ? new Date(value).toLocaleDateString("en-AU", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "Australia/Melbourne",
      })
    : "To be confirmed";
}
export function errorMessage(e: unknown) {
  return e instanceof Error
    ? e.message
    : "Something went wrong. Please try again.";
}

/** Keep structured AI sections, evidence and budget rows readable in an editable draft. */
export function formatDraft(value: unknown): string {
  const ancestors = new WeakSet<object>();
  const label = (key: string) => {
    const words = key
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/[_-]+/g, " ");
    return words.charAt(0).toUpperCase() + words.slice(1);
  };
  function format(item: unknown, depth: number): string {
    if (item === null || item === undefined) return "";
    if (typeof item === "string") return item.trim();
    if (typeof item === "number") return String(item);
    if (typeof item === "boolean") return item ? "Yes" : "No";
    if (typeof item !== "object") return "";
    if (ancestors.has(item)) return "[Repeated reference]";
    if (depth > 12) return "[Further details omitted]";
    ancestors.add(item);
    let output: string;
    if (Array.isArray(item)) {
      output = item
        .map((entry) => format(entry, depth + 1))
        .filter(Boolean)
        .map((entry, index) => {
          if (!entry.includes("\n")) return `• ${entry}`;
          return `${index + 1}. ${entry.replace(/\n/g, "\n   ")}`;
        })
        .join("\n\n");
    } else {
      output = Object.entries(item)
        .map(([key, entry]) => {
          const content = format(entry, depth + 1);
          if (!content) return "";
          return content.includes("\n") || typeof entry === "object"
            ? `${label(key)}\n${content}`
            : `${label(key)}: ${content}`;
        })
        .filter(Boolean)
        .join("\n\n");
    }
    ancestors.delete(item);
    return output;
  }
  return format(value, 0);
}

export function deadline(value: string | null | undefined) {
  return value
    ? new Date(value).toLocaleString("en-AU", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZone: "Australia/Melbourne",
      }) + " (Melbourne time)"
    : "Time and date to be confirmed";
}
