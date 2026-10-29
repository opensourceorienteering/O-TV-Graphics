import { t as tr } from "../i18n";
import { useState, type Dispatch, type SetStateAction } from "react";
import type { SPXProject } from "../../../shared/types/spx";
import type { EventFolder } from "../../../shared/types/event";
import { call } from "./api";

export function EventInfoForm({
  event,
  setEvent,
  folders,
  busy,
  onSave,
  onLink,
  onDefaults,
  onDirtyChange,
}: {
  event: SPXProject;
  setEvent: Dispatch<SetStateAction<SPXProject | undefined>>;
  folders: EventFolder[];
  busy: boolean;
  onSave: () => void;
  onLink: (
    key: "look" | "branding" | "data" | "info",
    enabled: boolean,
  ) => void;
  onDefaults: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [weatherBusy, setWeatherBusy] = useState(false);
  const [weatherError, setWeatherError] = useState("");
  const [logoError, setLogoError] = useState("");
  const logoUrl = event.settings?.presentation?.logoUrl || "";
  const logoChoice = !logoUrl
    ? "none"
    : logoUrl === "/built-in-assets/tyr-logo.png"
      ? "tyr"
    : logoUrl === "/built-in-assets/iof-logo.svg"
      ? "iof"
      : "custom";
  const setLogo = (nextLogoUrl?: string) => {
    onDirtyChange?.(true);
    setEvent({
      ...event,
      settings: {
        ...event.settings,
        presentation: {
          ...event.settings?.presentation,
          logoUrl: nextLogoUrl,
        },
      },
    });
  };
  const field = (
    key: "date" | "location" | "timeZone" | "organiser" | "series",
    label: string,
  ) => (
    <label>
      {tr(label)}
      <input
        type={key === "date" ? "date" : "text"}
        required={key === "date"}
        value={event.info?.[key] || ""}
        placeholder={key === "timeZone" ? "Europe/Stockholm" : undefined}
        onChange={(e) => {
          onDirtyChange?.(true);
          setEvent({ ...event, info: { ...event.info, [key]: e.target.value } });
        }}
      />
    </label>
  );
  return (
    <form
      className="studio-form event-info-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSave();
      }}
    >
      <div>
        <h3>{tr("2. Confirm event details")}</h3>
        <p className="muted">
           {tr("Review details from the selected competition, then save them for the broadcast.")} </p>
      </div>
      <label>
         {tr("Event name")} <input
          required
          autoComplete="off"
          value={event.name}
          onChange={(e) => {
            onDirtyChange?.(true);
            setEvent({ ...event, name: e.target.value });
          }}
        />
      </label>
      <div className="field-grid">
        {field("date", tr("Date"))}
        {field("location", tr("Location"))}
      </div>
      <section className="event-logo-setup" aria-labelledby="event-logo-heading">
        <div>
          <h4 id="event-logo-heading">{tr("Organizer / event logo")}</h4>
          <p className="muted">
             {tr("Used in the logo areas of start lists, start groups, title cards, and other supported graphics.")} </p>
        </div>
        <div className="logo-choice-grid" role="radiogroup" aria-label={tr("Event logo")}>
          <label className={logoChoice === "iof" ? "selected" : ""}>
            <input
              type="radio"
              name="event-logo"
              checked={logoChoice === "iof"}
              onChange={() => setLogo("/built-in-assets/iof-logo.svg")}
            />
            <img src="/assets/iof-logo.svg" alt="" />
            <span><strong>{tr("IOF logo")}</strong><small>{tr("Included with Split Control")}</small></span>
          </label>
          <label className={logoChoice === "tyr" ? "selected" : ""}>
            <input type="radio" name="event-logo" checked={logoChoice === "tyr"} onChange={() => setLogo("/built-in-assets/tyr-logo.png")} />
            <img src="/assets/tyr-logo.png" alt="" />
            <span><strong>{tr("OK Tyr logo")}</strong><small>{tr("Included with Split Control")}</small></span>
          </label>
          <label className={logoChoice === "custom" ? "selected" : ""}>
            <input
              type="radio"
              name="event-logo"
              checked={logoChoice === "custom"}
              onChange={() => document.getElementById("event-logo-file")?.click()}
            />
            {logoChoice === "custom" && logoUrl ? <img src={logoUrl} alt="Selected custom logo" /> : <span className="logo-placeholder" aria-hidden="true">+</span>}
            <span><strong>{tr("Custom logo")}</strong><small>PNG, JPEG, WebP, or SVG</small></span>
          </label>
          <label className={logoChoice === "none" ? "selected" : ""}>
            <input
              type="radio"
              name="event-logo"
              checked={logoChoice === "none"}
              onChange={() => setLogo(undefined)}
            />
            <span className="logo-placeholder" aria-hidden="true">—</span>
            <span><strong>{tr("No logo")}</strong><small>{tr("Hide event branding")}</small></span>
          </label>
        </div>
        <input
          id="event-logo-file"
          className="visually-hidden"
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml"
          onChange={(changeEvent) => {
            const file = changeEvent.target.files?.[0];
            if (!file) return;
            setLogoError("");
            if (file.size > 2 * 1024 * 1024) {
              setLogoError("Choose a logo smaller than 2 MB.");
              changeEvent.target.value = "";
              return;
            }
            const reader = new FileReader();
            reader.onload = () => setLogo(String(reader.result));
            reader.onerror = () => setLogoError("The logo file could not be read.");
            reader.readAsDataURL(file);
            changeEvent.target.value = "";
          }}
        />
        {logoChoice === "custom" && (
          <button type="button" className="studio-button" onClick={() => document.getElementById("event-logo-file")?.click()}>
             {tr("Replace custom logo")} </button>
        )}
        {logoError && <p className="field-error" role="alert">{logoError}</p>}
      </section>
      <section className="weather-setup" aria-labelledby="weather-heading">
        <div>
          <h4 id="weather-heading">{tr("Weather")}</h4>
          <p className="muted">
             {tr("The Weather graphic fetches current conditions at the venue by itself and refreshes them while on air. Coordinates make the lookup exact; otherwise the location above is used.")} </p>
        </div>
        <div className="field-grid">
          <label>
             {tr("Latitude")} <input
              type="number"
              step="any"
              inputMode="decimal"
              value={event.info?.latitude ?? ""}
              placeholder="59.3293"
              onChange={(e) => {
                onDirtyChange?.(true);
                setEvent({
                  ...event,
                  info: {
                    ...event.info,
                    latitude: e.target.value === "" ? undefined : Number(e.target.value),
                  },
                });
              }}
            />
          </label>
          <label>
             {tr("Longitude")} <input
              type="number"
              step="any"
              inputMode="decimal"
              value={event.info?.longitude ?? ""}
              placeholder="18.0686"
              onChange={(e) => {
                onDirtyChange?.(true);
                setEvent({
                  ...event,
                  info: {
                    ...event.info,
                    longitude: e.target.value === "" ? undefined : Number(e.target.value),
                  },
                });
              }}
            />
          </label>
        </div>
        <div className="row wrap">
          <button
            type="button"
            className="studio-button"
            disabled={busy || weatherBusy || (!event.info?.location && (event.info?.latitude == null || event.info?.longitude == null))}
            onClick={() => void (async () => {
              setWeatherBusy(true);
              setWeatherError("");
              try {
                const result = await call<any>("weather:lookup", {
                  address: event.info?.location,
                  latitude: event.info?.latitude,
                  longitude: event.info?.longitude,
                });
                onDirtyChange?.(true);
                setEvent({
                  ...event,
                  info: {
                    ...event.info,
                    // Keep the venue text; only fill in where it is for the weather
                    location: event.info?.location || result.place,
                    latitude: result.latitude,
                    longitude: result.longitude,
                    weather: {
                      condition: result.condition,
                      temperature: result.temperature,
                      windSpeed: result.windSpeed,
                      humidity: result.humidity,
                      fetchedAt: result.fetchedAt,
                    },
                  },
                });
              } catch (error) {
                setWeatherError((error as Error).message);
              } finally {
                setWeatherBusy(false);
              }
            })()}
          >
            {weatherBusy ? "Checking…" : tr("Check weather now")}
          </button>
          {event.info?.weather && (
            <p className="weather-reading" role="status">
              <strong>{event.info.weather.condition}</strong>
              {event.info.weather.temperature != null && ` · ${event.info.weather.temperature}°C`}
              {event.info.weather.windSpeed != null && ` · Wind ${event.info.weather.windSpeed} km/h`}
              {event.info.weather.humidity != null && ` · ${event.info.weather.humidity}% humidity`}
            </p>
          )}
        </div>
        {weatherError && <p className="field-error" role="alert">{weatherError}</p>}
      </section>
      <details className="settings-disclosure">
        <summary>
           {tr("Time zone and organiser")} <small>{event.info?.timeZone || "Europe/Stockholm"}</small>
        </summary>
        <div className="studio-form">
          <div className="field-grid">
            {field("timeZone", tr("Time zone"))}
            {field("organiser", tr("Organiser"))}
            {field("series", tr("Series or championship"))}
          </div>
        </div>
      </details>
      <details className="settings-disclosure">
        <summary>{tr("Folder and shared settings")}</summary>
        <div className="studio-form">
          <label>
             {tr("Folder")} <select
              value={event.folderId || ""}
              onChange={(e) => {
                onDirtyChange?.(true);
                setEvent({ ...event, folderId: e.target.value || undefined });
              }}
            >
              <option value="">{tr("No folder")}</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
          {event.folderId && (
            <>
              <p className="muted">
                 {tr("Follow the folder’s settings, or keep this event independent. Changes to shared settings wait while this event is on air.")} </p>
              {(["look", "branding", "data", "info"] as const).map((key) => (
                <label className="inline-label" key={key}>
                  <input
                    type="checkbox"
                    checked={!!event.folderInheritance?.[key]}
                    disabled={busy}
                    onChange={(e) => onLink(key, e.target.checked)}
                  />
                  {
                    {
                      look: tr("Use folder look"),
                      branding: tr("Use folder logos"),
                      data: tr("Use folder data source"),
                      info: tr("Use folder event details"),
                    }[key]
                  }
                </label>
              ))}
              <button
                type="button"
                className="studio-button"
                disabled={busy}
                onClick={onDefaults}
              >
                 {tr("Use this event as folder defaults")} </button>
            </>
          )}
          <label>
             {tr("Event status")} <select
              value={event.status || "planning"}
              onChange={(e) => {
                onDirtyChange?.(true);
                setEvent({
                  ...event,
                  status: e.target.value as "planning" | "done",
                });
              }}
            >
              <option value="planning">{tr("In preparation")}</option>
              <option value="done">{tr("Completed")}</option>
            </select>
          </label>
        </div>
      </details>
      <div className="form-actions">
        <button className="studio-button primary" disabled={busy}>
          {busy ? tr("Saving…") : tr("Save event")}
        </button>
      </div>
    </form>
  );
}
