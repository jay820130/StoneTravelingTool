import { createHash } from "node:crypto";
import { adminClient } from "./supabase/admin";
import { fetchSourcePage, SourceFetchError } from "./safe-fetch";
import { extractPlaces, aiSettings, AIError, type ParseResult } from "./parser";
import { isMapsHost } from "./domain";
import { mapsResult, parseMapsUrl } from "./maps-parser";
import {
  imageMime,
  meaningfulText,
  MAX_IMAGE_BYTES,
  MAX_IMAGES,
  MAX_SOURCE_IMAGE_BYTES,
} from "./images";
import type { Candidate } from "./types";
export function contentHash(text: string, images: { mime: string; data: string }[]) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        version: "content-v2",
        ...aiSettings(),
        text: text.slice(0, 20000).trim(),
        images: images.map((i) => ({
          mime: i.mime,
          hash: createHash("sha256").update(Buffer.from(i.data, "base64")).digest("hex"),
        })),
      }),
    )
    .digest("hex");
}
export async function processOneJob(): Promise<{ processed: boolean; status?: string }> {
  const db = adminClient();
  const { data: job, error } = await db.rpc("claim_import_job");
  if (error) throw new Error("無法取得解析工作");
  if (!job?.id) return { processed: false };
  let result: ParseResult;
  let retry = false;
  let hash = "",
    cacheToken = "",
    owner = "";
  const diagnostics: Record<string, unknown> = { strategy: "content-v2" };
  let maps = false;
  let previousCandidates: Candidate[] = [];
  try {
    const { data: source, error } = await db
      .from("sources")
      .select("*")
      .eq("id", job.source_id)
      .single();
    if (error || !source) throw new Error("找不到來源");
    if (source.revision !== job.revision || source.intake_pending)
      return { processed: true, status: "superseded" };
    owner = source.owner_id;
    previousCandidates = source.candidates;
    await db
      .from("sources")
      .update({ status: "processing" })
      .eq("id", source.id)
      .eq("revision", job.revision);
    const { data: files, error: fileError } = await db
      .from("attachments")
      .select("path,mime_type,size_bytes")
      .eq("source_id", source.id)
      .eq("owner_id", owner)
      .eq("state", "ready")
      .order("created_at")
      .order("id")
      .limit(MAX_IMAGES + 1);
    if (fileError) throw new Error("讀取附件失敗");
    if ((files?.length || 0) > MAX_IMAGES) throw new AIError("image_limit", false);
    let text = source.content_text.trim();
    let map;
    maps = isMapsHost(new URL(source.original_url).hostname);
    if (maps) {
      map = parseMapsUrl(source.original_url);
      if (!map.name) {
        try {
          const page = await fetchSourcePage(source.original_url, "maps");
          diagnostics.fetch = page.trace;
          map = parseMapsUrl(page.trace.final_url);
        } catch (e) {
          if (!meaningfulText(text) && !files?.length) throw e;
          diagnostics.maps_lookup = "unavailable";
        }
      }
    }
    if (maps && !meaningfulText(text) && !files?.length) result = mapsResult(map!);
    else {
      const images: { mime: string; data: string }[] = [];
      if (process.env.AI_API_KEY) {
        const deadline = Date.now() + 16000;
        let bytes = 0;
        for (const f of files || []) {
          const remaining = deadline - Date.now();
          if (remaining <= 0) throw new AIError("image_download_timeout", true);
          const downloaded = await db.storage
            .from("screenshots")
            .download(f.path, {}, { signal: AbortSignal.timeout(Math.min(8000, remaining)) });
          if (downloaded.error || !downloaded.data) throw new AIError("image_download", true);
          const b = Buffer.from(await downloaded.data.arrayBuffer());
          bytes += b.length;
          if (
            !b.length ||
            b.length > MAX_IMAGE_BYTES ||
            bytes > MAX_SOURCE_IMAGE_BYTES ||
            imageMime(b) !== f.mime_type
          )
            throw new AIError("invalid_image", false);
          images.push({ mime: f.mime_type, data: b.toString("base64") });
        }
        if (!maps && !meaningfulText(text) && !images.length) {
          const page = await fetchSourcePage(source.original_url);
          diagnostics.fetch = page.trace;
          text = meaningfulText(page.text, true) ? page.text : "";
        }
      }
      diagnostics.input_characters = text.slice(0, 20000).length;
      diagnostics.input_preview = text.slice(0, 400);
      diagnostics.image_count = images.length;
      if (process.env.AI_API_KEY && (meaningfulText(text) || images.length)) {
        hash = contentHash(text, images);
        const claim = await db.rpc("claim_ai_extraction", { owner, hash });
        if (claim.error) throw new AIError("cache_unavailable", true);
        if (claim.data?.result) {
          result = claim.data.result as ParseResult;
          diagnostics.cache = "hit";
        } else {
          cacheToken = claim.data?.token || "";
          if (!cacheToken) throw new AIError("content_in_progress", true, 60);
          result = await extractPlaces(text, images);
          const saved = await db.rpc("finish_ai_extraction", {
            owner,
            hash,
            token: cacheToken,
            result,
          });
          if (saved.error) diagnostics.cache = "save_failed";
          cacheToken = "";
        }
      } else result = await extractPlaces(text, images);
      if (map) result.map_data = map;
    }
    // Never overwrite accepted places. Preserve exact candidate links across retries.
    result.candidates = result.candidates.map((c) => {
      const previous = (source.candidates as Candidate[]).find(
        (p) =>
          p.place_id &&
          p.name === c.name &&
          (p.branch || "") === (c.branch || "") &&
          p.address === c.address,
      );
      return previous ? { ...c, place_id: previous.place_id } : c;
    });
  } catch (error) {
    if (error instanceof SourceFetchError && error.trace) diagnostics.fetch = error.trace;
    if (cacheToken)
      await db.rpc("finish_ai_extraction", { owner, hash, token: cacheToken, result: null });
    retry =
      error instanceof AIError
        ? error.retryable
        : error instanceof SourceFetchError
          ? maps && error.retryable
          : true;
    result = {
      status: retry ? "failed" : "needs_input",
      summary: "",
      candidates: [],
      error:
        error instanceof AIError || error instanceof SourceFetchError
          ? error.message
          : "解析暫時失敗，最多嘗試三次；收藏與附件已保留。",
      error_code:
        error instanceof AIError
          ? error.code
          : error instanceof SourceFetchError
            ? `source_${error.kind}${error.status ? `_${error.status}` : ""}`
            : "worker_error",
      retry_after: error instanceof AIError ? error.retryAfter : 0,
    };
  }
  if (!result.candidates.length) result.candidates = previousCandidates.filter((c) => c.place_id);
  result.diagnostics = { ...diagnostics, ...result.diagnostics };
  const completed = await db.rpc("complete_import_job", {
    job_id: job.id,
    token: job.claim_id,
    result,
    retry,
  });
  if (completed.error) throw new Error("解析結果尚未寫入，租約到期後重試");
  console.info("import_complete", {
    job_id: job.id,
    status: result.status,
    code: result.error_code || "",
    saved: completed.data === true,
  });
  return { processed: true, status: result.status };
}
