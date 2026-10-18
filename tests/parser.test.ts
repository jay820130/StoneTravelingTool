import { afterEach, describe, it, expect, vi } from "vitest";
import { extractPlaces } from "../src/lib/parser";
afterEach(() => vi.unstubAllEnvs());
describe("honest parsing and AI boundaries", () => {
  it("reports unreadable content as needs_input rather than success", async () => {
    const result = await extractPlaces("", []);
    expect(result.status).toBe("needs_input");
    expect(result.candidates).toEqual([]);
  });
  it("never calls AI without a configured key", async () => {
    vi.stubEnv("AI_API_KEY", "");
    const request = vi.fn();
    expect((await extractPlaces("一篇文章", [], request)).status).toBe("needs_input");
    expect(request).not.toHaveBeenCalled();
  });
  it("rejects invalid model output instead of persisting fabricated structure", async () => {
    vi.stubEnv("AI_API_KEY", "test-only-placeholder");
    const request = vi.fn().mockResolvedValue(
      Response.json({
        choices: [{ message: { content: '{"summary":"ok","candidates":[{"name":null}]}' } }],
      }),
    );
    await expect(extractPlaces("article", [], request)).rejects.toThrow();
  });
  it("keeps unknown location empty and normalizes explicit city aliases", async () => {
    vi.stubEnv("AI_API_KEY", "test-only-placeholder");
    const request = vi.fn().mockResolvedValue(
      Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                summary: "two stores",
                candidates: [
                  {
                    name: "A",
                    country: "Japan",
                    city: "Osaka",
                    address: "",
                    categories: ["咖啡廳"],
                    dishes: ["拿鐵"],
                    summary: "A",
                  },
                  {
                    name: "B",
                    country: "",
                    city: "",
                    address: "",
                    categories: [],
                    dishes: [],
                    summary: "B",
                  },
                ],
              }),
            },
          },
        ],
      }),
    );
    const result = await extractPlaces("untrusted text", [], request);
    expect(result.status).toBe("partial");
    expect(result.candidates[0].city).toBe("大阪");
    expect(result.candidates[1].country).toBe("");
    const body = JSON.parse(request.mock.calls[0][1].body);
    expect(body.messages[0].content).toContain("UNTRUSTED");
    expect(body.messages[1].content[0].text).toContain("untrusted_article");
  });
  it("propagates transient AI errors for bounded job retries", async () => {
    vi.stubEnv("AI_API_KEY", "test-only-placeholder");
    await expect(
      extractPlaces("text", [], vi.fn().mockResolvedValue(new Response("", { status: 429 }))),
    ).rejects.toThrow("AI 服務");
  });
});
