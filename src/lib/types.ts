export type SourceStatus =
  "pending" | "processing" | "parsed" | "partial" | "needs_input" | "failed";
export interface Place {
  id: string;
  owner_id: string;
  name: string;
  country: string;
  city: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  categories: string[];
  tags: string[];
  rating: number | null;
  notes: string;
  created_at: string;
}
export interface Candidate {
  name: string;
  country: string;
  city: string;
  address: string;
  categories: string[];
  dishes: string[];
  summary: string;
}
export interface Source {
  id: string;
  owner_id: string;
  original_url: string;
  canonical_url: string;
  content_text: string;
  reason: string;
  status: SourceStatus;
  summary: string;
  candidates: Candidate[];
  error: string;
  revision: number;
  created_at: string;
}
export interface Visit {
  id: string;
  owner_id: string;
  place_id: string;
  visited_on: string;
  rating: number | null;
  notes: string;
  created_at: string;
}
export interface Dish {
  id: string;
  owner_id: string;
  visit_id: string;
  name: string;
  rating: number | null;
  notes: string;
}
export interface Attachment {
  id: string;
  owner_id: string;
  source_id: string;
  path: string;
  mime_type: string;
}
export interface SourceLink {
  owner_id: string;
  place_id: string;
  source_id: string;
}
export interface Label {
  id: string;
  owner_id: string;
  name: string;
}
export interface Library {
  places: Place[];
  sources: Source[];
  visits: Visit[];
  dishes: Dish[];
  place_sources: SourceLink[];
  attachments: Attachment[];
  labels: Label[];
}
export const categories = ["餐廳", "咖啡廳", "甜點", "酒吧", "逛街購物", "景點"];
export const statusLabels: Record<SourceStatus, string> = {
  pending: "等待解析",
  processing: "處理中",
  parsed: "已解析",
  partial: "部分解析",
  needs_input: "待補內容",
  failed: "解析失敗",
};
