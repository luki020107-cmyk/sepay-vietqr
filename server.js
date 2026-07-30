require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ====== CẤU HÌNH NGÂN HÀNG (đọc từ .env) ======
const BANK_ID = process.env.BANK_ID || 'MB';
const ACCOUNT_NO = process.env.ACCOUNT_NO || '0349882514';
const ACCOUNT_NAME = process.env.ACCOUNT_NAME || 'DUONG NGUYEN GIA BAO';
const ORDER_TTL_MS = 30 * 60 * 1000; // đơn hết hạn sau 30 phút

// ====== ĐỌC DANH SÁCH SẢN PHẨM TỪ products.json ======
// Mỗi sản phẩm có: amount (số tiền), redirect (link chuyển hướng sau khi trả tiền), label (tên hiển thị)
// Muốn thêm/sửa sản phẩm: sửa file products.json, commit, push lên GitHub -> Render tự deploy lại.
const PRODUCTS_FILE = path.join(__dirname, 'products.json');

function loadProducts() {
  try {
    const raw = fs.readFileSync(PRODUCTS_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (e) {
    console.error('Không đọc được products.json, dùng cấu hình mặc định:', e.message);
    return {
      default: {
        amount: 15000,
        redirect: process.env.DEFAULT_REDIRECT || 'https://example.com/thank-you',
        label: 'Thanh toán mặc định',
      },
    };
  }
}

// Lưu đơn hàng trong bộ nhớ
const orders = new Map();

function cleanupOldOrders() {
  const now = Date.now();
  for (const [code, order] of orders.entries()) {
    if (now - order.createdAt > ORDER_TTL_MS) orders.delete(code);
  }
}
setInterval(cleanupOldOrders, 5 * 60 * 1000);

function generateOrderCode() {
  return 'DH' + crypto.randomBytes(4).toString('hex').toUpperCase();
}

// ====== API: Lấy thông tin 1 sản phẩm (để hiển thị tên/giá trước khi tạo đơn) ======
app.get('/api/product/:code', (req, res) => {
  const products = loadProducts();
  const product = products[req.params.code] || products['default'];
  if (!product) return res.status(404).json({ error: 'Không tìm thấy sản phẩm' });
  res.json({ amount: product.amount, label: product.label || req.params.code });
});

// ====== API: Tạo đơn hàng mới + link QR ======
// Server tự lấy amount/redirect từ products.json theo "product code" -> KHÔNG tin dữ liệu amount/redirect do client tự gửi lên (bảo mật)
app.post('/api/create-order', (req, res) => {
  const products = loadProducts();
  const productCode = (req.body && req.body.product) || 'default';
  const product = products[productCode] || products['default'];

  if (!product) {
    return res.status(400).json({ error: 'Cấu hình sản phẩm không hợp lệ' });
  }

  let orderCode;
  do {
    orderCode = generateOrderCode();
  } while (orders.has(orderCode));

  orders.set(orderCode, {
    amount: product.amount,
    redirect: product.redirect,
    paid: false,
    createdAt: Date.now(),
  });

  const qrUrl =
    `https://img.vietqr.io/image/${encodeURIComponent(BANK_ID)}-${encodeURIComponent(ACCOUNT_NO)}-compact2.png` +
    `?amount=${product.amount}&addInfo=${encodeURIComponent(orderCode)}&accountName=${encodeURIComponent(ACCOUNT_NAME)}`;

  res.json({
    orderCode,
    qrUrl,
    amount: product.amount,
    label: product.label || productCode,
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
app.post('/api/sepay-webhook', (req, res) => {
  const SEPAY_API_KEY = process.env.SEPAY_API_KEY || '';
  if (SEPAY_API_KEY) {
    const auth = req.headers['authorization'] || '';
    if (auth !== `Apikey ${SEPAY_API_KEY}`) {
      return res.status(401).json({ success: false, message: 'Sai API Key' });
    }
  }

  const body = req.body || {};
  const content = (body.content || body.description || '').toUpperCase();
  const transferAmount = Number(body.transferAmount || body.amount || 0);
  const transferType = body.transferType || body.transfer_type;

  if (transferType && transferType !== 'in') {
    return res.json({ success: true, message: 'Bỏ qua giao dịch không phải tiền vào' });
  }

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

  res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server đang chạy tại http://localhost:${PORT}`);
});
