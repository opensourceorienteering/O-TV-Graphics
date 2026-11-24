import { t as tr } from "../i18n";
/**
 * An event's additional sources: data next to the timing source (GPS, heart rate …). They only
 * add the fields their plugin declares (results[].x.<plugin>), never places, times or runners.
 */

import { useEffect, useState } from "react";
import type { AdditionalSource } from "../../../shared/types/event";
import type { DataSourceConfig, DataSourceTypeInfo } from "../../../shared/types/dataSource";

export function AdditionalSources({
  timingSourceId,
  value,
  sources,
  onChange,
}: {
  timingSourceId?: string;
  value: AdditionalSource[];
  sources: DataSourceConfig[];
  onChange: (next: AdditionalSource[]) => void;
}) {
  const [types, setTypes] = useState<DataSourceTypeInfo[]>([]);
  useEffect(() => {
    window.electronAPI
      .invoke("dataSource:getTypes")
      .then((r: any) => r.success && setTypes(r.data || []))
      .catch(() => undefined);
  }, []);

  const typeOf = (sourceId: string) => {
    const type = sources.find((s) => s.id === sourceId)?.type;
    return types.find((t) => t.type === type);
  };
  const timingType = timingSourceId ? sources.find((s) => s.id === timingSourceId)?.type : undefined;
  const used = new Set([timingType, ...value.map((a) => sources.find((s) => s.id === a.sourceId)?.type)]);
  // Sources whose plugin declares fields, not the timing source, one per plugin
  const eligible = sources.filter(
    (s) => s.enabled && s.id !== timingSourceId && !used.has(s.type) && (typeOf(s.id)?.extFields?.length ?? 0) > 0,
  );

  return (
    <div className="additional-sources">
      <h4>{tr("Additional sources")}</h4>
      <p className="muted">
        {tr(
          "Extra data next to the timing source, such as GPS speed. It only adds its own fields to the graphics; places, times and runners always come from the timing source.",
        )}
      </p>
      {value.map((a, i) => {
        const source = sources.find((s) => s.id === a.sourceId);
        const type = typeOf(a.sourceId);
        return (
          <div key={a.sourceId} className="row additional-source">
            <strong>{source?.name ?? a.sourceId}</strong>
            <span className="muted">
              {(type?.extFields ?? []).map((f) => (f.on === "entry" ? `results[].x.${type?.type}.${f.key}` : `x.${type?.type}.${f.key}`)).join(", ") || tr("no fields declared")}
            </span>
            <label>
              {tr("Competition id")}{" "}
              <input
                type="number"
                min={1}
                placeholder={tr("first")}
                value={a.competitionId ?? ""}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10);
                  onChange(value.map((x, j) => (j === i ? { sourceId: x.sourceId, ...(Number.isFinite(n) ? { competitionId: n } : {}) } : x)));
                }}
              />
            </label>
            <button className="studio-button" onClick={() => onChange(value.filter((_, j) => j !== i))}>
              {tr("Remove")}
            </button>
          </div>
        );
      })}
      {eligible.length > 0 ? (
        <label>
          {tr("Add")}{" "}
          <select
            value=""
            onChange={(e) => e.target.value && onChange([...value, { sourceId: e.target.value }])}
          >
            <option value="">{tr("Choose a source")}</option>
            {eligible.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      ) : (
        !value.length && (
          <p className="muted">
            {tr("No source with extra fields is set up. Install a timing plugin that declares fields (such as GPS), then add it as a data source.")}
          </p>
        )
      )}
    </div>
  );
}
