# PDF 字型

`NotoSansTC.ttf` 依 SIL Open Font License 1.1 隨專案提供，授權見 `LICENSE.txt`。

- 來源：[Google Fonts / Noto Sans TC](https://github.com/google/fonts/tree/main/ofl/notosanstc)，2026-10-18 取得。
- 原檔 `NotoSansTC[wght].ttf` SHA256：`864727d210d54f2537bbe23b3a839436c3992af72de9322af5270897246bd44f`。
- 以 fontTools 4.61.1 的 `varLib.instancer` 固定 `wght=400`，產生靜態字型，避免 PDF renderer 的 variable font 相容問題。
- 本檔 SHA256：`e648a201226adbb6e9494d6ecc2059e70b6d045405acea51766fb096f71e419e`。

PDFKit 於匯出時嵌入實際使用字元的子集。已以 Poppler 確認繁體中文字形與跨頁顯示；字型未涵蓋的字元會顯示方框。不要只以文字擷取成功判斷視覺顯示正確。
