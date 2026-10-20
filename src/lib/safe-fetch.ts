import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { StringDecoder } from "node:string_decoder";
import ipaddr from "ipaddr.js";
import { isMapsSourceHost, sourceUrl } from "./domain";
import { SourcePage } from "./source-page";
export { htmlText } from "./source-page";

type Failure = "dns" | "timeout" | "network" | "redirect" | "address" | "type" | "size" | "http";
const failureMessages: Record<Failure, string> = {
  dns: "暫時無法查詢來源網站位址，系統會有限次重試。",
  timeout: "來源網站讀取逾時，系統會有限次重試。",
  network: "暫時無法連線到來源網站，系統會有限次重試。",
  redirect: "來源連結跳轉到不支援的位置，或跳轉次數過多。",
  address: "來源網站位址未通過安全檢查。",
  type: "來源回傳的不是可讀取的網頁或文字。",
  size: "來源頁面過大，且尚未取得可辨識的分享預覽。",
  http: "來源網站未允許讀取這個頁面。",
};
export class SourceFetchError extends Error {
  constructor(
    readonly kind: Failure,
    readonly retryable = false,
    readonly status?: number,
  ) {
    super(`${failureMessages[kind]}${status ? `（HTTP ${status}）` : ""}原始收藏仍已保留。`);
    this.name = "SourceFetchError";
  }
}

export function publicAddress(address: string) {
  if (!ipaddr.isValid(address)) return false;
  return ipaddr.parse(address).range() === "unicast";
}

export async function fetchSourceText(input: string): Promise<string> {
  let url = new URL(sourceUrl(input).original);
  const deadline = Date.now() + 12000;
  for (let redirects = 0; redirects <= 5; redirects++) {
    // Recheck scheme, credentials, port, hostname AND path after every redirect.
    try {
      sourceUrl(url.toString());
    } catch {
      throw new SourceFetchError("redirect");
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new SourceFetchError("timeout", true);
    let dnsTimer: ReturnType<typeof setTimeout> | undefined;
    const addresses = await Promise.race([
      lookup(url.hostname, { all: true }),
      new Promise<never>((_, reject) => {
        dnsTimer = setTimeout(
          () => reject(new SourceFetchError("timeout", true)),
          Math.min(remaining, 4000),
        );
      }),
    ])
      .catch((error) => {
        throw error instanceof SourceFetchError ? error : new SourceFetchError("dns", true);
      })
      .finally(() => clearTimeout(dnsTimer));
    if (!addresses.length || addresses.some((a) => !publicAddress(a.address)))
      throw new SourceFetchError("address");
    // Prefer IPv4: many server runtimes have IPv4 egress without IPv6 egress.
    const address = addresses.find((a) => a.family === 4) ?? addresses[0];
    const time = deadline - Date.now();
    if (time <= 0) throw new SourceFetchError("timeout", true);
    const maps = isMapsSourceHost(url.hostname);
    const result = await new Promise<{ status: number; location?: string; text: string }>(
      (resolve, reject) => {
        let settled = false;
        const finish = (
          value?: { status: number; location?: string; text: string },
          error?: SourceFetchError,
        ) => {
          if (settled) return;
          settled = true;
          clearTimeout(requestTimer);
          if (error) reject(error);
          else resolve(value!);
          r.destroy();
        };
        // Pin the checked IP; retain hostname for TLS verification/SNI and HTTP Host.
        const r = request(
          {
            hostname: address.address,
            servername: url.hostname,
            port: 443,
            path: url.pathname + url.search,
            method: "GET",
            headers: {
              Host: url.hostname,
              "User-Agent": "StoneTravelingTool/0.1 (personal saved-link reader)",
              Accept: "text/html,text/plain",
              "Accept-Encoding": "identity",
              "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
            },
          },
          (res) => {
            const status = res.statusCode ?? 0;
            if ([301, 302, 303, 307, 308].includes(status) && res.headers.location) {
              finish({ status, location: res.headers.location, text: "" });
              return;
            }
            if (status !== 200) {
              finish(
                undefined,
                new SourceFetchError("http", status === 429 || status >= 500, status),
              );
              return;
            }
            const type = res.headers["content-type"] ?? "";
            if (!/^text\/(html|plain)\b/i.test(type)) {
              finish(undefined, new SourceFetchError("type"));
              return;
            }
            const isHtml = /^text\/html\b/i.test(type);
            const page = new SourcePage();
            const decoder = new StringDecoder("utf8");
            let plain = "";
            let size = 0;
            res.on("data", (chunk: Buffer) => {
              if (settled) return;
              size += chunk.length;
              if (size > 1024 * 1024) {
                finish(undefined, new SourceFetchError("size"));
                return;
              }
              const text = decoder.write(chunk);
              if (isHtml) page.write(text);
              else plain = (plain + text).slice(0, 20000);
              // Read the complete Maps preview, not the subsequent large JS application.
              if (maps && isHtml && page.headComplete && page.hasPlacePreview)
                finish({ status, text: page.text });
            });
            res.on("end", () => {
              if (settled) return;
              if (isHtml) page.end(decoder.end());
              else plain = (plain + decoder.end()).slice(0, 20000);
              finish({ status, text: isHtml ? page.text : plain.trim() });
            });
            res.on("error", () => finish(undefined, new SourceFetchError("network", true)));
            res.on("aborted", () => finish(undefined, new SourceFetchError("network", true)));
          },
        );
        const requestTimer = setTimeout(
          () => finish(undefined, new SourceFetchError("timeout", true)),
          Math.min(time, 8000),
        );
        r.on("error", () => finish(undefined, new SourceFetchError("network", true)));
        r.end();
      },
    );
    if (result.location) {
      try {
        url = new URL(result.location, url);
      } catch {
        throw new SourceFetchError("redirect");
      }
      continue;
    }
    return result.text;
  }
  throw new SourceFetchError("redirect");
}
