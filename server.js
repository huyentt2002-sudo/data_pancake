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


// ==== TẠO TÊN SHEET THEO THÁNG CỦA COMMENT ĐẦU TIÊN ====
function getMonthlySheetName(firstCommentTime) {
  const d = new Date(firstCommentTime);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  return `data_${year}${month}`;  // Ví dụ: data_202512
}


// ==== CHECK SHEET TỒN TẠI → NẾU CHƯA THÌ TẠO ====
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
                gridProperties: { rowCount: 2000, columnCount: 20 }
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

    const { name, message, page, time, first_comment_time } = req.body;

    const phone = extractPhone(message);

    if (!phone) {
      console.log(`⚠️ Không thấy số điện thoại trong comment của ${name}`);
      return res.sendStatus(200);
    }

    // === LẤY THÁNG CỦA COMMENT ĐẦU TIÊN ===
    const monthSheet = getMonthlySheetName(first_comment_time);

    if (!process.env.SPREADSHEET_ID) {
      console.error("SPREADSHEET_ID chưa set");
      return res.sendStatus(500);
    }

    // === TẠO SHEET NẾU CHƯA CÓ ===
    await ensureSheetExists(process.env.SPREADSHEET_ID, monthSheet);

    // === GHI DỮ LIỆU ===
    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: `${monthSheet}!A:E`,
      valueInputOption: "RAW",
      requestBody: {
        values: [[
          name,
          phone,
          page,
          message,
          time || new Date().toISOString()
        ]]
      }
    });

    console.log(`✅ Đã lưu: ${name} - ${phone} - ${page} → sheet ${monthSheet}`);
    res.sendStatus(200);

  } catch (err) {
    console.error("❌ Lỗi webhook:", err);
    res.sendStatus(500);
  }
});


app.get("/", (req, res) => res.send("Pancake Webhook đang chạy!"));

// Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server chạy port ${PORT}`));
