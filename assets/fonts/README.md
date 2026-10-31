# Fonts for approved-document PDF snapshots

Server-side PDF generation needs a Traditional Chinese font embedded in full:
the subsetter in `@pdf-lib/fontkit` drops glyphs, so `subset: true` produces a
PDF whose text extracts correctly but renders as garbage.

- `NotoSansTC-Common.otf` (4 MB): Big5, Latin, punctuation and full-width forms. Used by default.
- `NotoSansCJKtc-Regular.otf` (16 MB): used only when a document holds a character the common font lacks.

`NotoSansTC-Common.otf` is cut from `NotoSansCJKtc-Regular.otf` with fontTools subsetting: Big5,
Latin, kana, punctuation and full-width forms, no layout tables, no hinting, and `retain_gids`
(pdf-lib writes glyph ids straight into the PDF; without it CIDs and glyphs no longer line up and
the text renders wrong). Noto is under the SIL Open Font License.

Check any change by rendering a PDF, not by extracting its text: extraction passes on garbled output.

Download the full font (Noto CJK TC Regular OTF from the Google Fonts CJK repo):

```bash
curl -L -o assets/fonts/NotoSansCJKtc-Regular.otf \
  "https://github.com/googlefonts/noto-cjk/raw/main/Sans/OTF/TraditionalChinese/NotoSansCJKtc-Regular.otf"
```

Without a font, `getOrCreateApprovedPdfSnapshot` throws `cjk_font_missing`.
