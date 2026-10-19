import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lookup } from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import { request } from "node:https";
import { fetchSourceText, htmlText } from "../src/lib/safe-fetch";
import { extractPlaces } from "../src/lib/parser";

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
  '<html><head><meta content="測試咖啡 &amp; Tea · 日本大阪市測試路1號" itemprop="name">' +
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

describe("public sharing previews", () => {
  it("retains title/address metadata with quoted delimiters and decoded entities", () => {
    const text = htmlText(
      '<head><meta content="Test &gt; Coffee &#x2615;" property="og:title">' +
        '<meta name="description" content="Fictional address &quot;1&quot;"></head>' +
        "<script>DO NOT SEND THIS SCRIPT</script><style>SECRET CSS</style><p>Body</p>",
    );
    expect(text).toContain("Test > Coffee ☕");
    expect(text).toContain('Fictional address "1"');
    expect(text).toContain("Body");
    expect(text).not.toContain("SCRIPT");
    expect(text).not.toContain("SECRET");
  });
  it("ignores metadata embedded in templates and scripts", () => {
    expect(
      htmlText(
        '<template><meta name="description" content="not public"></template>' +
          '<script>"<meta name=description content=bad>"</script><p>Visible</p>',
      ),
    ).toBe("Visible");
  });
  it("bounds extracted text before sending it to AI", () => {
    expect(
      htmlText(
        '<meta property="og:description" content="' +
          "a".repeat(30000) +
          '"><p>' +
          "b".repeat(30000),
      ),
    ).toHaveLength(20000);
  });
});

describe("redirects, streaming and source-to-AI integration", () => {
  it("reads a short link's Maps preview before a large JS app, then sends the facts to AI", async () => {
    replies.push(
      { status: 302, location: "https://www.google.com/maps/place/Fictional+Test+Cafe" },
      { chunks: [Buffer.from(preview), Buffer.alloc(2 * 1024 * 1024, "x")] },
    );
    const text = await fetchSourceText(shortUrl);
    expect(text).toContain("測試咖啡 & Tea · 日本大阪市測試路1號");
    expect(text).toContain("咖啡廳");
    expect(text).not.toContain("xxxx");
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenLastCalledWith(
      expect.objectContaining({
        hostname: "8.8.8.8",
        servername: "www.google.com",
        headers: expect.objectContaining({ Host: "www.google.com" }),
      }),
      expect.any(Function),
    );
    vi.stubEnv("AI_API_KEY", "test-placeholder-only");
    const ai = vi.fn().mockResolvedValue(
      Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                summary: "Fictional fixture",
                candidates: [
                  {
                    name: "測試咖啡 & Tea",
                    country: "日本",
                    city: "大阪",
                    address: "日本大阪市測試路1號",
                    categories: ["咖啡廳"],
                    dishes: [],
                    summary: "Fixture only",
                  },
                ],
              }),
            },
          },
        ],
      }),
    );
    const result = await extractPlaces(text, [], ai);
    expect(result.status).toBe("parsed");
    expect(result.candidates[0].address).toBe("日本大阪市測試路1號");
    const body = JSON.parse(ai.mock.calls[0][1].body);
    expect(body.messages[1].content[0].text).toContain("測試路1號");
  });
  it("decodes a Chinese preview split across UTF-8 byte boundaries", async () => {
    const raw = Buffer.from(preview);
    replies.push({ chunks: Array.from(raw, (byte) => Buffer.from([byte])) });
    expect(await fetchSourceText(shortUrl)).toContain("測試咖啡 & Tea");
  });
  it("does not mistake a generic Maps title for a place preview", async () => {
    replies.push({
      chunks: [
        Buffer.from('<head><meta itemprop="name" content="Google Maps"></head>'),
        Buffer.from("<p>Actual page body</p>"),
      ],
    });
    expect(await fetchSourceText(shortUrl)).toContain("Actual page body");
  });
  it("preserves plain text that contains angle brackets", async () => {
    replies.push({ type: "text/plain", chunks: [Buffer.from("Fictional <Cafe> address")] });
    expect(await fetchSourceText(shortUrl)).toBe("Fictional <Cafe> address");
  });
  it("does not split place names when article text arrives in separate chunks", async () => {
    replies.push({ chunks: [Buffer.from("<p>Test Cof"), Buffer.from("fee</p><p>Address</p>")] });
    expect(await fetchSourceText(shortUrl)).toBe("Test Coffee Address");
  });
  it("rejects non-text downloads", async () => {
    replies.push({ type: "application/octet-stream", chunks: [Buffer.from("binary")] });
    await expect(fetchSourceText(shortUrl)).rejects.toMatchObject({
      kind: "type",
      retryable: false,
    });
  });
  it("continues reading social article bodies after their preview", async () => {
    replies.push({
      chunks: [Buffer.from(preview), Buffer.from("<p>Second fictional store in this article</p>")],
    });
    expect(await fetchSourceText("https://www.instagram.com/p/fixture")).toContain(
      "Second fictional store",
    );
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
