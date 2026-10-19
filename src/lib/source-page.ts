import { Parser } from "htmlparser2";

const TEXT_LIMIT = 20000;
const hiddenTags = new Set(["script", "style", "noscript", "template", "svg"]);
const blockTags = new Set([
  "p",
  "div",
  "li",
  "br",
  "hr",
  "h1",
  "h2",
  "h3",
  "h4",
  "section",
  "article",
  "tr",
  "td",
]);
const titleKeys = new Set(["og:title", "twitter:title", "name"]);
const descriptionKeys = new Set(["og:description", "twitter:description", "description"]);
const clean = (value: string) => value.replace(/\s+/g, " ").trim();

/** Read public page text and sharing previews; never execute page scripts. */
export class SourcePage {
  private previews: string[] = [];
  private body: string[] = [];
  private bodyLength = 0;
  private title = "";
  private inTitle = false;
  private hiddenDepth = 0;
  headComplete = false;
  hasPlacePreview = false;

  private appendBody(text: string) {
    const part = text.slice(0, TEXT_LIMIT - this.bodyLength);
    this.body.push(part);
    this.bodyLength += part.length;
  }

  private parser = new Parser({
    onopentag: (tag, attrs) => {
      if (!this.hiddenDepth && (hiddenTags.has(tag) || blockTags.has(tag))) this.appendBody(" ");
      if (this.hiddenDepth || hiddenTags.has(tag)) {
        this.hiddenDepth++;
        return;
      }
      if (tag === "title") this.inTitle = true;
      if (tag !== "meta") return;
      const key = (attrs.property || attrs.name || attrs.itemprop || "").toLowerCase();
      const value = clean(attrs.content || "").slice(0, 8000);
      if (!value || (!titleKeys.has(key) && !descriptionKeys.has(key))) return;
      if (this.previews.length < 20 && !this.previews.includes(value)) this.previews.push(value);
      if (titleKeys.has(key) && !/^google\s*(maps|地圖|地图|マップ)$/i.test(value))
        this.hasPlacePreview = true;
    },
    ontext: (text) => {
      if (this.hiddenDepth) return;
      if (this.inTitle) {
        this.title += text.slice(0, 2000 - this.title.length);
      } else if (this.bodyLength < TEXT_LIMIT) this.appendBody(text);
    },
    onclosetag: (tag) => {
      if (this.hiddenDepth) {
        this.hiddenDepth--;
        return;
      }
      if (tag === "title") this.inTitle = false;
      if (tag === "head") this.headComplete = true;
      if (blockTags.has(tag)) this.appendBody(" ");
    },
  });

  write(chunk: string) {
    this.parser.write(chunk);
  }
  end(chunk = "") {
    this.parser.end(chunk);
  }
  get text() {
    return [
      ...new Set([...this.previews, this.title, this.body.join("")].map(clean).filter(Boolean)),
    ]
      .join("\n")
      .slice(0, TEXT_LIMIT);
  }
}

export function htmlText(html: string) {
  const page = new SourcePage();
  page.end(html);
  return page.text;
}
