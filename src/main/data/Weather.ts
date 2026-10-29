/**
 * Current weather at the event venue (Open-Meteo, no key needed).
 *
 * The venue is the event's coordinates, or its location looked up by name. Readings are cached
 * for a few minutes so Preview, Show and the on-air refresh share one request. When the service
 * cannot be reached, the last reading saved on the event (Settings → Fetch current weather) is used.
 */

import type { EventInfo } from "../../shared/types/event";

export interface WeatherReading {
  place: string;
  latitude: number;
  longitude: number;
  condition: string;
  temperature: number;
  windSpeed: number;
  humidity: number;
  fetchedAt: number;
}

/** How fresh a reading must be before the service is asked again */
export const WEATHER_MAX_AGE_MS = 5 * 60_000;

const CONDITIONS: Record<number, string> = {
  0: "Clear", 1: "Mostly clear", 2: "Partly cloudy", 3: "Overcast",
  45: "Fog", 48: "Freezing fog", 51: "Light drizzle", 53: "Drizzle",
  55: "Heavy drizzle", 56: "Freezing drizzle", 57: "Freezing drizzle",
  61: "Light rain", 63: "Rain", 65: "Heavy rain", 66: "Freezing rain", 67: "Freezing rain",
  71: "Light snow", 73: "Snow", 75: "Heavy snow", 77: "Snow grains",
  80: "Rain showers", 81: "Rain showers", 82: "Heavy rain showers",
  85: "Snow showers", 86: "Heavy snow showers",
  95: "Thunderstorm", 96: "Thunderstorm with hail", 99: "Thunderstorm with hail",
};

const geocodeCache = new Map<string, { latitude: number; longitude: number; place: string }>();
const readingCache = new Map<string, WeatherReading>();

async function geocodeOne(name: string) {
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.searchParams.set("name", name);
  url.searchParams.set("count", "1");
  url.searchParams.set("language", "en");
  url.searchParams.set("format", "json");
  const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error("Unable to look up that address");
  return ((await response.json()) as any).results?.[0] ?? null;
}

/**
 * Locations are often "venue, town" ("Bärstadsskolan, Hammarö"); the geocoder only knows
 * places, so try the whole text, then each part from the end (town before venue).
 */
async function geocode(address: string) {
  const key = address.trim().toLowerCase();
  const cached = geocodeCache.get(key);
  if (cached) return cached;
  const parts = address.split(",").map((p) => p.trim()).filter(Boolean);
  const candidates = [...new Set([address.trim(), ...parts.slice().reverse()])];
  for (const name of candidates) {
    const match = await geocodeOne(name);
    if (!match) continue;
    const found = {
      latitude: match.latitude,
      longitude: match.longitude,
      place: [match.name, match.admin1, match.country].filter(Boolean).join(", "),
    };
    geocodeCache.set(key, found);
    return found;
  }
  throw new Error(`No place matched "${address}". Add the venue's coordinates (Settings → Event info → Weather).`);
}

/** Current conditions for an address or coordinates (always asks the service) */
export async function lookupWeather(input: {
  address?: string;
  latitude?: number | string | null;
  longitude?: number | string | null;
}): Promise<WeatherReading> {
  let latitude = input.latitude == null || input.latitude === "" ? NaN : Number(input.latitude);
  let longitude = input.longitude == null || input.longitude === "" ? NaN : Number(input.longitude);
  let place = input.address?.trim() || "";
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    if (!place) throw new Error("Add the event location or the venue's coordinates in Plan");
    ({ latitude, longitude, place } = await geocode(place));
  }
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(latitude));
  url.searchParams.set("longitude", String(longitude));
  url.searchParams.set("current", "temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m");
  url.searchParams.set("wind_speed_unit", "kmh");
  url.searchParams.set("timezone", "auto");
  const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error("The weather service is unavailable");
  const current = ((await response.json()) as any).current;
  if (!current) throw new Error("No current weather is available for this location");
  return {
    place,
    latitude,
    longitude,
    condition: CONDITIONS[current.weather_code] || "Current conditions",
    temperature: Math.round(current.temperature_2m),
    windSpeed: Math.round(current.wind_speed_10m),
    humidity: Math.round(current.relative_humidity_2m),
    fetchedAt: Date.now(),
  };
}

export interface EventWeather {
  reading: WeatherReading | null;
  /** "live": fresh from the service; "saved": the event's last saved reading (service unreachable) */
  source: "live" | "saved" | "none";
  error?: string;
}

/** The event venue's weather, cached for WEATHER_MAX_AGE_MS; `force` skips the cache */
export async function eventWeather(info: EventInfo | undefined, force = false): Promise<EventWeather> {
  const key =
    info?.latitude != null && info?.longitude != null
      ? `${info.latitude},${info.longitude}`
      : (info?.location || "").trim().toLowerCase();
  const cached = key ? readingCache.get(key) : undefined;
  if (cached && !force && Date.now() - cached.fetchedAt < WEATHER_MAX_AGE_MS)
    return { reading: cached, source: "live" };
  try {
    const reading = await lookupWeather({
      address: info?.location,
      latitude: info?.latitude,
      longitude: info?.longitude,
    });
    readingCache.set(key, reading);
    return { reading, source: "live" };
  } catch (error) {
    const message = (error as Error).message;
    if (cached) return { reading: cached, source: "live", error: message };
    const saved = info?.weather;
    if (saved?.condition || saved?.temperature != null)
      return {
        reading: {
          place: info?.location || "",
          latitude: info?.latitude ?? NaN,
          longitude: info?.longitude ?? NaN,
          condition: saved.condition || "",
          temperature: saved.temperature ?? NaN,
          windSpeed: saved.windSpeed ?? NaN,
          humidity: saved.humidity ?? NaN,
          fetchedAt: saved.fetchedAt ?? 0,
        },
        source: "saved",
        error: message,
      };
    return { reading: null, source: "none", error: message };
  }
}

/** Graphic fields from a reading; what the operator typed wins, empty fields are filled in */
export function weatherFields(
  reading: WeatherReading | null,
  typed: Record<string, any> = {},
): Record<string, any> {
  const num = (n: number) => (Number.isFinite(n) ? String(n) : "");
  const auto: Record<string, string> = reading
    ? {
        condition: reading.condition,
        temperature: num(reading.temperature),
        wind: num(reading.windSpeed),
        humidity: num(reading.humidity),
      }
    : {};
  const out: Record<string, any> = { ...auto };
  for (const [k, v] of Object.entries(typed)) if (v !== undefined && v !== "") out[k] = v;
  return out;
}
