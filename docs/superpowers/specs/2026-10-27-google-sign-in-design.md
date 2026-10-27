# Sticky Notes Sync v2 — Đăng nhập Google, phát hành công khai

Ngày: 2026-10-27 · Trạng thái: chờ duyệt · Thay thế phần đồng bộ của `2026-10-26-sticky-notes-sync-design.md` (giao diện note, thư mục, định dạng giữ nguyên).

## 1. Mục đích

Đưa extension lên Chrome Web Store cho **bất kỳ ai** dùng. Người dùng chỉ cần **bấm "Sign in with Google"**: extension tự tạo một Google Sheet trong Drive của chính họ và đồng bộ note vào đó. Không còn bước dán URL, mã bí mật hay cài Apps Script như bản hiện tại.

## 2. Mục tiêu

- Cài từ Chrome Web Store, chạy trên mọi trình duyệt nhân Chromium (Chrome, Edge, Brave, Cốc Cốc…).
- Chưa đăng nhập: dùng bình thường, note lưu trong trình duyệt.
- Đăng nhập một lần → extension tự tạo (hoặc tìm lại) Sheet "Sticky Notes Sync" trong Drive người dùng và đồng bộ.
- Cùng tài khoản trên máy khác → thấy cùng note.
- Giao diện **tiếng Anh**.
- Giữ nguyên trải nghiệm note hiện tại (thư mục, tối đa 3 note, định dạng, copy, tự lưu).

## 3. Không làm

- Apps Script (bỏ hẳn: `apps-script/Code.gs`, phần Cài đặt URL/mã bí mật, bản nháp cấu hình, hướng dẫn trong README).
- Đa ngôn ngữ (chỉ tiếng Anh), Firefox/Safari, chia sẻ note giữa người dùng, kéo thay đổi sửa tay trên Sheet về extension.
- Server riêng của nhà phát triển. Dữ liệu chỉ đi giữa trình duyệt và Google.

## 4. Điều tuyệt đối tránh

- **Mất note** (như bản 1): thay đổi chưa đẩy lên được thì giữ lại và thử lại; hai máy đồng bộ cùng lúc không được xóa thay đổi của nhau.
- Xin quyền rộng hơn cần thiết (đọc được file khác trong Drive người dùng).
- Nhúng bất kỳ "client secret" nào vào extension.
- Note của tài khoản A lặng lẽ chui vào Sheet của tài khoản B.

## 5. Ràng buộc

- Chrome MV3, JavaScript thuần, không bước build, test bằng `node --test`.
- Quyền OAuth: `https://www.googleapis.com/auth/drive.file` (chỉ file do app tạo) + `openid email` (để hiện email đang đăng nhập). Không xin `spreadsheets` hay `drive`.
- Hạn mức Sheets API mỗi người dùng ~60 lượt đọc/ghi mỗi phút: giữ debounce 2 giây và báo thức 1 phút như bản 1.
- Một ô Sheet tối đa 50.000 ký tự (giữ giới hạn note 45.000 ký tự HTML).

## 6. Đã quyết định

### 6.1 Đăng nhập
- Dùng `chrome.identity.launchWebAuthFlow` với OAuth client loại **Web application**, redirect URI `https://<extension-id>.chromiumapp.org/`, luồng **implicit** (`response_type=token`). Chạy được trên mọi trình duyệt Chromium, không cần secret.
- Access token sống ~1 giờ, giữ trong `chrome.storage.session` (mất khi đóng trình duyệt). Email và id Sheet giữ trong `chrome.storage.local`.
- Hết hạn → gia hạn ngầm bằng `launchWebAuthFlow({ interactive: false })` với `prompt=none` và `login_hint=<email>`. Gia hạn ngầm thất bại → trạng thái **"Sign in again"**, bấm vào để đăng nhập lại; note vẫn lưu cục bộ và đồng bộ bù sau.

### 6.2 Sheet
- Tạo bằng Drive API (`mimeType: application/vnd.google-apps.spreadsheet`, tên "Sticky Notes Sync", `appProperties: { stickyNotesSync: "v1" }`), rồi thêm 2 trang `Folders` và `Notes` với hàng tiêu đề như bản 1 (`id | name | order | updatedAt | deleted | updated` và `id | folderId | folder | order | text | html | updatedAt | deleted | updated`).
- Đăng nhập trên máy mới: tìm file có `appProperties` đó (quyền `drive.file` chỉ thấy file do app tạo), không bị xóa → dùng lại; nhiều file → lấy file tạo sớm nhất; không có → tạo mới.
- Sheet bị người dùng xóa (API trả 404/trashed) → tạo Sheet mới và đẩy toàn bộ.
- Ghi bằng `valueInputOption: RAW` để số điện thoại giữ số 0 đầu và `=…` không thành công thức.

