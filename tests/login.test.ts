import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthApiError, AuthRetryableFetchError } from "@supabase/supabase-js";
import { NextRequest } from "next/server";

const db = vi.hoisted(() => ({
  auth: { signInWithPassword: vi.fn(), signOut: vi.fn() },
  from: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  configured: () => true,
  serverClient: async () => db,
}));
import { POST } from "../src/app/api/[...path]/route";

const owner = "11111111-1111-4111-8111-111111111111";
const member = vi.fn();
const query = { select: vi.fn(), eq: vi.fn(), maybeSingle: member };

async function login() {
  const response = await POST(
    new NextRequest("https://stone.example/api/login", {
      method: "POST",
      headers: {
        origin: "https://stone.example",
        host: "stone.example",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: "login-regression@example.test",
        password: "fixture-only-no-real-account",
      }),
    }),
    { params: Promise.resolve({ path: ["login"] }) },
  );
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  return { status: response.status, body: await response.json() };
}

beforeEach(() => {
  vi.resetAllMocks();
  db.auth.signInWithPassword.mockResolvedValue({ data: { user: { id: owner } }, error: null });
  db.auth.signOut.mockResolvedValue({ error: null });
  db.from.mockReturnValue(query);
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  member.mockResolvedValue({ data: { owner_id: owner }, error: null });
});

describe("login responses distinguish account and service failures without leaking provider data", () => {
  it.each([
    [
      new AuthApiError("Invalid login credentials", 400, "invalid_credentials"),
      401,
      "登入失敗，請確認電子郵件與密碼",
    ],
    [
      new AuthApiError("Invalid login credentials", 400, undefined),
      401,
      "登入失敗，請確認電子郵件與密碼",
    ],
    [
      new AuthApiError("Unknown user", 400, "user_not_found"),
      401,
      "登入失敗，請確認電子郵件與密碼",
    ],
    [
      new AuthApiError("Email not confirmed", 400, "email_not_confirmed"),
      403,
      "電子郵件尚未完成驗證，請聯絡網站管理者確認帳號",
    ],
    [
      new AuthApiError("Email logins are disabled", 400, "email_provider_disabled"),
      503,
      "網站尚未啟用電子郵件登入，請聯絡網站管理者",
    ],
    [
      new AuthApiError("Invalid API key", 401, undefined),
      503,
      "登入服務拒絕連線，請聯絡網站管理者檢查設定",
    ],
    [new AuthApiError("Too many requests", 429, undefined), 429, "登入嘗試過於頻繁，請稍後再試"],
    [
      new AuthRetryableFetchError("PRIVATE_UPSTREAM_PAYLOAD", 0),
      503,
      "登入服務暫時無法連線，請稍後再試",
    ],
    [
      new AuthApiError("PRIVATE_UPSTREAM_PAYLOAD", 400, undefined),
      503,
      "登入服務未能完成驗證，請稍後再試或聯絡網站管理者",
    ],
  ])("returns a safe response for %s", async (error, status, message) => {
    db.auth.signInWithPassword.mockResolvedValue({ data: { user: null }, error });
    expect(await login()).toEqual({ status, body: { error: message } });
    expect(db.from).not.toHaveBeenCalled();
  });

  it("does not mislabel a failed membership query as an uninvited account", async () => {
    member.mockResolvedValue({ data: null, error: { message: "PRIVATE_DATABASE_PAYLOAD" } });
    expect(await login()).toEqual({
      status: 503,
      body: { error: "登入後無法確認使用權限，請稍後再試或聯絡網站管理者" },
    });
    expect(db.auth.signOut).toHaveBeenCalledOnce();
  });

  it("still rejects and signs out an account without membership", async () => {
    member.mockResolvedValue({ data: null, error: null });
    expect(await login()).toEqual({ status: 403, body: { error: "此帳號尚未受邀使用" } });
    expect(db.auth.signOut).toHaveBeenCalledOnce();
  });

  it("allows an authenticated member", async () => {
    expect(await login()).toEqual({ status: 200, body: { ok: true } });
    expect(query.eq).toHaveBeenCalledWith("owner_id", owner);
    expect(db.auth.signOut).not.toHaveBeenCalled();
  });
});
