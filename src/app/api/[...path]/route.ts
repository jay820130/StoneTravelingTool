import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createHash } from "node:crypto";
import { configured, serverClient } from "@/lib/supabase/server";
import { loginFailure } from "@/lib/supabase/login-error";
import { loadLibrary } from "@/lib/library";
import { normalizeRegion, placeSchema, sourceUrl, visitSchema } from "@/lib/domain";
import { exportLibrary, exportSchema } from "@/lib/export";

import { IMAGE_MIMES, MAX_IMAGE_BYTES, imageMime } from "@/lib/images";
import { geocode, GeocodingError } from "@/lib/geocoding";

export const maxDuration = 30;
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
function check(error: { message: string; code?: string } | null) {
  if (error) throw new ApiError(400, "儲存失敗，請檢查資料內容或重新登入後再試");
}
function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store" } });
}

async function boundedBody(req: Request, limit: number): Promise<Uint8Array<ArrayBuffer>> {
  const reader = req.body?.getReader();
  if (!reader) throw new ApiError(400, "缺少表單內容");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new ApiError(413, "檔案或內容過大");
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.length;
  }
  return body;
}
async function readJson(req: Request) {
  const bytes = await boundedBody(req, 1024 * 1024);
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new ApiError(400, "資料格式錯誤");
  }
}

