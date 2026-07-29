require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ====== CẤU HÌNH (đọc từ file .env) ======
const BANK_ID = process.env.BANK_ID || 'MB';                 // Mã ngân hàng VietQR (MB = MB Bank)
const ACCOUNT_NO = process.env.ACCOUNT_NO || '0349882514';   // Số tài khoản của bạn
const ACCOUNT_NAME = process.env.ACCOUNT_NAME || 'DUONG NGUYEN GIA BAO';
const AMOUNT = parseInt(process.env.AMOUNT || '15000', 10);  // Số tiền cố định
const DEFAULT_REDIRECT = process.env.DEFAULT_REDIRECT || 'https://example.com/thank-you';
const SEPAY_API_KEY = process.env.SEPAY_API_KEY || '';       // API Key bạn đặt trong SePay -> để xác thực webhook
const ORDER_TTL_MS = 30 * 60 * 1000; // đơn hết hạn sau 30 phút

// Lưu đơn hàng trong bộ nhớ (đơn giản, phù hợp cho lưu lượng nhỏ/vừa).
// Nếu cần bền vững hơn (restart server không mất dữ liệu), thay bằng SQLite/Redis.
const orders = new Map();

function cleanupOldOrders() {
  const now = Date.now();
  for (const [code, order] of orders.entries()) {
    if (now - order.createdAt > ORDER_TTL_MS) orders.delete(code);
  }
}
setInterval(cleanupOldOrders, 5 * 60 * 1000);

// Sinh mã đơn hàng ngắn, duy nhất, chỉ gồm chữ+số (để nằm gọn trong nội dung chuyển khoản)
function generateOrderCode() {
  return 'DH' + crypto.randomBytes(4).toString('hex').toUpperCase();
}

// ====== API: Tạo đơn hàng mới + link QR ======
app.post('/api/create-order', (req, res) => {
  const redirect = (req.body && req.body.redirect) || DEFAULT_REDIRECT;

  let orderCode;
  do {
    orderCode = generateOrderCode();
  } while (orders.has(orderCode));

  orders.set(orderCode, {
    amount: AMOUNT,
    redirect,
    paid: false,
    createdAt: Date.now(),
  });

  const qrUrl =
    `https://img.vietqr.io/image/${encodeURIComponent(BANK_ID)}-${encodeURIComponent(ACCOUNT_NO)}-compact2.png` +
    `?amount=${AMOUNT}&addInfo=${encodeURIComponent(orderCode)}&accountName=${encodeURIComponent(ACCOUNT_NAME)}`;

  res.json({
    orderCode,
    qrUrl,
    amount: AMOUNT,
    accountNo: ACCOUNT_NO,
    accountName: ACCOUNT_NAME,
  });
});

// ====== API: Frontend hỏi trạng thái thanh toán ======
app.get('/api/order-status/:orderCode', (req, res) => {
  const order = orders.get(req.params.orderCode);
  if (!order) return res.status(404).json({ error: 'Không tìm thấy đơn hàng' });
  res.json({ paid: order.paid, redirect: order.paid ? order.redirect : null });
});

// ====== Webhook nhận từ SePay khi có giao dịch ======
// Cấu hình trong SePay: URL = https://<domain-cua-ban>/api/sepay-webhook
// Nhớ đặt "API Key" trong SePay giống với SEPAY_API_KEY trong .env để bảo mật webhook.
app.post('/api/sepay-webhook', (req, res) => {
  // Xác thực: SePay gửi header Authorization: Apikey <key>
  if (SEPAY_API_KEY) {
    const auth = req.headers['authorization'] || '';
    if (auth !== `Apikey ${SEPAY_API_KEY}`) {
      return res.status(401).json({ success: false, message: 'Sai API Key' });
    }
  }

  const body = req.body || {};
  // Các field phổ biến SePay gửi: transferType, transferAmount, content, code, description
  const content = (body.content || body.description || '').toUpperCase();
  const transferAmount = Number(body.transferAmount || body.amount || 0);
  const transferType = body.transferType || body.transfer_type; // "in" = tiền vào

  if (transferType && transferType !== 'in') {
    return res.json({ success: true, message: 'Bỏ qua giao dịch không phải tiền vào' });
  }

  // Tìm đơn hàng chưa thanh toán có mã nằm trong nội dung chuyển khoản và đúng số tiền
  let matched = null;
  for (const [orderCode, order] of orders.entries()) {
    if (order.paid) continue;
    if (content.includes(orderCode) && transferAmount === order.amount) {
      matched = orderCode;
      break;
    }
  }

  if (matched) {
    orders.get(matched).paid = true;
    console.log(`✅ Đơn hàng ${matched} đã được thanh toán (${transferAmount}đ)`);
  } else {
    console.log('⚠️  Giao dịch không khớp đơn hàng nào:', content, transferAmount);
  }

  // Luôn trả 200 để SePay biết đã nhận thành công
  res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server đang chạy tại http://localhost:${PORT}`);
});
