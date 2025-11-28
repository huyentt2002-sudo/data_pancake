const express = require("express");
const { google } = require("googleapis");
const app = express();

app.use(express.json());

// Cấu hình Google Sheets từ biến môi trường
// Trên Render bạn tạo ENV: GOOGLE_SERVICE_ACCOUNT = toàn bộ JSON của service account
const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);

const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"]
});

const sheets = google.sheets({ version: "v4", auth });

// Hàm chuẩn hóa số điện thoại
function extractPhone(comment) {
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
  return `data_${year}${month}`; // Ví dụ: data_202511
}

// Webhook nhận từ Pancake
app.post("/webhook", async (req, res) => {
  try {
    const { message, name, page, time } = req.body;
    const phone = extractPhone(message);

    if (!phone) {
      console.log(`Không tìm thấy số trong comment của ${name}`);
      return res.sendStatus(200);
    }

    const monthSheetName = getMonthlySheetName();

    // Thêm dữ liệu vào Google Sheets
    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.SPREADSHEET_ID, // Tạo ENV SPREADSHEET_ID = ID sheet chính
      range: `${monthSheetName}!A:E`,
      valueInputOption: "RAW",
      requestBody: {
        values: [[name, phone, page, message, time || new Date().toISOString()]]
      }
    });

    console.log(`Đã lưu: ${name} - ${phone} - ${page} vào ${monthSheetName}`);
    res.sendStatus(200);

  } catch (err) {
    console.error(err);
    res.sendStatus(500);
  }
});

app.get("/", (req, res) => res.send("Pancake Webhook đang chạy!"));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log("Server webhook chạy port", PORT));