async function handle(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  try {
    const { path } = await params;
    const route = path.join("/");
    if (req.method !== "GET") {
      const origin = req.headers.get("origin");
      if (!origin || new URL(origin).host !== req.headers.get("host"))
        throw new ApiError(403, "請從本站提交表單");
      const length = Number(req.headers.get("content-length") ?? 0);
      if (length > 6 * 1024 * 1024) throw new ApiError(413, "檔案或內容過大");
    }
    if (route === "session" && req.method === "GET" && !configured())
      return json({ configured: false, user: null });
    if (!configured()) throw new ApiError(503, "尚未設定 Supabase，請參考 README 的本機啟動步驟");
    const db = await serverClient();
    if (route === "login" && req.method === "POST") {
      const input = z
        .object({ email: z.email().max(320), password: z.string().min(1).max(200) })
        .parse(await readJson(req));
      const { data, error } = await db.auth.signInWithPassword(input);
      if (error) {
        const failure = loginFailure(error);
        throw new ApiError(failure.status, failure.message);
      }
      const member = await db
        .from("profiles")
        .select("owner_id")
        .eq("owner_id", data.user.id)
        .maybeSingle();
      if (member.error || !member.data) {
        await db.auth.signOut();
        if (member.error)
          throw new ApiError(503, "登入後無法確認使用權限，請稍後再試或聯絡網站管理者");
        throw new ApiError(403, "此帳號尚未受邀使用");
      }
      return json({ ok: true });
    }
    const {
      data: { user },
    } = await db.auth.getUser();
    if (route === "session" && req.method === "GET")
      return json({ configured: true, user: user ? { email: user.email, id: user.id } : null });
    if (!user) throw new ApiError(401, "請先登入");
    const member = await db
      .from("profiles")
      .select("owner_id")
      .eq("owner_id", user.id)
      .maybeSingle();
    if (!member.data) throw new ApiError(403, "此帳號尚未受邀使用");
    if (route === "logout" && req.method === "POST") {
      await db.auth.signOut();
      return json({ ok: true });
    }
    if (route === "library" && req.method === "GET") return json(await loadLibrary(db));
    if (route === "export" && req.method === "POST") {
      const input = exportSchema.parse(await readJson(req));
      const output = await exportLibrary(await loadLibrary(db), input);
      return new NextResponse(new Uint8Array(output.bytes), {
        headers: {
          "Content-Type": output.type,
          "Content-Disposition": `attachment; filename="stone-places.${input.format}"`,
          "Cache-Control": "private, no-store",
        },
      });
    }
    if (path[0] === "attachments" && path[1] && req.method === "GET") {
      const { data, error } = await db
        .from("attachments")
        .select("path")
        .eq("id", z.uuid().parse(path[1]))
        .single();
      check(error);
      if (!data) throw new ApiError(404, "找不到附件");
      const signed = await db.storage.from("screenshots").createSignedUrl(data.path, 60);
      check(signed.error);
      return new NextResponse(null, {
        status: 303,
        headers: {
          Location: signed.data!.signedUrl,
          "Cache-Control": "private, no-store",
          "Referrer-Policy": "no-referrer",
        },
      });
    }
    if (req.method === "POST") {
      const quota = await db.rpc("consume_quota");
      check(quota.error);
      if (!quota.data) throw new ApiError(429, "本小時操作次數已達上限，請稍後再試");
      if (route === "attachments")
        throw new ApiError(400, "請重新整理頁面，使用新的圖片上傳流程。");
      const body = await readJson(req);
      if (route === "attachments/prepare") {
        const input = z
          .object({
            source_id: z.uuid(),
            mime: z.enum(IMAGE_MIMES),
            size: z.number().int().min(1).max(MAX_IMAGE_BYTES),
            attachment_id: z.uuid().optional(),
          })
          .parse(body);
        const reservation = input.attachment_id
          ? await db
              .from("attachments")
              .select("*")
              .eq("id", input.attachment_id)
              .eq("source_id", input.source_id)
              .single()
          : await db.rpc("reserve_attachment", {
              source: input.source_id,
              mime: input.mime,
              bytes: input.size,
            });
        check(reservation.error);
        const row = reservation.data;
        if (!row || row.mime_type !== input.mime || row.size_bytes !== input.size)
          throw new ApiError(400, "附件資料不符");
        const signed = await db.storage
          .from("screenshots")
          .createSignedUploadUrl(row.path, { upsert: false });
        check(signed.error);
        return json({ id: row.id, url: signed.data!.signedUrl });
      }
      if (route === "attachments/complete") {
        const { id } = z.object({ id: z.uuid() }).parse(body);
        const row = await db.from("attachments").select("*").eq("id", id).single();
        check(row.error);
        if (row.data.state === "ready") return json({ ok: true, id });
        const downloaded = await db.storage
          .from("screenshots")
          .download(row.data.path, {}, { signal: AbortSignal.timeout(12000) });
        check(downloaded.error);
        if (!downloaded.data) throw new ApiError(400, "圖片尚未上傳完成，請重試");
        const bytes = Buffer.from(await downloaded.data.arrayBuffer());
        if (
          bytes.length !== row.data.size_bytes ||
          bytes.length > MAX_IMAGE_BYTES ||
          imageMime(bytes) !== row.data.mime_type
        )
          throw new ApiError(400, "圖片格式或大小不符，請刪除此附件後重新選圖");
        check(
          (
            await db
              .from("attachments")
              .update({ state: "ready", sha256: createHash("sha256").update(bytes).digest("hex") })
              .eq("id", id)
          ).error,
        );
        return json({ ok: true, id });
      }
      if (route === "geocode") {
        const { query } = z.object({ query: z.string().trim().min(2).max(300) }).parse(body);
        return json({ candidates: await geocode(user.id, query) });
      }
      if (route === "candidates") {
        const input = z
          .object({
            source_id: z.uuid(),
            indices: z.array(z.number().int().min(0).max(29)).min(1).max(30),
          })
          .parse(body);
        check((await db.rpc("accept_candidates", input)).error);
        return json({ ok: true });
      }
      if (route === "places") {
        const input = placeSchema.parse(body);
        input.country = normalizeRegion(input.country, "country");
        input.city = normalizeRegion(input.city, "city");
        const id = body.id ? z.uuid().parse(body.id) : undefined;
        const row = id
          ? await db.from("places").update(input).eq("id", id).select().single()
          : await db
              .from("places")
              .insert({ ...input, owner_id: user.id })
              .select()
              .single();
        check(row.error);
        if (input.tags.length)
          check(
            (
              await db.from("labels").upsert(
                input.tags.map((name) => ({ owner_id: user.id, name })),
                { onConflict: "owner_id,name", ignoreDuplicates: true },
              )
            ).error,
          );
        return json({ place: row.data });
      }
      if (route === "sources") {
        let url: ReturnType<typeof sourceUrl>;
        try {
          url = sourceUrl(body.url);
        } catch {
          throw new ApiError(400, "請貼上有效的 Instagram、Threads 或 Google Maps HTTPS 連結");
        }
        const reason = z
          .string()
          .max(10000)
          .parse(body.reason ?? "");
        const { data, error } = await db
          .from("sources")
          .insert({
            owner_id: user.id,
            original_url: url.original,
            canonical_url: url.canonical,
            reason,
            content_text: z
              .string()
              .max(30000)
              .parse(body.content_text ?? ""),
            intake_pending: z.boolean().parse(body.defer_parse ?? false),
            status: body.defer_parse ? "needs_input" : "pending",
          })
          .select()
          .single();
        if (error?.code === "23505") {
          const existing = await db
            .from("sources")
            .select()
            .eq("canonical_url", url.canonical)
            .single();
          check(existing.error);
          return json({ source: existing.data, duplicate: true });
        }
        check(error);
        return json({ source: data, duplicate: false }, 201);
      }
      if (route === "sources/retry" || route === "sources/intake") {
        const input = z
          .object({
            id: z.uuid(),
            content_text: z.string().max(30000),
            reason: z.string().max(10000),
          })
          .parse(body);
        check(
          (
            await db.rpc(route === "sources/intake" ? "save_source_draft" : "requeue_source", {
              source: input.id,
              content: input.content_text,
              why: input.reason,
            })
          ).error,
        );
        return json({ ok: true });
      }
      if (route === "links") {
        const input = z.object({ place_id: z.uuid(), source_id: z.uuid() }).parse(body);
        check(
          (
            await db
              .from("place_sources")
              .upsert(
                { ...input, owner_id: user.id },
                { onConflict: "owner_id,place_id,source_id", ignoreDuplicates: true },
              )
          ).error,
        );
        return json({ ok: true });
      }
      if (route === "links/remove") {
        const input = z.object({ place_id: z.uuid(), source_id: z.uuid() }).parse(body);
        check(
          (
            await db
              .from("place_sources")
              .delete()
              .eq("place_id", input.place_id)
              .eq("source_id", input.source_id)
          ).error,
        );
        return json({ ok: true });
      }
      if (route === "visits") {
        const input = visitSchema.parse(body);
        const saved = await db.rpc("save_visit", { payload: input });
        check(saved.error);
        return json({ id: saved.data });
      }
      if (route === "labels") {
        const input = z
          .object({ old_name: z.string().max(200), new_name: z.string().trim().max(200) })
          .parse(body);
        check((await db.rpc("rename_label", input)).error);
        return json({ ok: true });
      }
      if (route === "places/merge") {
        const input = z.object({ from_id: z.uuid(), into_id: z.uuid() }).parse(body);
        check((await db.rpc("merge_places", input)).error);
        return json({ ok: true });
      }
      if (route === "delete") {
        const { table, id } = z
          .object({ table: z.enum(["places", "visits", "sources", "attachments"]), id: z.uuid() })
          .parse(body);
        if (table === "sources" || table === "attachments") {
          const files = await db
            .from("attachments")
            .select("path,source_id")
            .eq(table === "sources" ? "source_id" : "id", id);
          check(files.error);
          if (table === "attachments" && files.data?.[0])
            check((await db.rpc("begin_source_intake", { source: files.data[0].source_id })).error);
          if (files.data?.length)
            check(
              (await db.storage.from("screenshots").remove(files.data.map((f) => f.path))).error,
            );
        }
        check((await db.from(table).delete().eq("id", id)).error);
        return json({ ok: true });
      }
    }
    throw new ApiError(404, "找不到此操作");
  } catch (error) {
    if (error instanceof z.ZodError)
      return json({ error: error.issues[0]?.message ?? "資料格式錯誤" }, 400);
    if (error instanceof GeocodingError) return json({ error: error.message }, error.status);
    if (error instanceof ApiError) return json({ error: error.message }, error.status);
    // Never echo service responses, credentials or private content into logs.
    return json({ error: "操作未完成，請確認設定與網路後重試" }, 500);
  }
}
export const GET = handle;
export const POST = handle;
