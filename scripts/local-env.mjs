import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
const config = JSON.parse(
  execFileSync(".local/bin/supabase", ["status", "--output", "json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }),
);
const url = config.API_URL;
if (!url || !["localhost", "127.0.0.1"].includes(new URL(url).hostname))
  throw new Error("This script configures a local Supabase instance only.");
if (existsSync(".env.local")) {
  const existing = readFileSync(".env.local", "utf8");
  if (!existing.includes("# Generated local development settings for StoneTravelingTool"))
    throw new Error(
      ".env.local already exists; preserving it. Configure local values manually or move it safely first.",
    );
  // Retain optional AI settings and other user additions; replace only local backend bindings.
  const values = {
    NEXT_PUBLIC_SUPABASE_URL: url,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: config.ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: config.SERVICE_ROLE_KEY,
  };
  let text = existing;
  for (const [name, value] of Object.entries(values))
    text = text.replace(new RegExp(`^${name}=.*$`, "m"), `${name}=${JSON.stringify(value)}`);
  writeFileSync(".env.local", text, { mode: 0o600 });
} else {
  const values = {
    NEXT_PUBLIC_SUPABASE_URL: url,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: config.ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: config.SERVICE_ROLE_KEY,
    CRON_SECRET: randomBytes(32).toString("hex"),
  };
  writeFileSync(
    ".env.local",
    "# Generated local development settings for StoneTravelingTool\n" +
      Object.entries(values)
        .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
        .join("\n") +
      "\n",
    { mode: 0o600, flag: "wx" },
  );
}
console.log("Local Supabase settings saved in ignored .env.local. No credential values printed.");
