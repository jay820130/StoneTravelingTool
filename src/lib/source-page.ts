import { Parser } from "htmlparser2";
const clean = (s: string) => s.replace(/\s+/g, " ").trim();
const keys = new Set([
  "og:title",
  "og:description",
  "twitter:title",
  "twitter:description",
  "description",
]);
/** Only public sharing metadata. No scripts, page body, login, or browser execution. */
export class SourcePage {
  private previews: string[] = [];
  private meta: Record<string, string> = {};
  private title = "";
  private inTitle = false;
  private hiddenDepth = 0;
  headComplete = false;
  private parser = new Parser({
    onopentag: (tag, attrs) => {
      if (this.headComplete) return;
      if (this.hiddenDepth || ["script", "style", "template", "noscript"].includes(tag)) {
        this.hiddenDepth++;
        return;
      }
      if (tag === "body") {
        this.headComplete = true;
        return;
      }
      if (tag === "title") this.inTitle = true;
      if (tag !== "meta") return;
      const key = (attrs.property || attrs.name || "").toLowerCase();
      const value = clean(attrs.content || "").slice(0, 8000);
      if (keys.has(key) && value && this.previews.length < 20) {
        this.meta[key] = value;
        if (!this.previews.includes(value)) this.previews.push(value);
      }
    },
    ontext: (text) => {
      if (!this.headComplete && !this.hiddenDepth && this.inTitle)
        this.title += text.slice(0, 300 - this.title.length);
    },
    onclosetag: (tag) => {
      if (this.hiddenDepth) {
        this.hiddenDepth--;
        return;
      }
      if (tag === "title") this.inTitle = false;
      if (tag === "head") this.headComplete = true;
    },
  });
  write(chunk: string) {
    this.parser.write(chunk);
  }
  end(chunk = "") {
    this.parser.end(chunk);
  }
  get text() {
    return this.previews.join("\n").slice(0, 20000);
  }
  get metadata() {
    return {
      title: clean(this.title),
      og_title: (this.meta["og:title"] || "").slice(0, 300),
      og_description: (this.meta["og:description"] || "").slice(0, 600),
      body_read: false,
    };
  }
}
export function htmlText(html: string) {
  const page = new SourcePage();
  page.end(html);
  return page.text;
}
