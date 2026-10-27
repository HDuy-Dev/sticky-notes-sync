# Sticky Notes Sync — Thiết kế

Ngày: 2026-10-26 · Trạng thái: chờ duyệt

## 1. Mục đích

Một Chrome extension để ghi note nhanh khi đang làm việc trên trình duyệt: bấm icon là ra bảng note, gõ ngay, có định dạng (đậm, màu, link…). Note được lưu trong trình duyệt **và** trên Google Sheet của chính người dùng, để mở ở trình duyệt/máy khác vẫn thấy cùng nội dung.

Lấy cảm hứng từ extension "Sticky Notes 3.8 – super quick" (giao diện tab thư mục + nhiều ô note cạnh nhau, xem ảnh tham khảo người dùng gửi).

Ví dụ nội dung thực tế: số thuê bao, mã khách hàng, tên hotlink, link localhost dùng khi test. Tức là note tra cứu nhanh lúc làm việc, cần mở nhanh và copy nhanh.

## 2. Mục tiêu

- Mở bằng icon extension → popup hiện ngay nội dung đã lưu (không chờ mạng).
- Tab thư mục ở trên; mỗi thư mục chứa nhiều ô note.
- Note có định dạng; dán từ trang khác giữ được định dạng cơ bản.
- Tự động lưu, không có nút Lưu.
- Đồng bộ với Google Sheet; trình duyệt khác cài cùng extension + cùng cấu hình thì thấy cùng note.
- Dùng được khi offline; có mạng lại thì tự đẩy lên.

## 3. Không làm (ở bản này)

- Note dán trực tiếp lên trang web.
- Đưa lên Chrome Web Store / nhiều người dùng / chia sẻ note.
- Tìm kiếm, tag, lịch sử phiên bản, chèn ảnh.
- Đồng bộ thời gian thực khi popup đang mở ở hai nơi cùng lúc (chỉ đồng bộ khi mở popup và sau khi sửa).
- Sửa note trực tiếp trên Google Sheet rồi kéo về (Sheet là nơi lưu/xem, không phải nơi sửa).

## 4. Điều tuyệt đối tránh

- **Mất note.** Một thay đổi chưa đẩy lên được thì phải được giữ lại và thử lại, không bao giờ bị bản từ Sheet ghi đè mất trong im lặng.
- Dữ liệu đi qua bất kỳ server nào ngoài Google của chính người dùng.
- Mở popup mà phải chờ mạng mới thấy note.

## 5. Ràng buộc

- Chrome, Manifest V3, cài dạng "Load unpacked" để dùng cá nhân.
- JavaScript thuần, không framework, không bước build. Test bằng `node --test` (không cần cài thư viện).
- Popup Chrome tối đa 800×600 px.
- Một ô Google Sheet chứa tối đa 50.000 ký tự.

## 6. Những gì đã quyết định

### 6.1 Giao diện (theo ảnh tham khảo)

- **Màu chủ đạo: xanh dương** (`#0b2a5b` → `#1a4fa0` → `#2f6fe0`), thanh tab nền gradient xanh đậm. Giao diện chuẩn theo mockup `mockup/popup-mockup.html`.
- Thanh tab thư mục trên cùng. Tab đang chọn nổi bật, có nút bút để đổi tên (hoặc nhấp đúp / F2). Nút **+** thêm thư mục, nút **thùng rác** xóa thư mục đang chọn (khóa khi chỉ còn 1 thư mục). Phím mũi tên trái/phải để chuyển tab.
- Mỗi note có một dòng tiêu đề mảnh "Note 1/2/3" với nút **Copy toàn bộ note** (copy giữ định dạng) và nút xóa, để các nút không đè lên chữ.
- Thanh định dạng vẫn dùng được sau khi bấm ra ngoài note (nhớ note và vùng chọn gần nhất); nút B/I/U sáng lên khi chữ đang chọn có định dạng đó. Chèn link bằng ô nhập nhỏ (Ctrl/Cmd+K), không dùng hộp thoại trình duyệt.
- Mỗi thư mục có **tối đa 3 note**, xếp cạnh nhau thành cột chia đều chiều ngang (1, 2 hoặc 3 cột). Mỗi note **kéo dài hết chiều cao** popup, nội dung dài thì cuộn trong note. Nút "Thêm note (x/3)" ở thanh công cụ, bị khóa khi đủ 3.
- Gõ trực tiếp vào ô, không có chế độ xem/sửa riêng.