### 6.3 Đồng bộ
- Giữ luật "bản sửa sau cùng thắng" theo `updatedAt`, xóa = đánh dấu `deleted`, phần chạy ngầm là nơi ghi duy nhất (giữ `model.js`, `merge.js`, cấu trúc `sync.js`).
- Mỗi lượt: đọc 2 trang Sheet → gộp vào dữ liệu máy → **chỉ ghi những dòng máy này đã đổi**: dòng đã có (theo id) thì sửa đúng dòng đó, dòng mới thì nối thêm. Không bao giờ viết lại cả trang, không xóa dòng (nên số dòng không xê dịch).
- Lần đầu đăng nhập, hoặc khi chuyển sang Sheet khác Sheet trước đó: đánh dấu **toàn bộ** thư mục và note là cần đẩy.

### 6.4 Đăng xuất & đổi tài khoản
- "Sign out" hỏi: **Keep notes on this device** / **Remove notes from this device** (note trên Sheet luôn còn). Thu hồi token với Google khi đăng xuất.
- Đăng nhập tài khoản khác với tài khoản lần trước trong khi máy còn note → hỏi trước: *"Notes on this device will be added to the Google Sheet of <email>."* [Continue] [Cancel].

### 6.5 Giao diện (tiếng Anh, giữ bố cục mockup)
- Trang Cài đặt thay bằng trang **Account**:
  - Chưa đăng nhập: giải thích một câu + nút **Sign in with Google** + dòng "Only files created by Sticky Notes Sync are accessible. Your notes never leave your Google account."
  - Đã đăng nhập: email, **Open Google Sheet** (mở tab mới), **Sign out**.
- Chấm trạng thái: `Not synced` (chưa đăng nhập; bấm mở Account) · `Syncing…` · `Synced` · `Sync error` (bấm thử lại) · `Sign in again` (bấm đăng nhập lại).
- Dịch toàn bộ chữ tiếng Việt hiện có sang tiếng Anh (ví dụ "Thêm note (2/3)" → "Add note (2/3)", "Xóa note này?" → "Delete this note?", "Gõ hoặc dán ghi chú…" → "Type or paste a note…").

### 6.6 Phát hành
- Icon extension (16/32/48/128), ảnh chụp màn hình 1280×800 cho Store, mô tả Store tiếng Anh.
- Trang **Privacy Policy** (`PRIVACY.md` + bản HTML) nêu rõ: dữ liệu chỉ nằm trong trình duyệt và Google Drive của người dùng, không gửi cho nhà phát triển, quyền `drive.file` dùng để làm gì.
- Tài liệu `docs/PUBLISHING.md` hướng dẫn nhà phát triển (bạn): tạo Google Cloud project, bật Drive API + Sheets API, màn hình OAuth consent (External, scope không nhạy cảm), OAuth client Web application với redirect URI cho cả id dev và id Store, khóa `key` trong manifest để id dev cố định, đăng ký Chrome Web Store (5 USD) và nộp duyệt.
- OAuth client id đặt trong một file cấu hình duy nhất trong mã (không phải bí mật).

## 7. Để người xây dựng tự quyết (lựa chọn của Claude, chưa được xác nhận từng mục)

- Tên file/module: `src/lib/google-auth.js` (token, gia hạn), `src/lib/sheets-store.js` (tìm/tạo Sheet, đọc dòng, ghi dòng), `src/lib/sheet-rows.js` (chuyển dòng ↔ bản ghi, tính dòng cần sửa/thêm — thuần, test được).
- Hai máy cùng sửa **cùng một note** trong cùng vài giây: máy ghi sau thắng trên Sheet bất kể `updatedAt`; chấp nhận vì hiếm (chỉ một người dùng trên nhiều máy).
- Kiểm thử: test tự động cho chuyển đổi dòng/bản ghi, tính dòng cần ghi, gia hạn token (giả lập `fetch` và `chrome.identity`), luồng đồng bộ với API Google giả lập. Kiểm tra end-to-end trong Chromium bằng cách chặn và giả lập `googleapis.com` cùng một bản `chrome.identity` giả. Đăng nhập Google thật do bạn tự kiểm tra sau khi tạo OAuth client.
- Lỗi API hiển thị bằng câu tiếng Anh ngắn (ví dụ "Can't reach Google", "Google Sheet was deleted — creating a new one").
- Icon: thiết kế đơn giản (tờ note góc gập, màu xanh dương chủ đạo).
