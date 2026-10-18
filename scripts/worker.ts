import { processOneJob } from "../src/lib/worker";
let stopping = false;
process.on("SIGTERM", () => {
  stopping = true;
});
process.on("SIGINT", () => {
  stopping = true;
});
async function main() {
  console.log("Parser worker started; source content and credentials are never logged.");
  while (!stopping) {
    try {
      const r = await processOneJob();
      if (r.processed) console.log("Import job completed:", r.status);
    } catch {
      console.error("Worker unavailable; retrying in five seconds.");
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}
void main();
