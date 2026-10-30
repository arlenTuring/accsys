# Fonts for approved-document PDF snapshots

Place a Traditional Chinese OpenType font here for server-side PDF generation:

- Preferred: `NotoSansTC-Regular.otf`
- Or: `NotoSansCJKtc-Regular.otf`

Download example (Noto CJK TC Regular OTF from Google Fonts CJK repo):

```bash
curl -L -o assets/fonts/NotoSansCJKtc-Regular.otf \
  "https://github.com/googlefonts/noto-cjk/raw/main/Sans/OTF/TraditionalChinese/NotoSansCJKtc-Regular.otf"
```

Without this file, `getOrCreateApprovedPdfSnapshot` throws `cjk_font_missing`.
