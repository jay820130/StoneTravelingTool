import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
export function configured() {
  return !!(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  );
}
export async function serverClient() {
  if (!configured()) throw new Error("請先設定 Supabase 連線");
  const jar = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => jar.getAll(),
        setAll: (items) => {
          for (const { name, value, options } of items)
            jar.set(name, value, { ...options, sameSite: "lax" });
        },
      },
    },
  );
}
