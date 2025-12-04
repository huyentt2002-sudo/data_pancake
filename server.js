const express = require("express");
const { google } = require("googleapis");
const app = express();
app.use(express.json());

// ==== GOOGLE AUTH ====
let credentials;
if (!process.env.GOOGLE_SERVICE_ACCOUNT) {
  console.error("❌ GOOGLE_SERVICE_ACCOUNT chưa set!");
} else {
  try {
    credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
  } catch (err) {
    console.error("❌ Lỗi parse GOOGLE_SERVICE_ACCOUNT:", err.message);
  }
}

const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"]
});

const sheets = google.sheets({ version: "v4", auth });

// ==== HÀM CHUYỂN ISO -> GIỜ VIỆT NAM ====
function formatTimeVN(isoString) {
  if (!isoString) return null;
  return new Date(isoString).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
}

// ==== TẠO TÊN SHEET THEO THÁNG ====
function getMonthlySheetName(firstCommentTime) {
  const d = new Date(firstCommentTime);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  return `data_${year}${month}`;
}

// ==== CHECK SHEET TỒN TẠI → TẠO NẾU CHƯA CÓ ====
async function ensureSheetExists(sheetId, sheetName) {
  if (!sheetId) {
    console.error("❌ SPREADSHEET_ID chưa set!");
    return;
  }
  try {
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
  } catch (err) {
    console.error("❌ Lỗi ensureSheetExists:", err.message);
  }
}

// ==== WEBHOOK ====
app.post("/webhook", async (req, res) => {
  try {
    console.log("📥 Webhook nhận:", JSON.stringify(req.body, null, 2));

    const { name, page_customer } = req.body;
    if (!page_customer) return res.sendStatus(200);

    const psid = page_customer.psid;
    const phone = page_customer?.recent_phone_numbers?.[0]?.phone_number || null;
    if (!phone) return res.sendStatus(200);

    const activities = page_customer.activities || [];
    if (!activities.length) return res.sendStatus(200);

    for (let act of activities) {
      const postId = act.post_id;
      const pageTitle = act.attachments?.data?.[0]?.title || "Unknown";
      const firstCommentTime = act.inserted_at;
      if (!firstCommentTime) continue;

      const monthSheet = getMonthlySheetName(firstCommentTime);
      await ensureSheetExists(process.env.SPREADSHEET_ID, monthSheet);

      // Kiểm tra trùng lặp psid + postId
      const rangeCheck = await sheets.spreadsheets.values.get({
        spreadsheetId: process.env.SPREADSHEET_ID,
        range: `${monthSheet}!A:B`
      });
      const rows = rangeCheck.data.values || [];
      if (rows.some(r => r[0] === psid && r[1] === postId)) continue;

      // Ghi dữ liệu
      await sheets.spreadsheets.values.append({
        spreadsheetId: process.env.SPREADSHEET_ID,
        range: `${monthSheet}!A:F`,
        valueInputOption: "RAW",
        requestBody: {
          values: [[
            psid, postId, pageTitle, name, phone, formatTimeVN(firstCommentTime)
          ]]
        }
      });

      console.log(`✅ Đã lưu: ${name} - ${phone} - ${pageTitle} → sheet ${monthSheet}`);
    }

    res.sendStatus(200);

  } catch (err) {
    console.error("❌ Lỗi webhook:", err);
    res.sendStatus(500);
  }
});

app.get("/", (req, res) => res.send("Webhook Pancake đang chạy!"));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server chạy port ${PORT}`));
