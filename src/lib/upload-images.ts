import { api } from "./client-api";
import { imageMime, MAX_IMAGE_BYTES } from "./images";
const pending = new WeakMap<File, { id: string; source: string }>();
/** Resuming the same File reuses its reservation; signed URL is renewed on every retry. */
export async function uploadImage(source: string, file: File) {
  const mime = imageMime(new Uint8Array(await file.slice(0, 256).arrayBuffer()));
  if (!mime || !file.size || file.size > MAX_IMAGE_BYTES)
    throw new Error("請選擇 5 MB 以內的 JPEG、PNG、WebP 或 HEIC 圖片。");
  const old = pending.get(file);
  const ticket = await api<{ id: string; url: string }>("attachments/prepare", {
    source_id: source,
    mime,
    size: file.size,
    attachment_id: old?.source === source ? old.id : undefined,
  });
  pending.set(file, { id: ticket.id, source });
  let uploaded = false;
  try {
    const response = await fetch(ticket.url, {
      method: "PUT",
      headers: { "Content-Type": mime, "x-upsert": "false", "cache-control": "0" },
      body: file,
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
    uploaded = response.ok || response.status === 409;
  } catch {
    /* The response may be lost even though Storage accepted the file. */
  }
  try {
    await api("attachments/complete", { id: ticket.id });
  } catch (error) {
    if (!uploaded)
      throw new Error(
        "圖片上傳尚未完成。已保存的連結與圖片會保留，請重試；待整理也可刪除未完成的附件。",
      );
    throw error;
  }
  pending.delete(file);
}
