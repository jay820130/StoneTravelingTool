import { loadEnvFile } from "node:process";
import { createClient } from "@supabase/supabase-js";
loadEnvFile(".env.local");
if (!["localhost", "127.0.0.1"].includes(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname))
  throw new Error("This script only creates local accounts.");
let input = "";
for await (const chunk of process.stdin) input += chunk;
const { email, password } = JSON.parse(input);
const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);
const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
if (error) {
  console.error(
    "Account creation failed. Check the email and password, or whether the account already exists.",
  );
  process.exitCode = 1;
} else {
  const profile = await db.from("profiles").insert({ owner_id: data.user.id });
  if (profile.error) {
    console.error("Account created but membership failed; apply database migrations.");
    process.exitCode = 1;
  } else
    console.log(
      "Local owner created. You can now sign in with the email and password you entered.",
    );
}
