import { adminClient } from "./supabase/admin";
import { fetchSourceText } from "./safe-fetch";
import { extractPlaces, type ParseResult } from "./parser";
export async function processOneJob() {
  const db = adminClient();
  const { data: job, error } = await db.rpc("claim_import_job");
  if (error) throw new Error("無法取得解析工作");
  if (!job?.id) return { processed: false };
  let result: ParseResult;
  let retry = false;
  try {
    const { data: source, error } = await db
      .from("sources")
      .select("*")
      .eq("id", job.source_id)
      .single();
    if (error) throw new Error("找不到來源");
    await db
      .from("sources")
      .update({ status: "processing" })
      .eq("id", source.id)
      .eq("revision", job.revision);
    const { data: files, error: fileError } = await db
      .from("attachments")
      .select("path,mime_type")
      .eq("source_id", source.id)
      .eq("owner_id", source.owner_id)
      .limit(3);
    if (fileError) throw new Error("讀取附件失敗");
    const images: { mime: string; data: string }[] = [];
    // Do not retrieve or transmit screenshots when AI is disabled.
    if (process.env.AI_API_KEY)
      for (const f of files ?? []) {
        const { data, error } = await db.storage.from("screenshots").download(f.path);
        if (error) throw new Error("讀取截圖失敗");
        if (data.size <= 5 * 1024 * 1024)
          images.push({
            mime: f.mime_type,
            data: Buffer.from(await data.arrayBuffer()).toString("base64"),
          });
      }
    let text = source.content_text;
    let fetchFailed = false;
    if (!text && !images.length && process.env.AI_API_KEY) {
      try {
        text = await fetchSourceText(source.original_url);
      } catch {
        fetchFailed = true;
      }
    }
    result = await extractPlaces(text, images);
    if (fetchFailed)
      result = {
        status: "needs_input",
        summary: "",
        candidates: [],
        error: "來源網站目前無法讀取，請貼上文章文字或上傳截圖。收藏仍已保存。",
      };
  } catch {
    retry = true;
    result = {
      status: "failed",
      summary: "",
      candidates: [],
      error: "解析暫時失敗，系統最多嘗試三次；你仍可手動整理收藏。",
    };
  }
  const completed = await db.rpc("complete_import_job", {
    job_id: job.id,
    token: job.claim_id,
    result,
    retry,
  });
  if (completed.error) throw new Error("解析結果尚未寫入，工作將於租約到期後重試");
  return { processed: true, status: result.status };
}
