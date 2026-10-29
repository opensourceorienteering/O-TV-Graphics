import { t as tr } from "../i18n";
import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { DESK_SHORTCUTS } from "../../../shared/desk";
import { call } from "../events/api";

/** The Live desk's fixed keys, plus where hardware control is set up */
export function KeyboardShortcutsList() {
  return (
    <div className="studio-form keyboard-shortcuts-editor">
      <p className="muted">
         {tr("The Live desk uses one key per action. Keys never fire while you type in a field or in the command palette.")} </p>
      <table className="keymap-table">
        <tbody>
          {DESK_SHORTCUTS.map(([key, action]) => (
            <tr key={key}>
              <td>
                <kbd>{key}</kbd>
              </td>
              <td>{tr(action)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted">
         {tr("Stream Deck: the Split Control module for Bitfocus Companion turns your favourites into buttons, next to Show, Update, Hide and Hide all.")} </p>
      <div className="row wrap">
        <button
          className="studio-button"
          onClick={() => void call("control:openModule").catch(() => undefined)}
        >
           {tr("Show Companion module")} </button>
      </div>
    </div>
  );
}

export function KeyboardShortcutsDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="controls-dialog"
      aria-labelledby="controls-dialog-title"
      onClose={onClose}
      onCancel={onClose}
    >
      <header className="dialog-heading">
        <div>
          <p className="eyebrow">{tr("Live desk")}</p>
          <h2 id="controls-dialog-title">{tr("Keyboard shortcuts")}</h2>
        </div>
        <button className="icon-button" aria-label={tr("Close")} onClick={onClose}>
          <X size={18} aria-hidden="true" />
        </button>
      </header>
      <KeyboardShortcutsList />
      <footer className="dialog-footer">
        <button className="studio-button primary" onClick={onClose}>
           {tr("Done")} </button>
      </footer>
    </dialog>
  );
}
