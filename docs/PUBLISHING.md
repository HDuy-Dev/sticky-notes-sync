# Publishing Sticky Notes Sync

One-time setup for the developer: a Google Cloud OAuth client so users can sign in, then the Chrome Web Store listing.

## 1. Give the dev build a stable extension ID

The OAuth redirect URI contains the extension ID, so the unpacked build needs a fixed one.

```sh
openssl genrsa 2048 | openssl pkcs8 -topk8 -nocrypt -out ~/sticky-notes-sync-key.pem   # keep OUT of git
openssl rsa -in ~/sticky-notes-sync-key.pem -pubout -outform DER | openssl base64 -A    # prints the public key
```

Add the printed value to `manifest.json` as `"key": "<public key>"`, reload the extension in `chrome://extensions`, and note its ID (`<dev-id>`).

## 2. Google Cloud project

1. Go to <https://console.cloud.google.com/>, create a project (e.g. "Sticky Notes Sync").
2. **APIs & Services → Library**: enable **Google Drive API** and **Google Sheets API**.
3. **OAuth consent screen** (Google Auth Platform):
   - User type: **External**.
   - App name "Sticky Notes Sync", support email, app logo (`assets/icons/icon-128.png`), developer contact email.
   - App domain → Privacy policy URL: the public URL of `docs/privacy.html` (see step 5).
   - Scopes: `openid`, `.../auth/userinfo.email`, `.../auth/drive.file`. All are non-sensitive, so no security assessment is required.
   - While the app is in **Testing**, only listed test users (max 100) can sign in. Add yourself. Click **Publish app** when going live; Google may ask for brand verification (name, logo, domain), which is a short review.
4. **Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**.
   - Authorized redirect URIs: `https://<dev-id>.chromiumapp.org/` (add the store one later).
5. Copy the client ID into `src/config.js` (`GOOGLE_CLIENT_ID`). It is public, not a secret. Never add a client secret to the extension.

## 3. Test sign-in

Reload the extension, open the popup → gear → **Sign in with Google**. Expect a "Sticky Notes Sync" spreadsheet in your Drive with `Folders` and `Notes` tabs. Repeat in a second Chromium browser (Edge/Brave) to check sync.

## 4. Chrome Web Store

