# Sticky Notes Sync

Chrome extension ghi note nhanh có định dạng, chia theo thư mục (mỗi thư mục tối đa 3 note), lưu trong trình duyệt và đồng bộ lên Google Sheet của chính bạn.

## 1. Cài extension

1. Mở `chrome://extensions`, bật **Developer mode** (góc phải trên).
2. Bấm **Load unpacked** và chọn thư mục `sticky-notes-sync` này.
3. Ghim icon extension lên thanh công cụ (biểu tượng mảnh ghép → ghim).

Chưa cấu hình Google Sheet thì note vẫn lưu trong trình duyệt bình thường, chỉ không đồng bộ.

## 2. Tạo Google Sheet và script đồng bộ

1. Tạo một Google Sheet mới (ví dụ tên "Sticky Notes").
2. Trong Sheet: **Extensions → Apps Script**.
3. Xóa nội dung có sẵn trong `Code.gs`, dán toàn bộ nội dung file [`apps-script/Code.gs`](apps-script/Code.gs) vào.
4. Sửa dòng `const SECRET = 'CHANGE_ME';` thành một mã bí mật của bạn (dài, khó đoán). Bấm **Save**.
5. Bấm **Deploy → New deployment**:
   - Select type: **Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
6. Bấm **Deploy**, cấp quyền khi Google hỏi (chọn tài khoản → Advanced → Go to … → Allow).
7. Copy **Web app URL** (kết thúc bằng `/exec`).

## 3. Kết nối extension với Sheet

1. Mở popup extension → bấm biểu tượng bánh răng **Cài đặt đồng bộ**.
2. Dán URL `/exec` và mã bí mật (giống hệt mã trong `Code.gs`).
3. Bấm **Kiểm tra kết nối** → thấy `✓ Kết nối được: …` là ổn. Bấm **Lưu**.

Sheet sẽ có 2 trang tính: `Folders` và `Notes`. Cột `text` của `Notes` là nội dung dạng chữ thường để bạn đọc nhanh, cột `html` giữ định dạng.

Ở trình duyệt/máy khác: cài extension như bước 1, nhập **cùng URL và mã bí mật** là thấy cùng note.

## Lưu ý

- **Bảo mật:** ai có cả URL `/exec` lẫn mã bí mật thì đọc được toàn bộ note. Đừng chia sẻ hai thứ này. Dữ liệu chỉ đi giữa trình duyệt và Google Sheet của bạn.
- **Sửa script:** mỗi lần sửa `Code.gs` phải **Deploy → Manage deployments → Edit (bút chì) → Version: New version → Deploy** thì thay đổi mới có hiệu lực (URL giữ nguyên).
- Sheet chỉ để xem/lưu. Sửa note trực tiếp trên Sheet sẽ **không** được kéo về extension.
- Note dài hơn 45.000 ký tự (tính cả định dạng) không đồng bộ được, extension sẽ cảnh báo trên note đó.
- Sửa cùng một note ở hai nơi: bản sửa sau cùng được giữ.

## Phát triển

```sh
npm test   # chạy test (Node ≥ 20, không cần cài thư viện)
```
