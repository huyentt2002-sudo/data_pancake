const express = require("express");
const { google } = require("googleapis");
const app = express();
app.use(express.json());

// ==== GOOGLE AUTH ====
let credentials;
try {
  credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
} catch (err) {
  console.error("Lỗi GOOGLE_SERVICE_ACCOUNT:", err.message);
  process.exit(1);
}

const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"]
});

const sheets = google.sheets({ version: "v4", auth });

// ==== HÀM EXTRACT PHONE ====
function extractPhone(text) {
  if (!text) return null;

  let m1 = text.match(/(\+84|84|0)(3|5|7|8|9)\d{8}/);
  if (m1) return "0" + m1[0].replace("+84", "").replace(/^84/, "").replace(/^0/, "");

  let m2 = text.match(/\d{9}/);
  if (m2) return "0" + m2[0];

  return null;
}

// ==== HÀM CHUYỂN ISO -> GIỜ VIỆT NAM ====
function formatTimeVN(isoString) {
  if (!isoString) return null;
  return new Date(isoString).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
}

// ==== TẠO TÊN SHEET THEO THÁNG ==== (dựa trên thời gian comment đầu tiên)
function getMonthlySheetName(firstCommentTime) {
  const d = new Date(firstCommentTime);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  return `data_${year}${month}`;
}

// ==== CHECK SHEET TỒN TẠI → TẠO NẾU CHƯA CÓ ====
async function ensureSheetExists(sheetId, sheetName) {
  const list = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
  const exists = list.data.sheets.some(s => s.properties.title === sheetName);

  if (!exists) {
    console.log(`➡️ Tạo sheet mới: ${sheetName}`);
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: {
                title: sheetName,
                gridProperties: { rowCount: 2000, columnCount: 10 }
              }
            }
          }
        ]
      }
    });
  }
}

// ==== WEBHOOK ====
app.post("/webhook", async (req, res) => {
  try {
    const { name, page_customer } = req.body;
    const psid = page_customer?.psid;
    const pageId = page_customer?.id;
    const firstCommentTime = page_customer?.activities?.[0]?.inserted_at;

    if (!firstCommentTime) {
      console.log(`⚠️ Không có thời điểm bình luận đầu tiên của ${name}`);
      return res.sendStatus(200);
    }

    // Nếu khách chưa có SĐT thì bỏ qua
    const phone = page_customer?.recent_phone_numbers?.[0] || null;
    if (!phone) {
      console.log(`⚠️ Chưa có số điện thoại của ${name}`);
      return res.sendStatus(200);
    }

    // Chuyển thời gian sang giờ Việt Nam
    const firstCommentTimeVN = formatTimeVN(firstCommentTime);

    // Tên sheet theo tháng
    const monthSheet = getMonthlySheetName(firstCommentTime);

    if (!process.env.SPREADSHEET_ID) {
      console.error("SPREADSHEET_ID chưa set");
      return res.sendStatus(500);
    }

    // Tạo sheet nếu chưa tồn tại
    await ensureSheetExists(process.env.SPREADSHEET_ID, monthSheet);

    // ==== KIỂM TRA TRÙNG LẶP (psid + post_id) ====
    const rangeCheck = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: `${monthSheet}!A:C`
    });
    const rows = rangeCheck.data.values || [];
    const exists = rows.some(r => r[0] === psid && r[1] === pageId);

    if (exists) {
      console.log(`⏩ ${name} đã tồn tại trong bài viết này → không thêm`);
      return res.sendStatus(200);
    }

    // ==== GHI DỮ LIỆU ====
    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: `${monthSheet}!A:E`,
      valueInputOption: "RAW",
      requestBody: {
        values: [[
          psid,             // cột A: PSID khách
          pageId,           // cột B: ID bài viết
          name,             // cột C: Tên khách
          phone,            // cột D: SĐT
          firstCommentTimeVN // cột E: thời điểm bình luận đầu tiên giờ VN
        ]]
      }
    });

    console.log(`✅ Đã lưu: ${name} - ${phone} → sheet ${monthSheet}`);
    res.sendStatus(200);

  } catch (err) {
    console.error("❌ Lỗi webhook:", err);
    res.sendStatus(500);
  }
});

app.get("/", (req, res) => res.send("Webhook Pancake đang chạy!"));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server chạy port ${PORT}`));