1. Register at the [Developer Dashboard](https://chrome.google.com/webstore/devconsole) (one-time US$5 fee).
2. Build the upload zip (the script drops the manifest `"key"` field automatically):
   ```sh
   npm run build   # -> dist/sticky-notes-sync-<version>.zip
   ```
3. Upload. The store assigns the final ID (`<store-id>`). Add `https://<store-id>.chromiumapp.org/` to the OAuth client's redirect URIs.
4. Listing:
   - Description: see "Store listing text" below.
   - Icon: `assets/icons/icon-128.png`. Screenshots: `store/screenshot-1.png` … `store/screenshot-5.png` (1280×800, upload in order). Small promo tile: `store/promo-small.png` (440×280). Marquee promo tile: `store/promo-marquee.png` (1400×560).
   - Category: Productivity. Language: English.
   - Privacy practices tab: paste the single purpose and permission justifications from `docs/COMPLIANCE.md`. Data usage: declare **Personally identifiable information** (the email address). Note contents never reach the developer; if the form still asks, pick the closest category and say they are stored only in the user's own browser and Google Drive. Re-read the form's current wording when submitting, since categories change. Tick the three Limited Use certifications.
   - Privacy policy URL: same as the OAuth consent screen.
5. Submit for review.

## 5. Hosting the privacy policy

The policy must be reachable at a public URL. Options:
- Public GitHub repo → enable GitHub Pages for `/docs` and use `https://<user>.github.io/sticky-notes-sync/privacy.html`.
- Private repo → paste `PRIVACY.md` into a Google Doc, **File → Share → Publish to web**, and use that link.

Replace `[CONTACT_EMAIL]` in `PRIVACY.md` and `docs/privacy.html` first.

## Store listing text

The store name and short description come from `_locales/<lang>/messages.json` (`extName`, max 75 characters; `extDescription`, max 132), referenced by `manifest.json`. English is the default; Vietnamese (`vi`) is shown to users whose browser language is Vietnamese. The name leads with the brand and then the words people search for: "sticky notes", "notepad", "Google Drive".

Detailed description (paste into the dashboard). Keep "Google Drive" to at most 5 mentions; the spam policy flags a keyword repeated more than 5 times.

> Sticky notes and a notepad in your browser, saved automatically to your own Google Drive.
>
> Write a quick note, close the popup, and it's already saved. Sign in with Google once and every note is backed up to a spreadsheet in your Drive, so the same notes are waiting on every computer you use: work laptop, home PC, Chrome, Edge or Brave.
>
> WHY GOOGLE DRIVE?
> • Your notes belong to you: they live in a "Sticky Notes Sync" spreadsheet in your Drive, not on someone else's server
> • Open, search, export or back up your notes from Drive any time
> • Sync across all your computers, automatically, a couple of seconds after you type
> • Keep your notes even if you reinstall the browser or switch computers
>
> FEATURES
> • Folder tabs, with up to three notes side by side in each folder
> • Bold, italic, underline, six text colors and clickable links
> • Paste from web pages and keep simple formatting
> • Copy a whole note in one click
> • Saves as you type and works offline
> • Sign-in is optional: notes work locally without an account
> • Works in Chrome, Edge, Brave, Cốc Cốc and other Chromium browsers
>
> PRIVATE BY DESIGN
> • Only asks for your email address and access to files it creates (drive.file). It cannot see any other file in your Drive
> • No servers, no analytics, no ads. Nothing is sent to the developer
> • Free and open source (MIT): https://github.com/HDuy-Dev/sticky-notes-sync
>
> Great as a quick notepad, to-do list, meeting notes, scratch pad or clipboard for snippets you reuse.
>
> Not affiliated with Google. Google Drive and Google Sheets are trademarks of Google LLC.

Vietnamese detailed description (dashboard → Store listing → add language "Tiếng Việt", paste below, reuse the same images):

> Ghi chú dán (sticky notes) và notepad ngay trên trình duyệt, tự động lưu vào Google Drive của chính bạn.
>
> Viết một ghi chú nhanh, đóng cửa sổ là đã lưu. Đăng nhập Google một lần, mọi ghi chú được sao lưu vào một bảng tính trong Drive của bạn, nên máy ở công ty hay ở nhà đều thấy cùng một nội dung: Chrome, Edge, Brave hay Cốc Cốc.
>
> VÌ SAO LƯU VÀO GOOGLE DRIVE?
> • Ghi chú là của bạn: nằm trong bảng tính "Sticky Notes Sync" trong Drive, không nằm trên máy chủ của ai khác
> • Mở, tìm kiếm, xuất hoặc sao lưu ghi chú từ Drive bất cứ lúc nào
> • Tự đồng bộ giữa các máy tính vài giây sau khi bạn gõ
> • Cài lại trình duyệt hay đổi máy vẫn còn nguyên ghi chú
>
> TÍNH NĂNG
> • Thư mục dạng tab, mỗi thư mục tối đa ba ghi chú đặt cạnh nhau
> • In đậm, in nghiêng, gạch chân, sáu màu chữ và liên kết bấm được
> • Dán từ trang web vẫn giữ định dạng đơn giản
> • Sao chép cả ghi chú chỉ với một cú bấm
> • Tự lưu khi gõ, dùng được khi không có mạng
> • Không bắt buộc đăng nhập: ghi chú vẫn dùng được trên máy mà không cần tài khoản
>
> RIÊNG TƯ NGAY TỪ THIẾT KẾ
> • Chỉ xin địa chỉ email và quyền với các file do chính tiện ích tạo (drive.file). Không thể xem bất kỳ file nào khác trong Drive
> • Không máy chủ, không thống kê, không quảng cáo. Không dữ liệu nào được gửi cho nhà phát triển
> • Miễn phí, mã nguồn mở (MIT): https://github.com/HDuy-Dev/sticky-notes-sync
>
> Phù hợp làm notepad nhanh, danh sách việc cần làm, ghi chú cuộc họp, nháp hay lưu các đoạn văn bản hay dùng.
>
> Không liên kết với Google. Google Drive và Google Sheets là thương hiệu của Google LLC.

## Icons and store images

`assets/icons/icon.svg` is the source (`icon-small.svg`, without the sync badge, is used for the 16 px toolbar icon; the 128 px icon keeps 16 px of transparent padding per side as the store asks). Store images are HTML pages in `store/src/` that embed `popup-demo.html`, a static copy of the popup styled by the real `popup.css`. After editing either, run:

```sh
scripts/render-store-images.sh            # all store images and icon PNGs
scripts/render-store-images.sh icons      # only assets/icons/icon-*.png
```

It needs Google Chrome (override the path with `CHROME=...`) and a network connection for the Plus Jakarta Sans web font. Copy `assets/icons/icon-128.png` to `docs/icon.png` and `store/screenshot-1.png` to `docs/screenshot.png` to refresh the website.
