import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Candidate } from "../src/lib/types";
import { contentHash, processOneJob } from "../src/lib/worker";
import { fetchSourcePage, SourceFetchError } from "../src/lib/safe-fetch";
import { AIError, extractPlaces } from "../src/lib/parser";
const mock = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), download: vi.fn() }));
vi.mock("../src/lib/supabase/admin", () => ({
  adminClient: () => ({ ...mock, storage: { from: () => ({ download: mock.download }) } }),
}));
vi.mock("../src/lib/safe-fetch", async (original) => ({
  ...(await original<typeof import("../src/lib/safe-fetch")>()),
  fetchSourcePage: vi.fn(),
}));
vi.mock("../src/lib/parser", async (original) => ({
  ...(await original<typeof import("../src/lib/parser")>()),
  extractPlaces: vi.fn(),
}));
let content: string, url: string;
let files: { path: string; mime_type: string }[];
let cache: unknown;
let candidates: Candidate[];
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5ZkAAAAASUVORK5CYII=",
  "base64",
);
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("AI_API_KEY", "test-only");
  vi.stubEnv("AI_MODEL", "test-model");
  content = "";
  url = "https://www.instagram.com/p/fixture";
  files = [];
  candidates = [];
  cache = { token: "cache-token" };
  mock.rpc.mockImplementation(async (name) => ({
    error: null,
    data:
      name === "claim_import_job"
        ? { id: "job", source_id: "source", revision: 4, claim_id: "claim-token" }
        : name === "claim_ai_extraction"
          ? cache
          : true,
  }));
  mock.from.mockImplementation((table) => {
    const chain = {
      select: () => chain,
      update: () => chain,
      eq: () => chain,
      order: () => chain,
      single: async () => ({
        data: {
          id: "source",
          owner_id: "owner",
          revision: 4,
          original_url: url,
          content_text: content,
          reason: "PRIVATE REASON",
          candidates,
        },
        error: null,
      }),
      limit: async () => ({ data: table === "attachments" ? files : [], error: null }),
    };
    return chain;
  });
  vi.mocked(fetchSourcePage).mockResolvedValue({
    text: "Fictional store metadata with an explicit address",
    trace: {
      hops: [],
      final_url: "https://www.google.com.tw/maps/place/Fictional+Cafe/data=!3d25!4d121",
    },
  });
  vi.mocked(extractPlaces).mockResolvedValue({
    status: "partial",
    summary: "測試",
    candidates: [],
    error: "",
  });
});
afterEach(() => vi.unstubAllEnvs());
const finished = () => mock.rpc.mock.calls.find((c) => c[0] === "complete_import_job")?.[1];
describe("durable rules-first import", () => {
  it("parses a Maps short link with rules and no AI even without an AI key", async () => {
    url = "https://maps.app.goo.gl/fixture";
    vi.stubEnv("AI_API_KEY", "");
    await processOneJob();
    expect(fetchSourcePage).toHaveBeenCalledWith(url, "maps");
    expect(extractPlaces).not.toHaveBeenCalled();
    expect(finished().result.candidates[0]).toMatchObject({
      name: "Fictional Cafe",
      latitude: 25,
      longitude: 121,
      coordinate_kind: "place",
    });
  });
  it("does not fetch a long Maps URL containing a place name", async () => {
    url = "https://www.google.com/maps/place/Fictional+Cafe/@25,121,16z";
    await processOneJob();
    expect(fetchSourcePage).not.toHaveBeenCalled();
    expect(extractPlaces).not.toHaveBeenCalled();
    expect(finished().result.status).toBe("partial");
  });
  it("sends substantive social metadata and saves only the claimed revision", async () => {
    await processOneJob();
    expect(extractPlaces).toHaveBeenCalledWith(
      "Fictional store metadata with an explicit address",
      [],
    );
    expect(finished()).toMatchObject({ job_id: "job", token: "claim-token", retry: false });
  });
  it("does not transmit the raw URL or generic login preview to AI", async () => {
    vi.mocked(fetchSourcePage).mockResolvedValue({
      text: "Log in to Instagram",
      trace: { hops: [], final_url: url },
    });
    await processOneJob();
    expect(extractPlaces).toHaveBeenCalledWith("", []);
    expect(mock.rpc.mock.calls.some((c) => c[0] === "claim_ai_extraction")).toBe(false);
  });
  it("uses pasted text without the collection reason or another fetch", async () => {
    content = "Fictional supplied shop address";
    await processOneJob();
    expect(fetchSourcePage).not.toHaveBeenCalled();
    expect(extractPlaces).toHaveBeenCalledWith(content, []);
    expect(JSON.stringify(vi.mocked(extractPlaces).mock.calls)).not.toContain("PRIVATE");
  });
  it("uses private images and avoids fetching social URLs", async () => {
    files = [{ path: "owner/source/file", mime_type: "image/png" }];
    mock.download.mockResolvedValue({ data: new Blob([png]), error: null });
    await processOneJob();
    expect(fetchSourcePage).not.toHaveBeenCalled();
    expect(extractPlaces).toHaveBeenCalledWith("", [
      { mime: "image/png", data: png.toString("base64") },
    ]);
  });
  it("does not fetch or download social content while AI is disabled", async () => {
    vi.stubEnv("AI_API_KEY", "");
    files = [{ path: "file", mime_type: "image/png" }];
    await processOneJob();
    expect(fetchSourcePage).not.toHaveBeenCalled();
    expect(mock.download).not.toHaveBeenCalled();
  });
  it("marks blocked social sources needs_input without crawling retries", async () => {
    vi.mocked(fetchSourcePage).mockRejectedValue(new SourceFetchError("http", true, 429));
    await processOneJob();
    expect(extractPlaces).not.toHaveBeenCalled();
    expect(finished()).toMatchObject({
      retry: false,
      result: { status: "needs_input", error_code: "source_http_429" },
    });
  });
  it("persists retry-after for transient AI failures and releases cache claim", async () => {
    content = "Fictional shop";
    vi.mocked(extractPlaces).mockRejectedValue(new AIError("HTTP_429", true, 120));
    await processOneJob();
    expect(finished()).toMatchObject({
      retry: true,
      result: { retry_after: 120, error_code: "HTTP_429" },
    });
    expect(mock.rpc).toHaveBeenCalledWith(
      "finish_ai_extraction",
      expect.objectContaining({ result: null }),
    );
  });
  it("reuses successful content without repeating AI calls", async () => {
    content = "Fictional shop";
    cache = { result: { status: "partial", summary: "已快取", candidates: [], error: "" } };
    await processOneJob();
    expect(extractPlaces).not.toHaveBeenCalled();
    expect(finished().result.summary).toBe("已快取");
  });
  it("preserves accepted candidate links through a failed parse", async () => {
    candidates = [
      {
        name: "測試已確認店",
        country: "",
        city: "",
        address: "",
        categories: [],
        dishes: [],
        summary: "",
        place_id: "confirmed-place",
      },
    ];
    content = "Fictional shop";
    vi.mocked(extractPlaces).mockRejectedValue(new AIError("HTTP_429", true));
    await processOneJob();
    expect(finished().result.candidates[0].place_id).toBe("confirmed-place");
  });
  it("changes deduplication key when content or model changes", () => {
    const a = contentHash("A", []);
    expect(contentHash(" A ", [])).toBe(a);
    expect(contentHash("B", [])).not.toBe(a);
    vi.stubEnv("AI_MODEL", "different");
    expect(contentHash("A", [])).not.toBe(a);
  });
});
