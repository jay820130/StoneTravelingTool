import { loadEnvFile } from "node:process";
import { mkdirSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
loadEnvFile(".env.local");
if (!["localhost", "127.0.0.1"].includes(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname))
  throw new Error("Test accounts may only be created on local Supabase.");
const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);
const { data: existing, error: listError } = await db.auth.admin.listUsers();
if (listError) throw new Error("Cannot list local test users");
const users = [];
for (const suffix of ["a", "b"]) {
  const email = `stone-e2e-${suffix}@example.test`;
  const previous = existing.users.find((u) => u.email === email);
  if (previous) {
    const { error } = await db.auth.admin.deleteUser(previous.id);
    if (error) throw new Error("Cannot remove previous disposable test account");
  }
  const password = randomBytes(24).toString("base64url");
  const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error("Cannot create disposable test account");
  const profile = await db
    .from("profiles")
    .insert({ owner_id: data.user.id, display_name: "自動化測試帳號" });
  if (profile.error) throw new Error("Cannot allow test account");
  users.push({ email, password, id: data.user.id });
}
mkdirSync(".local", { recursive: true });
writeFileSync(".local/test-users.json", JSON.stringify(users), { mode: 0o600 });
console.log(
  "Two isolated local test users created. Credentials are in ignored test state, never in logs.",
);
