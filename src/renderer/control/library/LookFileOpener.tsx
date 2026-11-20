/**
 * A .splitlook file opened from the system (double-click, "Open with"): go to the library,
 * which shows the import confirmation. Asks once at start (the app may have been opened by the
 * file) and again whenever the main process says a file arrived.
 */
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { t as tr } from "../i18n";
import { useToast } from "../contexts/ToastContext";
import type { ImportPreview } from "./ImportConfirm";

export type OpenedLookFile = { filePath: string; preview: ImportPreview };

export function LookFileOpener() {
  const navigate = useNavigate();
  const toast = useToast();

  useEffect(() => {
    let alive = true;
    const check = async () => {
      try {
        const result = await window.electronAPI.invoke("templates:pendingOpen");
        if (!alive) return;
        if (!result?.success) throw new Error(result?.error);
        if (result.data) navigate("/templates", { state: { openLook: result.data as OpenedLookFile } });
      } catch (cause) {
        if (alive) toast.showToast("error", `${tr("Import failed")}: ${cause instanceof Error ? cause.message : String(cause)}`, 10000);
      }
    };
    void check();
    window.electronAPI?.receive?.("fromMain", (message: { type?: string }) => {
      if (alive && message?.type === "openLookFile") void check();
    });
    return () => {
      alive = false;
    };
    // Once per app start: the listener stays for the app's life
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
