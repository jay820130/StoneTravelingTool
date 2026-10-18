import type { AuthError } from "@supabase/supabase-js";

// Return only fixed public messages: provider responses may contain private data.
export function loginFailure(error: AuthError): { status: number; message: string } {
  const legacyMessage = error.message.trim().toLowerCase();
  if (
    error.code === "invalid_credentials" ||
    error.code === "user_not_found" ||
    legacyMessage === "invalid login credentials"
  )
    return { status: 401, message: "登入失敗，請確認電子郵件與密碼" };
  if (error.code === "email_not_confirmed" || legacyMessage === "email not confirmed")
    return { status: 403, message: "電子郵件尚未完成驗證，請聯絡網站管理者確認帳號" };
  if (error.code === "email_provider_disabled")
    return { status: 503, message: "網站尚未啟用電子郵件登入，請聯絡網站管理者" };
  if (error.code === "user_banned")
    return { status: 403, message: "此帳號目前無法登入，請聯絡網站管理者" };
  if (error.status === 429 || error.code === "over_request_rate_limit")
    return { status: 429, message: "登入嘗試過於頻繁，請稍後再試" };
  if (error.status === 401 || error.status === 403 || error.code === "bad_jwt")
    return { status: 503, message: "登入服務拒絕連線，請聯絡網站管理者檢查設定" };
  if (error.name === "AuthRetryableFetchError" || error.status === 0 || (error.status ?? 0) >= 500)
    return { status: 503, message: "登入服務暫時無法連線，請稍後再試" };
  return { status: 503, message: "登入服務未能完成驗證，請稍後再試或聯絡網站管理者" };
}
