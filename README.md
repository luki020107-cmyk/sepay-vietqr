# Trang thanh toán VietQR + tự động chuyển hướng khi SePay báo nhận tiền

## 1. Cách hoạt động
1. Khách vào trang → server tạo mã đơn hàng (vd `DH1A2B3C4D`)
2. Trang hiện QR VietQR với **số tiền cố định** và **nội dung chuyển khoản = mã đơn hàng**
3. Trình duyệt tự hỏi server mỗi 3 giây: "đơn này đã trả chưa?"
4. Khi khách chuyển khoản xong, **SePay** phát hiện giao dịch → gọi webhook đến server của bạn
5. Server đối chiếu **nội dung chuyển khoản chứa mã đơn hàng** + **đúng số tiền** → đánh dấu đã thanh toán
6. Trình duyệt phát hiện đã thanh toán → tự động chuyển sang link bạn đã cấu hình

## 2. Cài đặt & chạy thử (local)
```bash
npm install
cp .env.example .env
# Mở file .env, sửa lại số tài khoản, tên, link redirect, và đặt SEPAY_API_KEY
npm start
```
Mở trình duyệt: http://localhost:3000

## 3. Deploy lên server công khai
SePay bắt buộc gọi webhook tới một **URL công khai (HTTPS)**, nên bạn cần deploy server này lên một dịch vụ có domain thật, ví dụ:
- Render.com (free tier, dễ nhất)
- Railway.app
- VPS riêng (dùng Nginx + PM2)

Sau khi deploy, bạn sẽ có domain dạng: `https://ten-app-cua-ban.onrender.com`

## 4. Cấu hình Webhook trong SePay
1. Đăng nhập [SePay](https://my.sepay.vn) → chọn tài khoản ngân hàng MB Bank của bạn
2. Vào mục **Webhook** (Cấu hình → Webhooks / Tích hợp)
3. Thêm webhook mới:
   - **URL nhận thông báo**: `https://ten-app-cua-ban.onrender.com/api/sepay-webhook`
   - **Kiểu xác thực**: chọn **API Key**, dán đúng chuỗi bạn đặt ở `SEPAY_API_KEY` trong `.env`
   - Áp dụng cho: chỉ giao dịch **tiền vào** (loại "in")
4. Lưu lại

## 5. Sử dụng
- Link mặc định: `https://ten-app-cua-ban.onrender.com/`
  → sau khi thanh toán sẽ chuyển tới `DEFAULT_REDIRECT` trong `.env`
- Muốn dùng link đích khác cho từng trường hợp, thêm `?redirect=`:
  ```
  https://ten-app-cua-ban.onrender.com/?redirect=https://link-ban-muon.com
  ```

## 6. Lưu ý quan trọng
- **Số tiền cố định 15.000đ**: nếu khách chuyển sai số tiền, hệ thống sẽ **không** khớp đơn (tránh nhầm lẫn/gian lận). Có thể nới lỏng logic này trong `server.js` nếu cần.
- **Nội dung chuyển khoản**: một số app ngân hàng có thể tự thêm ký tự thừa vào nội dung — mã đơn hàng vẫn khớp được vì server chỉ kiểm tra "nội dung có chứa mã đơn hàng", không cần khớp tuyệt đối.
- **Lưu trữ đơn hàng**: hiện dùng bộ nhớ RAM (mất khi restart server). Nếu cần lưu vĩnh viễn/lịch sử giao dịch, nên thay bằng SQLite hoặc một database thật.
- **Bảo mật webhook**: luôn đặt `SEPAY_API_KEY` để tránh người khác giả mạo request "đã thanh toán" mà không thực sự chuyển tiền.
- Mã QR được sinh qua dịch vụ công khai `img.vietqr.io` (VietQR) — không cần bạn tự tạo QR thủ công.
