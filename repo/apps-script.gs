const SPREADSHEET_ID = "1q1s3uBEqOhu3hXbQiY9NZWshFjDv_cTIH6qkQp_zxac";

function doGet(event) {
  const callback = event.parameter.callback || "callback";
  const action = event.parameter.action || "sheets";
  const payload = action === "sheets" ? getSheets() : { error: "Unknown action" };

  return ContentService
    .createTextOutput(`${callback}(${JSON.stringify(payload)});`)
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

function getSheets() {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheets = spreadsheet
    .getSheets()
    .map((sheet) => sheet.getName())
    .filter((name) => /^Day\d+$/i.test(name))
    .sort((a, b) => Number(a.replace(/\D/g, "")) - Number(b.replace(/\D/g, "")))
    .map((name) => ({
      label: name,
      sheetName: name,
    }));

  return { sheets };
}
