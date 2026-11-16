import { useEffect, useId, useRef, useState } from "react";
export const pretty = (value) =>
  String(value ?? "")
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replaceAll("Fbr", "FBR");
export const money = (value) =>
  new Intl.NumberFormat("en-PK", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value));
export const date = (value) =>
  value
    ? new Date(value).toLocaleDateString("en-GB", { timeZone: "Asia/Karachi" })
    : "—";
export const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Karachi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const statusLabels = {
  VALIDATING_FBR: "Validating with FBR…",
  FBR_VALIDATION_FAILED: "FBR Validation Failed",
  FBR_VALIDATED: "Validated with FBR",
  SUBMITTING: "Submitting to FBR…",
  FBR_SUBMISSION_FAILED: "FBR Submission Failed",
  SUBMISSION_UNKNOWN: "Submission Status Unknown",
  FBR_ACCEPTED: "FBR Submitted",
};
export function Badge({ value }) {
  return (
    <span className={`badge ${value}`}>
      {statusLabels[value] || pretty(value)}
    </span>
  );
}
export function Heading({ title, subtitle, children }) {
  return (
    <header className="page-head no-print">
      <div>
        <div className="eyebrow">fbr-digital-invoice workspace</div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      {children}
    </header>
  );
}
export function Field({ label, className, ...props }) {
  return (
    <label className={className}>
      {label}
      <input {...props} />
    </label>
  );
}
export function Select({ label, options, ...props }) {
  return (
    <label>
      {label}
      <select {...props}>
        {options.map((option) => {
          const [value, text] = Array.isArray(option)
            ? option
            : [option, pretty(option)];
          return (
            <option value={value} key={value}>
              {text}
            </option>
          );
        })}
      </select>
    </label>
  );
}
export function Form({ onSubmit, children, className }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const locked = useRef(false);
  async function submit(event) {
    event.preventDefault();
    if (locked.current) return;
    const data = Object.fromEntries(new FormData(event.currentTarget));
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      await onSubmit(data);
    } catch (err) {
      setError(err.message);
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className={className} aria-busy={busy}>
      <fieldset disabled={busy}>{children}</fieldset>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {busy && (
        <p className="muted" role="status">
          Saving…
        </p>
      )}
    </form>
  );
}
export function Modal({ title, onClose, children, busy = false }) {
  const ref = useRef(null),
    titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <h2 id={titleId}>{title}</h2>
      {children}
    </dialog>
  );
}
export function Action({ onClick, children, ...props }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const locked = useRef(false);
  return (
    <span className="action-control">
      <button
        {...props}
        disabled={busy || props.disabled}
        onClick={async () => {
          if (locked.current) return;
          locked.current = true;
          setBusy(true);
          setError("");
          try {
            await onClick();
          } catch (err) {
            setError(err.message);
          } finally {
            locked.current = false;
            setBusy(false);
          }
        }}
      >
        {busy ? "Please wait…" : children}
      </button>
      {error && (
        <span className="error" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}
export function LoadState({ resource, children }) {
  if (resource.loading)
    return (
      <p className="loading" role="status">
        Loading…
      </p>
    );
  if (resource.error)
    return (
      <section className="panel">
        <p className="error" role="alert">
          {resource.error}
        </p>
        <button onClick={resource.reload}>Try again</button>
      </section>
    );
  return children(resource.data);
}
export function Pagination({
  page,
  pageSize = 50,
  hasMore,
  onPage,
  onPageSize,
}) {
  return (
    <div className="pagination">
      {onPageSize && (
        <label>
          Invoices per page{" "}
          <select
            value={pageSize}
            onChange={(event) => onPageSize(Number(event.target.value))}
          >
            {[10, 25, 50].map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
      )}
      <button disabled={page <= 1} onClick={() => onPage(page - 1)}>
        Previous
      </button>
      <span className="muted">
        Page {page} · {pageSize} invoices per page
      </span>
      <button disabled={!hasMore} onClick={() => onPage(page + 1)}>
        Next
      </button>
    </div>
  );
}
