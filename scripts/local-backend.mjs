import { spawn, spawnSync } from "node:child_process";
const command = process.argv[2] ?? "start";
if (!["start", "stop", "status", "reset"].includes(command))
  throw new Error("Unknown local backend command");
if (command === "reset" && !process.argv.includes("--confirm-local-data-loss"))
  throw new Error(
    "Reset deletes local data. Add --confirm-local-data-loss only for a disposable local database.",
  );
const args =
  command === "reset"
    ? ["db", "reset", "--local"]
    : command === "start"
      ? [
          "start",
          "--exclude",
          "studio,realtime,imgproxy,edge-runtime,logflare,vector,supavisor,mailpit,postgres-meta",
          "--output",
          "json",
        ]
      : [command, "--output", "json"];
console.log(
  `Supabase ${command}: ${command === "start" ? "first run may download Docker images" : "working"}…`,
);
if (command === "start") {
  const prepared = spawnSync("python3", ["scripts/prepare-local-db.py"], { stdio: "inherit" });
  if (prepared.status !== 0) process.exit(prepared.status ?? 1);
}
const child = spawn(".local/bin/supabase", args, {
  env: {
    ...process.env,
    SUPABASE_INTERNAL_IMAGE_REGISTRY: process.env.SUPABASE_INTERNAL_IMAGE_REGISTRY || "docker.io",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let stderr = "";
child.stdout.on("data", () => {}); // CLI status contains local credentials. Never log it.
child.stderr.on("data", (chunk) => {
  stderr = (stderr + chunk.toString()).slice(-12000);
});
child.on("error", () => {
  console.error("CLI missing; run npm run tools:setup first.");
  process.exitCode = 1;
});
child.on("close", (code) => {
  if (code) {
    for (const line of stderr.split("\n").slice(-25)) {
      if (!/key|token|secret|password|postgresql|eyJ/i.test(line)) console.error(line);
    }
    process.exitCode = code;
  } else
    console.log(
      `Supabase ${command} completed. Credentials suppressed; use npm run local:env to configure this checkout.`,
    );
});
