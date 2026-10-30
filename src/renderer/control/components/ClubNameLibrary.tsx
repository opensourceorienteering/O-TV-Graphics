import { t as tr } from "../i18n";
import { useEffect, useState } from "react";
import type { ClubNameRow } from "../../../shared/types/event";
import { call } from "../events/api";

/**
 * The app's club name library: names graphics use in every event instead of the name the
 * data source sends. Filled from the start list review (Plan → Start lists) or here.
 */
export function ClubNameLibrary() {
  const [rows, setRows] = useState<ClubNameRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [newName, setNewName] = useState("");
  const [newShort, setNewShort] = useState("");
  const [error, setError] = useState("");

  const load = async () => {
    const list = await call<ClubNameRow[]>("clubNames:list");
    setRows(list);
    setDrafts(Object.fromEntries(list.map((r) => [r.name, r.override ?? ""])));
  };
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);

  const set = async (updates: Record<string, string>) => {
    setError("");
    try {
      await call("clubNames:set", updates);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const shown = rows.filter((r) =>
    `${r.name} ${r.override ?? ""}`.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div className="club-names">
      {error && (
        <p role="alert" className="studio-error">
          {error}
        </p>
      )}
      <form
        className="row wrap"
        onSubmit={(e) => {
          e.preventDefault();
          if (!newName.trim() || !newShort.trim()) return;
          void set({ [newName.trim()]: newShort.trim() }).then(() => {
            setNewName("");
            setNewShort("");
          });
        }}
      >
        <label>
          {tr("Club (as the data source sends it)")}{" "}
          <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} />
        </label>
        <label>
          {tr("Name on air")}{" "}
          <input type="text" value={newShort} onChange={(e) => setNewShort(e.target.value)} />
        </label>
        <button className="studio-button" type="submit" disabled={!newName.trim() || !newShort.trim()}>
          {tr("Add")}
        </button>
      </form>
      {!rows.length ? (
        <p className="empty-state">
          {tr("No club names yet. Add them here, or review an event's clubs in Plan → Start lists.")}
        </p>
      ) : (
        <>
          <div className="row wrap">
            <label>
              {tr("Find club")}{" "}
              <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} />
            </label>
            <span className="muted">
              {rows.length} {tr("clubs")}
            </span>
          </div>
          <div className="table-scroll">
            <table className="studio-table">
              <thead>
                <tr>
                  <th scope="col">{tr("Club (as the data source sends it)")}</th>
                  <th scope="col">{tr("Name on air")}</th>
                  <th scope="col">
                    <span className="visually-hidden">{tr("Remove")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.name}>
                    <td>{r.name}</td>
                    <td>
                      <input
                        type="text"
                        aria-label={`${tr("Name on air for")} ${r.name}`}
                        value={drafts[r.name] ?? ""}
                        placeholder={r.automatic}
                        onChange={(e) => setDrafts({ ...drafts, [r.name]: e.target.value })}
                        onBlur={() => {
                          const value = (drafts[r.name] ?? "").trim();
                          // Emptying the field here would remove the club: use Remove for that
                          if (value && value !== r.override) void set({ [r.name]: value });
                          else if (!value) setDrafts({ ...drafts, [r.name]: r.override ?? "" });
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          if (e.key === "Escape") setDrafts({ ...drafts, [r.name]: r.override ?? "" });
                        }}
                      />
                    </td>
                    <td>
                      <button
                        className="studio-button"
                        type="button"
                        aria-label={`${tr("Remove")} ${r.name}`}
                        onClick={() => void set({ [r.name]: "" })}
                      >
                        {tr("Remove")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!shown.length && <p className="empty-state">{tr("No clubs match your filters.")}</p>}
          </div>
        </>
      )}
    </div>
  );
}
