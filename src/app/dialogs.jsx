// Окна подтверждения, ввода и всплывающие уведомления вместо alert/confirm/prompt.
// confirm/prompt возвращают Promise: true/false и строку/null.
import React from "react";

const DialogContext = React.createContext(null);
const TOAST_MS = 4000;
let toastSeq = 0;

export function useDialogs() {
  const ctx = React.useContext(DialogContext);
  if (!ctx) throw new Error("useDialogs: нужен <DialogProvider>");
  return ctx;
}

export function DialogProvider({ children }) {
  const [dialog, setDialog] = React.useState(null);
  const [toasts, setToasts] = React.useState([]);

  const api = React.useMemo(() => ({
    confirm: (message, opts = {}) => new Promise(resolve => setDialog({ kind: "confirm", message, ...opts, resolve })),
    prompt: (message, opts = {}) => new Promise(resolve => setDialog({ kind: "prompt", message, ...opts, resolve })),
    toast: (message, kind = "info") => {
      const id = ++toastSeq;
      setToasts(list => [...list, { id, message, kind }]);
      setTimeout(() => setToasts(list => list.filter(t => t.id !== id)), TOAST_MS);
    }
  }), []);

  const close = (value) => {
    dialog.resolve(value);
    setDialog(null);
  };

  return (
    <DialogContext.Provider value={api}>
      {children}
      {dialog && <Dialog dialog={dialog} onClose={close} />}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map(t => <div key={t.id} className={`toast ${t.kind}`}>{t.message}</div>)}
      </div>
    </DialogContext.Provider>
  );
}

function Dialog({ dialog, onClose }) {
  const [value, setValue] = React.useState("");
  const isPrompt = dialog.kind === "prompt";
  const cancel = () => onClose(isPrompt ? null : false);
  const submit = (e) => {
    e.preventDefault();
    onClose(isPrompt ? value : true);
  };
  return (
    <div className="dialog-backdrop" onKeyDown={e => { if (e.key === "Escape") cancel(); }}>
      <form className="dialog" role="dialog" aria-modal="true" aria-label={dialog.title || "Подтверждение"} onSubmit={submit}>
        {dialog.title && <h3>{dialog.title}</h3>}
        <p>{dialog.message}</p>
        {isPrompt && (
          <input
            autoFocus
            type={dialog.inputType || "text"}
            inputMode={dialog.inputMode}
            aria-label={dialog.message}
            value={value}
            onChange={e => setValue(e.target.value)}
          />
        )}
        <div className="dialog-actions">
          <button type="button" className="text-btn" onClick={cancel}>{dialog.cancelText || "Отмена"}</button>
          <button type="submit" className={dialog.danger ? "danger-btn" : ""} autoFocus={!isPrompt}>
            {dialog.okText || "OK"}
          </button>
        </div>
      </form>
    </div>
  );
}
