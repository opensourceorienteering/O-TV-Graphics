import { afterEach, describe, expect, it, vi } from "vitest";
import { eventWeather, lookupWeather, weatherFields } from "../Weather";

const forecast = {
  current: { temperature_2m: 9.6, relative_humidity_2m: 89.6, weather_code: 3, wind_speed_10m: 16.8 },
};

function mockFetch(places: Record<string, any>) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: URL) => {
      calls.push(url.toString());
      if (url.hostname.startsWith("geocoding")) {
        const name = url.searchParams.get("name") || "";
        return { ok: true, json: async () => ({ results: places[name] ? [places[name]] : undefined }) };
      }
      return { ok: true, json: async () => forecast };
    }),
  );
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("weather at the venue", () => {
  it('finds "venue, town" locations by the town when the venue is unknown', async () => {
    const calls = mockFetch({ "Hammarö": { name: "Hammarö", admin1: "Värmland", country: "Sweden", latitude: 59.33, longitude: 13.52 } });
    const r = await lookupWeather({ address: "Bärstadsskolan, Hammarö" });
    expect(r).toMatchObject({ place: "Hammarö, Värmland, Sweden", condition: "Overcast", temperature: 10, windSpeed: 17, humidity: 90 });
    expect(calls.filter((c) => c.includes("geocoding"))).toHaveLength(2);
  });

  it("uses coordinates directly and explains a missing location", async () => {
    const calls = mockFetch({});
    await lookupWeather({ latitude: 59.3, longitude: 18.1 });
    expect(calls.some((c) => c.includes("geocoding"))).toBe(false);
    await expect(lookupWeather({})).rejects.toThrow("Add the event location");
    await expect(lookupWeather({ address: "Nowhere at all" })).rejects.toThrow("coordinates");
  });

  it("falls back to the reading saved on the event when the service is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const w = await eventWeather({ location: "Offline town", weather: { condition: "Sunny", temperature: 21, fetchedAt: 5 } });
    expect(w.source).toBe("saved");
    expect(w.reading?.condition).toBe("Sunny");
    expect((await eventWeather({ location: "Other offline town" })).source).toBe("none");
  });

  it("fills empty graphic fields and keeps what the operator typed", () => {
    const reading = { place: "", latitude: 0, longitude: 0, condition: "Rain", temperature: 7, windSpeed: 12, humidity: 95, fetchedAt: 0 };
    expect(weatherFields(reading, { condition: "Showers", title: "", wind: undefined })).toEqual({
      condition: "Showers", temperature: "7", wind: "12", humidity: "95",
    });
    expect(weatherFields(null, { temperature: "5" })).toEqual({ temperature: "5" });
  });
});
