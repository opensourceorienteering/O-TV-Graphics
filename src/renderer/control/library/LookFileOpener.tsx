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

type Result = { success?: boolean; error?: string; data?: OpenedLookFile | null };

/**
 * The main process hands a file over once. One request at a time is shared, so a component
 * mounted twice (React's development double run) still gets the file instead of losing it.
 */
let asking: Promise<Result> | null = null;
function askForFile(): Promise<Result> {
  asking ??= window.electronAPI.invoke("templates:pendingOpen").finally(() => {
    asking = null;
  });
  return asking;
}

/** A file opened while the operator was on the Live desk: waits for the next visit to the library */
let parked: OpenedLookFile | null = null;
export function takeParkedLookFile(): OpenedLookFile | null {
  const file = parked;
  parked = null;
  return file;
}

/** Called for each "a file arrived" message; one listener for the app's life */
let onFileArrived: (() => void) | null = null;
let listening = false;

export function LookFileOpener() {
  const navigate = useNavigate();
  const toast = useToast();

  useEffect(() => {
    let alive = true;
    const check = async () => {
      try {
        const result = await askForFile();
        if (!alive) return;
        if (!result?.success) throw new Error(result?.error);
        if (!result.data) return;
        // Never take the operator away from the Live desk during a show
        if (/\/live(\b|$)/.test(window.location.hash)) {
          parked = result.data as OpenedLookFile;
          toast.showToast("info", tr("A look file was opened. Open the Graphics library to import it."), 10000);
        } else navigate("/templates", { state: { openLook: result.data } });
      } catch (cause) {
        if (alive) toast.showToast("error", `${tr("Import failed")}: ${cause instanceof Error ? cause.message : String(cause)}`, 10000);
      }
    };
    void check();
    onFileArrived = () => void check();
    if (!listening) {
      listening = true;
      window.electronAPI?.receive?.("fromMain", (message: { type?: string }) => {
        if (message?.type === "openLookFile") onFileArrived?.();
      });
    }
    return () => {
      alive = false;
    };
    // Once per app start
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
