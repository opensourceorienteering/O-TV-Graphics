import { t as tr } from "../i18n";
/**
 * Settings form for a timing plugin, built from its configSchema (src/shared/timing-sdk).
 */

import type { ConfigSchema, ConfigProperty } from "../../../shared/timing-sdk";

const HIDDEN = new Set(["ssl"]);

export function PluginConfigForm({
  schema,
  value,
  onChange,
}: {
  schema: ConfigSchema;
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}) {
  const required = new Set(schema.required ?? []);
  const set = (key: string, v: unknown) => {
    const next = { ...value };
    if (v === undefined || v === "") delete next[key];
    else next[key] = v;
    onChange(next);
  };

  return (
    <>
      {Object.entries(schema.properties)
        .filter(([key]) => !HIDDEN.has(key))
        .map(([key, prop]) => (
          <PluginField
            key={key}
            id={`plugin-config-${key}`}
            prop={prop}
            label={`${tr(prop.title ?? key)}${required.has(key) ? " *" : ""}`}
            value={value[key]}
            onChange={(v) => set(key, v)}
          />
        ))}
    </>
  );
}

function PluginField({
  id,
  prop,
  label,
  value,
  onChange,
}: {
  id: string;
  prop: ConfigProperty;
  label: string;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const help = prop.description ? <small className="help-text">{tr(prop.description)}</small> : null;

  if (prop.type === "boolean") {
    return (
      <div className="form-group">
        <label className="checkbox-label">
          <input
            id={id}
            type="checkbox"
            checked={value === undefined ? prop.default === true : value === true}
            onChange={(e) => onChange(e.target.checked)}
          />{" "}
          {label}
        </label>
        {help}
      </div>
    );
  }

  if (prop.enum?.length) {
    return (
      <div className="form-group">
        <label htmlFor={id}>{label}</label>
        <select
          id={id}
          value={String(value ?? prop.default ?? "")}
          onChange={(e) => {
            const picked = prop.enum!.find((o) => String(o) === e.target.value);
            onChange(picked);
          }}
        >
          {prop.enum.map((o) => (
            <option key={String(o)} value={String(o)}>
              {String(o)}
            </option>
          ))}
        </select>
        {help}
      </div>
    );
  }

  const numeric = prop.type === "number" || prop.type === "integer";
  return (
    <div className="form-group">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type={numeric ? "number" : prop.format === "password" ? "password" : "text"}
        min={prop.minimum}
        max={prop.maximum}
        step={prop.type === "integer" ? 1 : undefined}
        value={value === undefined || value === null ? "" : String(value)}
        placeholder={prop.default !== undefined ? String(prop.default) : undefined}
        autoComplete={prop.format === "password" ? "new-password" : undefined}
        onChange={(e) => {
          const raw = e.target.value;
          if (!numeric) return onChange(raw);
          if (raw === "") return onChange(undefined);
          const n = prop.type === "integer" ? parseInt(raw, 10) : parseFloat(raw);
          onChange(Number.isFinite(n) ? n : undefined);
        }}
      />
      {help}
    </div>
  );
}
