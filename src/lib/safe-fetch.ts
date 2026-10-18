import { lookup } from "node:dns/promises";
import { request } from "node:https";
import ipaddr from "ipaddr.js";
import { allowedSourceHost, sourceUrl } from "./domain";

export function publicAddress(address: string) {
  if (!ipaddr.isValid(address)) return false;
  const ip = ipaddr.parse(address);
  return ip.range() === "unicast";
}
export async function fetchSourceText(input: string): Promise<string> {
  let url = new URL(sourceUrl(input).original);
  const deadline = Date.now() + 12000;
  for (let redirects = 0; redirects <= 3; redirects++) {
    if (
      url.protocol !== "https:" ||
      url.port ||
      url.username ||
      url.password ||
      !allowedSourceHost(url.hostname)
    )
      throw new Error("來源重新導向到不支援的網址，請貼上文字或截圖");
    let dnsTimer: ReturnType<typeof setTimeout> | undefined;
    const addresses = await Promise.race([
      lookup(url.hostname, { all: true }),
      new Promise<never>((_, reject) => {
        dnsTimer = setTimeout(() => reject(new Error("來源 DNS 逾時")), 4000);
      }),
    ]).finally(() => clearTimeout(dnsTimer));
    if (!addresses.length || addresses.some((a) => !publicAddress(a.address)))
      throw new Error("此來源無法安全讀取，請改用文字或截圖");
    const time = deadline - Date.now();
    if (time <= 0) throw new Error("來源讀取逾時");
    // Pin the validated IP while preserving TLS SNI and Host. Every redirect is rechecked.
    const result = await new Promise<{ status: number; location?: string; body: string }>(
      (resolve, reject) => {
        const r = request(
          {
            hostname: addresses[0].address,
            servername: url.hostname,
            port: 443,
            path: url.pathname + url.search,
            method: "GET",
            headers: {
              Host: url.hostname,
              "User-Agent": "StoneTravelingTool/0.1 (personal saved-link reader)",
              Accept: "text/html,text/plain",
              "Accept-Encoding": "identity",
            },
            timeout: Math.min(time, 8000),
          },
          (res) => {
            const status = res.statusCode ?? 0;
            if (status >= 300 && status < 400) {
              res.resume();
              resolve({ status, location: res.headers.location, body: "" });
              return;
            }
            if (!/text\/(html|plain)/i.test(res.headers["content-type"] ?? "")) {
              res.resume();
              reject(new Error("來源不是可讀取的文字頁面"));
              return;
            }
            const chunks: Buffer[] = [];
            let size = 0;
            res.on("data", (chunk) => {
              size += chunk.length;
              if (size > 1024 * 1024) {
                r.destroy(new Error("來源頁面過大，請貼上文字或截圖"));
                return;
              }
              chunks.push(chunk);
            });
            res.on("end", () => resolve({ status, body: Buffer.concat(chunks).toString("utf8") }));
            res.on("error", reject);
          },
        );
        const requestTimer = setTimeout(() => r.destroy(new Error("來源讀取逾時")), time);
        r.on("close", () => clearTimeout(requestTimer));
        r.on("timeout", () => r.destroy(new Error("來源讀取逾時")));
        r.on("error", reject);
        r.end();
      },
    );
    if (result.status >= 300 && result.status < 400 && result.location) {
      url = new URL(result.location, url);
      continue;
    }
    if (result.status !== 200) throw new Error("網站限制讀取，請補上文章文字或截圖");
    return htmlText(result.body).slice(0, 20000);
  }
  throw new Error("來源重新導向過多，請補上文字或截圖");
}
export function htmlText(html: string) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}
