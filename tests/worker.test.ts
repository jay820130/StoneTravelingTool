import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { processOneJob } from "../src/lib/worker";
import { fetchSourceText, SourceFetchError } from "../src/lib/safe-fetch";
import { extractPlaces } from "../src/lib/parser";

const mock = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), download: vi.fn() }));
vi.mock("../src/lib/supabase/admin", () => ({
  adminClient: () => ({ ...mock, storage: { from: () => ({ download: mock.download }) } }),
}));
vi.mock("../src/lib/safe-fetch", async (original) => ({
  ...(await original<typeof import("../src/lib/safe-fetch")>()),
  fetchSourceText: vi.fn(),
}));
vi.mock("../src/lib/parser", () => ({ extractPlaces: vi.fn() }));
let content: string;
let files: { path: string; mime_type: string }[];
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("AI_API_KEY", "test-only-placeholder");
  content = "";
  files = [];
  mock.rpc.mockImplementation(async (name) =>
    name === "claim_import_job"
      ? {
          data: { id: "job", source_id: "source", revision: 4, claim_id: "claim-token" },
          error: null,
        }
      : { data: true, error: null },
  );
  mock.from.mockImplementation((table) => {
    const chain = {
      select: () => chain,
      update: () => chain,
      eq: () => chain,
      single: async () => ({
        data: {
          id: "source",
          owner_id: "owner",
          revision: 4,
          original_url: "https://maps.app.goo.gl/fictional-test-link",
          content_text: content,
          reason: "PRIVATE REASON: never send to AI",
        },
        error: null,
      }),
      limit: async () => ({ data: table === "attachments" ? files : [], error: null }),
    };
    return chain;
  });
  vi.mocked(fetchSourceText).mockResolvedValue("Fictional place sharing preview with address");
  vi.mocked(extractPlaces).mockResolvedValue({
    status: "partial",
    summary: "Fictional",
    candidates: [],
    error: "",
  });
});
afterEach(() => vi.unstubAllEnvs());

describe("background source processing", () => {
  it("automatically fetches an unfilled link, parses its preview and completes the claimed revision", async () => {
    await processOneJob();
    expect(fetchSourceText).toHaveBeenCalledOnce();
    expect(extractPlaces).toHaveBeenCalledWith("Fictional place sharing preview with address", []);
    expect(mock.rpc).toHaveBeenLastCalledWith(
      "complete_import_job",
      expect.objectContaining({
        job_id: "job",
        token: "claim-token",
        retry: false,
        result: expect.objectContaining({ status: "partial" }),
      }),
    );
  });
  it("keeps pasted content authoritative and never sends the private collection reason", async () => {
    content = "User supplied fictional place/address";
    await processOneJob();
    expect(fetchSourceText).not.toHaveBeenCalled();
    expect(extractPlaces).toHaveBeenCalledWith(content, []);
    expect(JSON.stringify(vi.mocked(extractPlaces).mock.calls)).not.toContain("PRIVATE REASON");
  });
  it("preserves the screenshot fallback without fetching an inaccessible source again", async () => {
    files = [{ path: "owner/source/fixture.png", mime_type: "image/png" }];
    mock.download.mockResolvedValue({ data: new Blob(["fictional-image"]), error: null });
    await processOneJob();
    expect(fetchSourceText).not.toHaveBeenCalled();
    expect(extractPlaces).toHaveBeenCalledWith("", [
      { mime: "image/png", data: Buffer.from("fictional-image").toString("base64") },
    ]);
  });
  it("fetches a link when the user supplied only whitespace", async () => {
    content = "  \n  ";
    await processOneJob();
    expect(fetchSourceText).toHaveBeenCalledOnce();
  });
  it.each([new SourceFetchError("timeout", true), new SourceFetchError("http", true, 429)])(
    "requests bounded durable retries for temporary source failures",
    async (failure) => {
      vi.mocked(fetchSourceText).mockRejectedValue(failure);
      await processOneJob();
      expect(extractPlaces).not.toHaveBeenCalled();
      expect(mock.rpc).toHaveBeenLastCalledWith(
        "complete_import_job",
        expect.objectContaining({
          retry: true,
          result: expect.objectContaining({ status: "failed", error: failure.message }),
        }),
      );
    },
  );
  it("keeps a permanent source rejection readable and does not waste AI requests", async () => {
    const failure = new SourceFetchError("http", false, 403);
    vi.mocked(fetchSourceText).mockRejectedValue(failure);
    await processOneJob();
    expect(extractPlaces).not.toHaveBeenCalled();
    expect(mock.rpc).toHaveBeenLastCalledWith(
      "complete_import_job",
      expect.objectContaining({
        retry: false,
        result: expect.objectContaining({ status: "needs_input", error: failure.message }),
      }),
    );
  });
  it("does not fetch source pages or download attachments when AI is disabled", async () => {
    vi.stubEnv("AI_API_KEY", "");
    files = [{ path: "owner/source/fixture.png", mime_type: "image/png" }];
    await processOneJob();
    expect(fetchSourceText).not.toHaveBeenCalled();
    expect(mock.download).not.toHaveBeenCalled();
  });
});