### 6.2 Định dạng

- Đậm, nghiêng, gạch chân, màu chữ, link bấm được (mở tab mới).
- Phím tắt Ctrl/Cmd+B/I/U, cộng một thanh công cụ nhỏ hiện khi ô note đang được focus (B, I, U, chọn màu, chèn link, xóa định dạng).
- Dán HTML từ trang khác: chỉ giữ thẻ/kiểu an toàn (đậm, nghiêng, gạch chân, màu chữ, link, xuống dòng, danh sách); bỏ hết phần còn lại (script, ảnh, style lạ, sự kiện).

### 6.3 Lưu trữ & đồng bộ

- Lưu cục bộ trong `chrome.storage.local`, lưu ngay khi gõ (debounce ngắn).
- Kết nối Google Sheet qua **Google Apps Script** (Web App) mà người dùng dán vào Sheet một lần. Trong trang Cài đặt của extension: dán URL Web App + một **mã bí mật** tự đặt; script từ chối mọi yêu cầu sai mã. Có nút "Kiểm tra kết nối".
- Mở popup ở trình duyệt khác → kéo bản mới nhất từ Sheet về.
- Sửa cùng một note ở hai nơi → **bản sửa sau cùng thắng** (theo thời điểm sửa).
- Phần đồng bộ tách riêng thành một module, để sau này đổi sang đăng nhập Google chính thức (khi đưa lên Store) mà không phải viết lại phần còn lại.

## 7. Phần để người xây dựng tự quyết (kèm lựa chọn của Claude)

Các mục dưới đây là **lựa chọn của Claude**, người dùng chưa xác nhận từng mục:

- **Dữ liệu:** thư mục `{id, name, order, updatedAt, deleted}`, note `{id, folderId, order, html, updatedAt, deleted}`. Xóa = đánh dấu `deleted` (giữ lại để đồng bộ việc xóa sang máy khác).
- **Bố cục Sheet:** hai sheet `Folders` và `Notes` (thay vì mỗi thư mục một sheet như đã đoán lúc trao đổi, vì đổi tên thư mục sẽ phức tạp). Sheet `Notes` có cột tên thư mục và cột **nội dung dạng chữ thường** để dễ đọc, bên cạnh cột HTML.
- **Thư mục mới** có sẵn 2 ô note trống; nút xóa trên từng ô. Cài lần đầu có sẵn "Folder 1". Mockup đã duyệt hướng giao diện: `mockup/popup-mockup.html`.
- **Xóa** thư mục/note: hỏi xác nhận ngay trong giao diện (không dùng hộp thoại `confirm()` của trình duyệt).
- **Màu chữ:** 6 màu có sẵn + màu mặc định.
- **Cách đẩy lên:** popup chỉ ghi vào storage và đánh dấu bản ghi "chưa đồng bộ"; service worker nền đẩy các bản ghi đó lên (gom trong ~2 giây), và có `chrome.alarms` mỗi 1 phút thử lại nếu còn bản chưa đẩy. Nhờ vậy đóng popup giữa chừng không mất thay đổi.
- **Cách kéo về:** khi mở popup, hiện dữ liệu cục bộ trước, rồi kéo từ Sheet và gộp theo `updatedAt`. Bản ghi đang "chưa đồng bộ" ở máy này chỉ bị thay nếu bản trên Sheet mới hơn. Ô đang được gõ không bị thay nội dung giữa chừng.
- **Apps Script:** một endpoint `doPost` nhận `{secret, action: "sync", changes}`, gộp theo cùng luật "mới nhất thắng" dưới `LockService`, trả về toàn bộ dữ liệu. Mã script nằm trong repo (`apps-script/Code.gs`) kèm hướng dẫn cài từng bước trong README.
- **Trạng thái đồng bộ:** một chấm nhỏ ở góc (đã đồng bộ / đang đồng bộ / lỗi, di chuột để xem lý do). Chưa cấu hình Sheet thì extension vẫn chạy bình thường, chỉ lưu cục bộ.
- **Note quá dài** (>45.000 ký tự HTML): hiện cảnh báo trên ô đó và không đẩy lên, thay vì để Sheet báo lỗi.
- **Test:** test tự động cho luật gộp dữ liệu và bộ lọc HTML khi dán; phần giao diện và đồng bộ thật kiểm tra thủ công bằng cách load extension.
- Thời gian dùng đồng hồ của máy; chấp nhận sai lệch nhỏ giữa các máy vì chỉ một người dùng.
