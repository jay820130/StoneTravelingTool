import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lookup } from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import { request } from "node:https";
import { fetchSourceText, fetchSourcePage, htmlText } from "../src/lib/safe-fetch";

vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));
vi.mock("node:https", () => ({ request: vi.fn() }));
type Reply = {
  status?: number;
  location?: string;
  type?: string;
  chunks?: Buffer[];
  error?: boolean;
  hang?: boolean;
};
const lookupAll = vi.mocked(
  lookup as (hostname: string, options: { all: true }) => Promise<LookupAddress[]>,
);
let replies: Reply[];
const shortUrl = "https://maps.app.goo.gl/fictional-test-link";
// All names and addresses below are explicitly fictional regression data.
const preview =
  '<html><head><meta content="測試咖啡 &amp; Tea · 日本大阪市測試路1號" property="og:title">' +
  '<meta property="og:description" content="咖啡廳"><title>Google Maps</title></head>';

beforeEach(() => {
  vi.clearAllMocks();
  replies = [];
  lookupAll.mockResolvedValue([{ address: "8.8.8.8", family: 4 }]);
  vi.mocked(request).mockImplementation(((
    options: unknown,
    callback: (res: EventEmitter) => void,
  ) => {
    const req = Object.assign(new EventEmitter(), {
      destroyed: false,
      end() {},
      destroy() {
        this.destroyed = true;
        return this;
      },
    });
    const reply = replies.shift();
    if (!reply) throw new Error("Unexpected request in regression test");
    req.end = () =>
      queueMicrotask(() => {
        if (reply.error) {
          req.emit("error", new Error("untrusted network error"));
          return;
        }
        if (reply.hang) return;
        const res = Object.assign(new EventEmitter(), {
          statusCode: reply.status ?? 200,
          headers: {
            location: reply.location,
            "content-type": reply.type ?? "text/html; charset=utf-8",
          },
        });
        callback(res);
        for (const chunk of reply.chunks ?? []) {
          if (req.destroyed) return;
          res.emit("data", chunk);
        }
        if (!req.destroyed) res.emit("end");
      });
    return req;
  }) as typeof request);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("metadata-only and Maps redirect strategies", () => {
  it("reads public previews, excludes body and scripts", () => {
    const text = htmlText(
      '<head><meta property="og:title" content="Test &gt; Coffee"><meta name="description" content="Fictional address &quot;1&quot;"></head><p>PRIVATE BODY</p><script>BAD</script>',
    );
    expect(text).toContain("Test > Coffee");
    expect(text).toContain('Fictional address "1"');
    expect(text).not.toContain("PRIVATE");
    expect(text).not.toContain("BAD");
  });
  it("ignores metadata inside templates and scripts", () => {
    expect(
      htmlText(
        '<template><meta name="description" content="hidden"></template><script>bad</script><p>Visible body</p>',
      ),
    ).toBe("");
  });
  it("bounds preview output", () => {
    expect(
      htmlText('<meta property="og:description" content="' + "a".repeat(30000) + '">').length,
    ).toBeLessThanOrEqual(20000);
  });
  it("resolves country Google Maps redirects without downloading body", async () => {
    replies.push(
      { status: 302, location: "https://www.google.com.tw/maps/place/Fictional+Cafe/@25,121,16z" },
      { chunks: [Buffer.alloc(2 * 1024 * 1024, "x")] },
    );
    const page = await fetchSourcePage(shortUrl, "maps");
    expect(page.text).toBe("");
    expect(page.trace.hops.map((h) => h.status)).toEqual([302, 200]);
    expect(page.trace.final_url).toContain("google.com.tw");
    expect(lookup).toHaveBeenCalledTimes(2);
  });
  it("stops reading social pages after metadata", async () => {
    replies.push({ chunks: [Buffer.from(preview), Buffer.alloc(2 * 1024 * 1024, "x")] });
    expect(await fetchSourceText("https://www.instagram.com/p/fixture")).toContain(
      "測試咖啡 & Tea",
    );
  });
  it("decodes UTF-8 split across network chunks", async () => {
    replies.push({ chunks: Array.from(Buffer.from(preview), (byte) => Buffer.from([byte])) });
    expect(await fetchSourceText("https://www.threads.com/@fixture/post/test")).toContain(
      "測試咖啡",
    );
  });
  it("rejects Maps redirects to a supported social platform", async () => {
    replies.push({ status: 302, location: "https://www.instagram.com/p/fixture" });
    await expect(fetchSourcePage(shortUrl, "maps")).rejects.toMatchObject({ kind: "redirect" });
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("does not accept non-HTML social downloads", async () => {
    replies.push({ type: "text/plain", chunks: [Buffer.from("untrusted text")] });
    await expect(fetchSourceText("https://www.instagram.com/p/fixture")).rejects.toMatchObject({
      kind: "type",
    });
  });
  it("prefers a validated IPv4 address when IPv6 is listed first", async () => {
    lookupAll.mockResolvedValue([
      { address: "2001:4860:4860::8888", family: 6 },
      { address: "8.8.8.8", family: 4 },
    ]);
    replies.push({ chunks: [Buffer.from(preview)] });
    await fetchSourceText(shortUrl);
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({ hostname: "8.8.8.8" }),
      expect.any(Function),
    );
  });
  it.each([
    "http://www.google.com/maps/place/test",
    "https://www.google.com/url?q=private",
    "https://www.google.com.evil.test/maps/test",
    "https://user:password@www.google.com/maps/test",
    "https://www.google.com:444/maps/test",
    "https://127.0.0.1/maps/test",
  ])("rejects unsafe redirect %s before DNS or another request", async (location) => {
    replies.push({ status: 302, location });
    await expect(fetchSourceText(shortUrl)).rejects.toMatchObject({
      kind: "redirect",
      retryable: false,
    });
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("rejects a private address at a later redirect", async () => {
    lookupAll
      .mockResolvedValueOnce([{ address: "8.8.8.8", family: 4 }])
      .mockResolvedValueOnce([{ address: "10.0.0.1", family: 4 }]);
    replies.push({ status: 302, location: "https://www.google.com/maps/place/Test" });
    await expect(fetchSourceText(shortUrl)).rejects.toMatchObject({ kind: "address" });
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("rejects a DNS set mixing public and private addresses", async () => {
    lookupAll.mockResolvedValue([
      { address: "8.8.8.8", family: 4 },
      { address: "169.254.169.254", family: 4 },
    ]);
    await expect(fetchSourceText(shortUrl)).rejects.toMatchObject({ kind: "address" });
    expect(request).not.toHaveBeenCalled();
  });
  it("bounds redirect loops", async () => {
    replies = Array.from({ length: 6 }, () => ({ status: 302, location: shortUrl }));
    await expect(fetchSourceText(shortUrl)).rejects.toMatchObject({ kind: "redirect" });
    expect(request).toHaveBeenCalledTimes(6);
  });
  it("keeps the download limit when no complete place preview is available", async () => {
    replies.push({ chunks: [Buffer.alloc(1024 * 1024 + 1, "x")] });
    await expect(fetchSourceText(shortUrl)).rejects.toMatchObject({
      kind: "size",
      retryable: false,
    });
  });
  it.each([
    [403, false],
    [404, false],
    [429, true],
    [503, true],
  ])("classifies HTTP %s without exposing its body", async (status, retryable) => {
    replies.push({ status: Number(status), chunks: [Buffer.from("PRIVATE RESPONSE DATA")] });
    await expect(fetchSourceText(shortUrl)).rejects.toMatchObject({
      kind: "http",
      status,
      retryable,
      message: expect.not.stringContaining("PRIVATE"),
    });
  });
  it("retries temporary DNS failures without exposing their raw errors", async () => {
    lookupAll.mockRejectedValue(new Error("private original URL"));
    await expect(fetchSourceText(shortUrl)).rejects.toMatchObject({
      kind: "dns",
      retryable: true,
      message: expect.not.stringContaining("private"),
    });
  });
  it("times out a source that never responds", async () => {
    vi.useFakeTimers();
    replies.push({ hang: true });
    const check = expect(fetchSourceText(shortUrl)).rejects.toMatchObject({
      kind: "timeout",
      retryable: true,
    });
    await vi.advanceTimersByTimeAsync(8001);
    await check;
  });
});
