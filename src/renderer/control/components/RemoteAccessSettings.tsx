/**
 * Settings → Remote access: the key other computers need to control Split Control or read its
 * live data (Companion, OBS/vMix web output on another computer, the director page, OGraf
 * controllers). This computer never needs it.
 */
import { t as tr } from "../i18n";
import { useEffect, useState } from "react";
import { AlertTriangle, Copy, Eye, EyeOff, RefreshCw } from "lucide-react";
import "./RemoteAccessSettings.css";

type Access = { requireKey: boolean; key: string };

async function invoke(channel: string, ...args: unknown[]): Promise<Access> {
  const result = await window.electronAPI.invoke(channel, ...args);
  if (!result?.success) throw new Error(result?.error || tr("Could not save the setting"));
  return result.data as Access;
}

export function RemoteAccessSettings() {
  const [access, setAccess] = useState<Access | null>(null);
  const [shown, setShown] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    invoke("remoteAccess:get").then(setAccess).catch((e) => setError((e as Error).message));
  }, []);

  const run = async (action: () => Promise<Access>, done?: string) => {
    setError("");
    setNote("");
    try {
      setAccess(await action());
      if (done) setNote(done);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const copy = async () => {
    if (!access) return;
    try {
      await navigator.clipboard.writeText(access.key);
      setNote(tr("Key copied"));
    } catch {
      setShown(true);
      setError(tr("Could not copy: select the key and copy it."));
    }
  };

  const regenerate = () => {
    if (!confirm(tr("Make a new key? Companion, OBS/vMix and director pages on other computers stop working until they get the new key.")))
      return;
    void run(() => invoke("remoteAccess:regenerate"), tr("New key made. Other computers using the old key were disconnected."));
  };

  if (!access) return error ? <p role="alert" className="studio-error">{error}</p> : null;

  return (
    <div className="remote-access">
      <label className="remote-access-switch">
        <input
          type="checkbox"
          checked={access.requireKey}
          onChange={(e) =>
            void run(
              () => invoke("remoteAccess:set", { requireKey: e.target.checked }),
              e.target.checked ? tr("Other computers now need the key.") : undefined,
            )
          }
        />{" "}
        {tr("Other computers need the access key")}
      </label>
      {!access.requireKey && (
        <p className="studio-warning" role="note">
          <AlertTriangle size={15} aria-hidden="true" />{" "}
          {tr("Anyone on the network can control the graphics and read the live data.")}
        </p>
      )}
      <div className="remote-access-key">
        <label>
          {tr("Access key")}
          <input type={shown ? "text" : "password"} readOnly value={access.key} size={30} onFocus={(e) => e.target.select()} />
        </label>
        <button className="studio-button" onClick={() => setShown((s) => !s)} aria-pressed={shown}>
          {shown ? <EyeOff size={15} aria-hidden="true" /> : <Eye size={15} aria-hidden="true" />} {shown ? tr("Hide") : tr("Show")}
        </button>
        <button className="studio-button" onClick={() => void copy()}>
          <Copy size={15} aria-hidden="true" /> {tr("Copy")}
        </button>
        <button className="studio-button" onClick={regenerate}>
          <RefreshCw size={15} aria-hidden="true" /> {tr("Make a new key")}
        </button>
      </div>
      {note && <p role="status" className="muted">{note}</p>}
      {error && <p role="alert" className="studio-error">{error}</p>}
      <h3>{tr("Where the key goes")}</h3>
      <ul>
        <li>{tr("Companion (Stream Deck): the Access key field of the Split Control connection.")}</li>
        <li>{tr("OBS or vMix on another computer: copy the network link in Output → Web output. It already ends in ?key=.")}</li>
        <li>{tr("Director page on a phone or laptop: the link on the Live desk already carries the key.")}</li>
        <li>{tr("OGraf controllers and other tools: send it as Authorization: Bearer <key>, or add ?key= to the address.")}</li>
      </ul>
      <p className="muted">
        {tr("This computer never needs the key. The key travels unencrypted on the network: it keeps other devices out, not someone who can watch the traffic.")}
      </p>
    </div>
  );
}
