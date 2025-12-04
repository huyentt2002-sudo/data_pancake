const express = require("express");
const { google } = require("googleapis");
const app = express();
app.use(express.json());

// Lấy credentials từ ENV an toàn
let credentials;
try {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT) throw new Error("GOOGLE_SERVICE_ACCOUNT chưa set");
  credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
} catch (err) {
  console.error("Lỗi lấy GOOGLE_SERVICE_ACCOUNT:", err.message);
  process.exit(1); // dừng server nếu chưa có ENV
}

// Tạo auth Google Sheets
const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"]
});

const sheets = google.sheets({ version: "v4", auth });

// Hàm chuẩn hóa số điện thoại
function extractPhone(comment) {
  if (!comment) return null;
  let full = comment.match(/(03|05|07|08|09)[0-9]{8}/);
  if (full) return full[0];

  let intl = comment.match(/(\+?84)[0-9]{9}/);
  if (intl) return "0" + intl[0].replace("+84", "");

  let nine = comment.match(/[0-9]{9}/);
  if (nine) return "0" + nine[0];

  return null;
}

// Hàm lấy tên sheet theo tháng
function getMonthlySheetName() {
  const now = new Date();
  const year = now.getFullYear();
  const month = (now.getMonth() + 1).toString().padStart(2, "0");
  return `data_${year}${month}`;
}

// Webhook nhận từ Pancake
app.post("/webhook", async (req, res) => {
  try {
    console.log("Webhook nhận:", JSON.stringify(req.body, null, 2));
    const phone = extractPhone(message);

    if (!phone) {
      console.log(`Không tìm thấy số trong comment của ${name}`);
      return res.sendStatus(200);
    }

    const monthSheetName = getMonthlySheetName();

    if (!process.env.SPREADSHEET_ID) {
      console.error("SPREADSHEET_ID chưa set trong ENV");
      return res.sendStatus(500);
    }

    // Thêm dữ liệu vào Google Sheets
    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: `${monthSheetName}!A:E`,
      valueInputOption: "RAW",
      requestBody: {
        values: [[name, phone, page, message, time || new Date().toISOString()]]
      }
    });

    console.log(`Đã lưu: ${name} - ${phone} - ${page} vào ${monthSheetName}`);
    res.sendStatus(200);

  } catch (err) {
    console.error("Lỗi webhook:", err);
    res.sendStatus(500);
  }
});

// Route test
app.get("/", (req, res) => res.send("Pancake Webhook đang chạy!"));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server webhook chạy port ${PORT}`));

