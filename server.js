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

      // Tên sheet theo tháng của comment đầu tiên
      const monthSheet = getMonthlySheetName(firstCommentTime);
      await ensureSheetExists(process.env.SPREADSHEET_ID, monthSheet);

      // Kiểm tra trùng lặp psid + postId
      const rangeCheck = await sheets.spreadsheets.values.get({
        spreadsheetId: process.env.SPREADSHEET_ID,
        range: `${monthSheet}!A:C`
      });
      const rows = rangeCheck.data.values || [];
      const exists = rows.some(r => r[0] === psid && r[1] === postId);
      if (exists) continue;

      // Ghi dữ liệu vào sheet
      await sheets.spreadsheets.values.append({
        spreadsheetId: process.env.SPREADSHEET_ID,
        range: `${monthSheet}!A:F`,
        valueInputOption: "RAW",
        requestBody: {
          values: [[
            psid,            // A: PSID
            postId,          // B: ID bài viết
            pageTitle,       // C: Tên page
            name,            // D: Tên khách
            phone,           // E: SĐT
            formatTimeVN(firstCommentTime) // F: thời gian comment đầu tiên (VN)
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
