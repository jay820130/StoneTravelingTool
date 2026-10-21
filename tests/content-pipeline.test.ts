import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { parseMapsUrl } from "../src/lib/maps-parser";
import { sourceUrl } from "../src/lib/domain";
import { imageMime, meaningfulText } from "../src/lib/images";
import { extractPlaces } from "../src/lib/parser";
import { geocodingSettings, normalizeLocations } from "../src/lib/geocoding";
beforeEach(() => {
  vi.stubEnv("AI_API_KEY", "test-only");
  vi.stubEnv("AI_MODEL", "test-model");
});
afterEach(() => vi.unstubAllEnvs());
describe("Maps URL rules", () => {
  it("decodes a store name including encoded slash and explicit coordinates", () => {
    expect(
      parseMapsUrl(
        "https://www.google.com.tw/maps/place/Test%2FCafe+Branch/@1,2,10z/data=!1s0xabc:0x123!3d25.1!4d121.5",
      ),
    ).toMatchObject({
      name: "Test/Cafe Branch",
      latitude: 25.1,
      longitude: 121.5,
      coordinate_kind: "place",
      feature_id: "0xabc:0x123",
    });
  });
  it("keeps camera center distinct from a confirmed location", () => {
    expect(parseMapsUrl("https://www.google.com/maps/place/Test/@25,121,16z")).toMatchObject({
      coordinate_kind: "viewport",
      latitude: 25,
      longitude: 121,
    });
  });
  it("retains identifiers without inventing invalid cid digits", () => {
    expect(
      parseMapsUrl("https://www.google.com/maps/search/?query_place_id=ChIFixture&cid=abc123"),
    ).toMatchObject({ place_id: "ChIFixture", cid: "", name: "" });
  });
  it("rejects near-matching hosts and non-Maps paths", () => {
    for (const u of [
      "https://www.google.com.tw.evil.test/maps/a",
      "https://www.google.com.tw/maps.evil",
      "https://goo.gl/unrelated",
    ])
      expect(() => sourceUrl(u)).toThrow();
  });
});
describe("image and AI boundaries", () => {
  it("accepts HEIC signature but rejects AVIF/video and forged PNG", () => {
    const heic = Buffer.alloc(24);
    heic.writeUInt32BE(24);
    heic.write("ftyp", 4);
    heic.write("heic", 8);
    heic.write("mif1", 16);
    expect(imageMime(heic)).toBe("image/heic");
    heic.write("avif", 16);
    expect(imageMime(heic)).toBeNull();
    expect(imageMime(Buffer.from("<svg>"))).toBeNull();
  });
  it("rejects URL-only, generic login and platform previews", async () => {
    const request = vi.fn();
    for (const text of [
      "https://www.instagram.com/p/fixture",
      "URL: https://www.threads.com/share/fixture",
      "Instagram",
    ]) {
      expect((await extractPlaces(text, [], request)).status).toBe("needs_input");
    }
    expect(request).not.toHaveBeenCalled();
    expect(meaningfulText("Sign up to Instagram", true)).toBe(false);
  });
  it("preserves provider status and retry-after without exposing its error body", async () => {
    await expect(
      extractPlaces(
        "Fictional shop",
        [],
        vi
          .fn()
          .mockResolvedValue(
            new Response("SECRET PRIVATE RESPONSE", {
              status: 429,
              headers: { "Retry-After": "120" },
            }),
          ),
      ),
    ).rejects.toMatchObject({
      code: "HTTP_429",
      retryable: true,
      retryAfter: 120,
      message: expect.not.stringContaining("SECRET"),
    });
  });
  it("requires a configured model and never silently selects a retired default", async () => {
    vi.stubEnv("AI_MODEL", "");
    const call = vi.fn();
    await expect(extractPlaces("Fictional shop", [], call)).rejects.toMatchObject({
      code: "model_not_configured",
      retryable: false,
    });
    expect(call).not.toHaveBeenCalled();
  });
  it("requests JSON schema with no tool or URL grounding", async () => {
    const call = vi
      .fn()
      .mockResolvedValue(
        Response.json({
          choices: [{ message: { content: JSON.stringify({ summary: "", candidates: [] }) } }],
        }),
      );
    await extractPlaces("Fictional shop", [], call);
    const body = JSON.parse(call.mock.calls[0][1].body);
    expect(body.response_format.type).toBe("json_schema");
    expect(body.tools).toBeUndefined();
    expect(body.messages[0].content).toContain("UNTRUSTED");
  });
});
describe("explicit location candidates", () => {
  it("does not enable public Nominatim without deliberate policy opt-in", () => {
    vi.stubEnv("GEOCODING_PROVIDER", "nominatim");
    vi.stubEnv("NOMINATIM_POLICY_ACCEPTED", "");
    expect(() => geocodingSettings()).toThrow("使用政策");
  });
  it("excludes city centers while retaining a concrete shop", () => {
    const base = {
      lat: "25",
      lon: "121",
      display_name: "Fictional address",
      osm_type: "node",
      osm_id: 1,
    };
    const result = normalizeLocations([
      { ...base, class: "place", type: "city" },
      { ...base, class: "shop", address: { city: "測試城市" } },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].city).toBe("測試城市");
  });
});
