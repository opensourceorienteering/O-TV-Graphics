/**
 * Settings → Internet access for graphics: the addresses graphics may load from (a GPS
 * viewer, map tiles, a provider's data). Everything else outside this computer is blocked,
 * the same in the app's output, NDI, the previews and the OBS/vMix web output.
 */
import { t as tr } from "../i18n";
import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";

type Blocked = { origin: string; graphics: string[]; last: number; count: number };
type SetResult = { saved: string[]; rejected: Array<{ input: string; reason: string }> };

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const result = await window.electronAPI.invoke(channel, ...args);
  if (!result?.success) throw new Error(result?.error || tr("Could not save the addresses"));
  return result.data as T;
}

export function GraphicsInternetAccess() {
  const [list, setList] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [blocked, setBlocked] = useState<Blocked[]>([]);

  const refreshBlocked = () => {
    invoke<Blocked[]>("graphicsAccess:blocked").then(setBlocked).catch(() => undefined);
  };

  useEffect(() => {
    invoke<string[]>("graphicsAccess:get").then(setList).catch((e) => setError((e as Error).message));
    refreshBlocked();
    // New reports arrive while graphics run (preview, output, OBS)
    let alive = true;
    window.electronAPI?.receive?.("fromMain", (message: { type?: string }) => {
      if (alive && message?.type === "graphicsBlocked") refreshBlocked();
    });
    return () => {
      alive = false;
    };
  }, []);

  const save = async (next: string[]): Promise<SetResult | null> => {
    try {
      const result = await invoke<SetResult>("graphicsAccess:set", next);
      setList(result.saved);
      refreshBlocked();
      return result;
    } catch (e) {
      setError((e as Error).message);
      return null;
    }
  };

  const add = async () => {
    const value = draft.trim();
    if (!value) return;
    setError("");
    setNote("");
    const before = list;
    const result = await save([...list, value]);
    const refused = result?.rejected.find((r) => r.input === value);
    if (refused) setError(tr(refused.reason));
    else if (result) {
      setDraft("");
      // http:// and bare host names are stored as https://: say so
      const added = result.saved.find((o) => !before.includes(o));
      if (added && added !== value) setNote(`${tr("Saved as")} ${added}`);
    }
  };

  return (
    <div className="graphics-internet">
      <p>{tr("Graphics can only load from this computer, plus the addresses below.")}</p>
      <p className="studio-warning" role="note">
        <AlertTriangle size={15} aria-hidden="true" />{" "}
        {tr("Allowed addresses can show anything in your graphics and see what graphics send them.")}
      </p>
      <form
        className="row wrap"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <label>
          {tr("Address")}{" "}
          <input
            type="text"
            value={draft}
            placeholder="https://www.example.com"
            aria-invalid={!!error}
            aria-describedby={error ? "graphics-internet-error" : undefined}
            onChange={(e) => setDraft(e.target.value)}
          />
        </label>
        <button className="studio-button" type="submit" disabled={!draft.trim()}>
          {tr("Add address")}
        </button>
      </form>
      {note && (
        <p role="status" className="muted">
          {note}
        </p>
      )}
      {error && (
        <p id="graphics-internet-error" role="alert" className="studio-error">
          {error}
        </p>
      )}
      {list.length ? (
        <div className="table-scroll">
          <table className="studio-table">
            <thead>
              <tr>
                <th scope="col">{tr("Allowed address")}</th>
                <th scope="col">
                  <span className="visually-hidden">{tr("Remove")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {list.map((origin) => (
                <tr key={origin}>
                  <td>
                    <code>{origin}</code>
                  </td>
                  <td>
                    <button className="studio-button" onClick={() => void save(list.filter((o) => o !== origin))}>
                      {tr("Remove")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="empty-state">{tr("No addresses allowed: graphics use only this computer.")}</p>
      )}
      <p className="muted">
        {tr("Applies to graphics loaded from now on. A graphic already on air keeps its rules until it is shown again.")}
      </p>
      <h3>{tr("Blocked recently")}</h3>
      {blocked.length ? (
        <>
          <p className="muted">{tr("Graphics tried to reach these addresses and were refused. Allow only what you trust.")}</p>
          <div className="table-scroll">
            <table className="studio-table">
              <thead>
                <tr>
                  <th scope="col">{tr("Address")}</th>
                  <th scope="col">{tr("Graphics")}</th>
                  <th scope="col">{tr("Last")}</th>
                  <th scope="col">
                    <span className="visually-hidden">{tr("Allow")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {blocked.map((b) => (
                  <tr key={b.origin}>
                    <td>
                      <code>{b.origin}</code>
                    </td>
                    <td>{b.graphics.join(", ") || "—"}</td>
                    <td>
                      {new Date(b.last).toLocaleTimeString()}
                      {b.count > 1 ? ` · ${b.count}×` : ""}
                    </td>
                    <td>
                      <button className="studio-button" onClick={() => void save([...list, b.origin])}>
                        {tr("Allow")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            className="studio-button"
            onClick={() => void invoke("graphicsAccess:clearBlocked").then(refreshBlocked).catch(() => undefined)}
          >
            {tr("Clear list")}
          </button>
        </>
      ) : (
        <p className="empty-state">{tr("Nothing blocked right now. Show a graphic in a preview to see what it tries to reach.")}</p>
      )}
    </div>
  );
}
