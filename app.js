const SPREADSHEET_ID = "1q1s3uBEqOhu3hXbQiY9NZWshFjDv_cTIH6qkQp_zxac";
const SHEETS_API_URL = "";
const DAY_COUNT = 100;
const DAY_SHEETS = Array.from({ length: DAY_COUNT }, (_, index) => {
  const label = `Day${index + 1}`;
  return { label, sheetName: label };
});
const EXTRA_RUBY_TERMS = [
  { text: "友達", reading: "ともだち" },
];

let sheets = [];
const sheetCache = new Map();

const state = {
  activeIndex: 0,
  rows: [],
  headers: [],
  filter: "",
  showRuby: true,
};

const appShell = document.querySelector("#appShell");
const sidebar = document.querySelector("#sidebar");
const toggleSidebar = document.querySelector("#toggleSidebar");
const sheetTabs = document.querySelector("#sheetTabs");
const activeSheetTitle = document.querySelector("#activeSheetTitle");
const toggleRuby = document.querySelector("#toggleRuby");
const searchInput = document.querySelector("#searchInput");
const statusBox = document.querySelector("#status");
const tableWrap = document.querySelector("#tableWrap");
const table = document.querySelector("#dataTable");
const tableHead = table.querySelector("thead");
const tableBody = table.querySelector("tbody");

function createSheetsFromList(list) {
  return list.map((sheet, index) => ({
    label: sheet.label,
    icon: String(index + 1),
    sheetName: sheet.sheetName ?? sheet.label,
  }));
}

function sheetUrl(sheetName, callbackName) {
  const base = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq`;
  const params = new URLSearchParams({
    tqx: `out:json;responseHandler:${callbackName}`,
  });

  if (sheetName) {
    params.set("sheet", sheetName);
  }

  return `${base}?${params.toString()}`;
}

function worksheetsUrl(callbackName) {
  const base = `https://spreadsheets.google.com/feeds/worksheets/${SPREADSHEET_ID}/public/basic`;
  const params = new URLSearchParams({
    alt: "json-in-script",
    callback: callbackName,
  });

  return `${base}?${params.toString()}`;
}

function parseGooglePayload(payload) {
  if (payload.status === "error") {
    const reason = payload.errors?.[0]?.detailed_message || payload.errors?.[0]?.message || "Google Sheets 回傳錯誤。";
    throw new Error(reason);
  }

  let columns = payload.table.cols.map((col, index) => col.label || `欄位 ${index + 1}`);
  const rows = payload.table.rows.map((row) => {
    return row.c.map((cell) => {
      if (!cell) return "";
      return cell.f ?? cell.v ?? "";
    });
  });

  const hasDefaultColumns = columns.every((column, index) => column === `欄位 ${index + 1}`);
  if (hasDefaultColumns && rows.length) {
    columns = rows[0].map((cell, index) => cell || `欄位 ${index + 1}`);
    rows.shift();
  }

  return { columns, rows };
}

function hasUsableRows(tableData) {
  return tableData.rows.some((row) => row.some((cell) => String(cell).trim() !== ""));
}

function parseWorksheetPayload(payload) {
  const entries = payload.feed?.entry || [];
  return entries
    .map((entry, index) => {
      const label = entry.title?.$t?.trim();
      if (!label) return null;

      return {
        label,
        icon: String(index + 1),
        sheetName: label,
      };
    })
    .filter(Boolean);
}

function loadGoogleJsonp(urlBuilder, errorMessage) {
  return new Promise((resolve, reject) => {
    const callbackName = `handleGoogleResponse_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    const script = document.createElement("script");
    const timeoutId = window.setTimeout(() => {
      cleanup();
      reject(new Error(errorMessage));
    }, 10000);

    const cleanup = () => {
      window.clearTimeout(timeoutId);
      script.remove();
      delete window[callbackName];
    };

    window[callbackName] = (payload) => {
      cleanup();
      resolve(payload);
    };

    script.onerror = () => {
      cleanup();
      reject(new Error(errorMessage));
    };

    script.src = urlBuilder(callbackName);
    document.body.append(script);
  });
}

function loadGoogleSheet(sheetName) {
  return loadGoogleJsonp(
    (callbackName) => sheetUrl(sheetName, callbackName),
    "無法連線到 Google Sheets，請確認試算表分享權限。"
  );
}

function loadSheetsApi(params = {}) {
  return loadGoogleJsonp((callbackName) => {
    const url = new URL(SHEETS_API_URL);
    url.searchParams.set("callback", callbackName);

    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, value);
      }
    });

    return url.toString();
  }, "無法讀取工作表 API。");
}

async function discoverSheets() {
  try {
    const payload = await loadGoogleJsonp(
      worksheetsUrl,
      "無法讀取工作表清單，將使用預設頁籤。"
    );
    const discoveredSheets = parseWorksheetPayload(payload);

    if (discoveredSheets.length) {
      sheets = discoveredSheets;
      state.activeIndex = Math.min(state.activeIndex, sheets.length - 1);
    }
  } catch (error) {
    console.warn(error.message);
  }
}

async function discoverAvailableDaySheets() {
  if (SHEETS_API_URL) {
    setStatus("正在讀取工作表清單...");
    const payload = await loadSheetsApi({ action: "sheets" });
    const apiSheets = payload.sheets || [];

    return createSheetsFromList(apiSheets.map((sheet) => ({
      label: sheet.label || sheet.name,
      sheetName: sheet.sheetName || sheet.name || sheet.label,
    })));
  }

  const candidates = createSheetsFromList(DAY_SHEETS);
  const availableSheets = [];
  const batchSize = 8;

  for (let start = 0; start < candidates.length; start += batchSize) {
    const batch = candidates.slice(start, start + batchSize);
    setStatus(`正在檢查工作表 ${start + 1}-${Math.min(start + batchSize, candidates.length)} / ${candidates.length}...`);

    const results = await Promise.all(
      batch.map(async (sheet) => {
        try {
          const payload = await loadGoogleSheet(sheet.sheetName);
          const tableData = parseGooglePayload(payload);

          if (!hasUsableRows(tableData)) {
            return null;
          }

          sheetCache.set(sheet.sheetName, tableData);
          return sheet;
        } catch (error) {
          return null;
        }
      })
    );

    availableSheets.push(...results.filter(Boolean));
  }

  return availableSheets;
}

function setStatus(message, isError = false) {
  statusBox.textContent = message;
  statusBox.classList.toggle("is-error", isError);
  statusBox.hidden = false;
  tableWrap.hidden = true;
}

function showTable() {
  statusBox.hidden = true;
  tableWrap.hidden = false;
}

function renderTabs() {
  sheetTabs.innerHTML = "";

  sheets.forEach((sheet, index) => {
    const button = document.createElement("button");
    button.className = `tab-button${index === state.activeIndex ? " is-active" : ""}`;
    button.type = "button";
    button.title = sheet.label;
    button.innerHTML = `
      <span class="tab-button__mark" aria-hidden="true">${sheet.icon || index + 1}</span>
      <span class="tab-button__label">${sheet.label}</span>
    `;
    button.addEventListener("click", () => loadSheet(index));
    sheetTabs.append(button);
  });
}

function renderTable() {
  table.classList.toggle("ruby-hidden", !state.showRuby);

  const query = state.filter.trim().toLowerCase();
  const indexedRows = state.rows.map((row, rowIndex) => ({ row, rowIndex }));
  const filteredRows = query
    ? indexedRows.filter(({ row }) => row.some((cell) => String(cell).toLowerCase().includes(query)))
    : indexedRows;
  const rubyTerms = getRubyTerms();

  tableHead.innerHTML = "";
  tableBody.innerHTML = "";

  const headerRow = document.createElement("tr");
  const idHeader = document.createElement("th");
  idHeader.textContent = "ID";
  headerRow.append(idHeader);

  state.headers.forEach((header) => {
    const th = document.createElement("th");
    th.textContent = header;
    headerRow.append(th);
  });
  tableHead.append(headerRow);

  filteredRows.forEach(({ row, rowIndex }) => {
    const tr = document.createElement("tr");
    const idCell = document.createElement("td");
    idCell.textContent = rowIndex + 1;
    tr.append(idCell);

    state.headers.forEach((header, index) => {
      const td = document.createElement("td");
      appendCellContent(td, row[index] ?? "", header, rubyTerms, row);
      tr.append(td);
    });
    tableBody.append(tr);
  });

  if (!filteredRows.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = Math.max(state.headers.length + 1, 1);
    td.textContent = "沒有符合的資料";
    tr.append(td);
    tableBody.append(tr);
  }

  showTable();
}

function getRubyTerms() {
  const { wordIndex, readingIndex } = getVocabularyIndexes();

  if (wordIndex === -1 || readingIndex === -1) {
    return [];
  }

  const seen = new Set();
  const terms = [];

  EXTRA_RUBY_TERMS.forEach((term) => {
    addRubyTerm(terms, seen, term.text, term.reading);
  });

  state.rows.forEach((row) => {
    const word = String(row[wordIndex] || "").trim();
    const reading = String(row[readingIndex] || "").trim();

    addRubyTerm(terms, seen, word, reading);

    const stemTerm = createKanjiStemTerm(word, reading);
    if (stemTerm) {
      addRubyTerm(terms, seen, stemTerm.text, stemTerm.reading);
    }
  });

  return terms.sort((a, b) => b.text.length - a.text.length);
}

function getVocabularyIndexes() {
  return {
    wordIndex: state.headers.findIndex((header) => /單字|単語|單詞|生字|漢字/.test(header)),
    readingIndex: state.headers.findIndex((header) => /讀音|読音|讀法|読み|假名|かな|拼音/.test(header)),
  };
}

function addRubyTerm(terms, seen, text, reading) {
  if (!text || !reading || text === reading) return;

  const key = `${text}::${reading}`;
  if (seen.has(key)) return;

  seen.add(key);
  terms.push({ text, reading });
}

function createKanjiStemTerm(word, reading) {
  const kanjiMatch = word.match(/^([\p{Script=Han}]+)/u);
  if (!kanjiMatch) return null;

  const kanji = kanjiMatch[1];
  const kanaSuffix = word.slice(kanji.length);

  if (!kanaSuffix || !reading.endsWith(kanaSuffix)) {
    return null;
  }

  const readingStem = reading.slice(0, reading.length - kanaSuffix.length);
  if (!readingStem) return null;

  return {
    text: kanji,
    reading: readingStem,
  };
}

function appendCellContent(cell, value, header, rubyTerms, currentRow) {
  const text = String(value);

  if (!isExampleHeader(header)) {
    cell.textContent = text;
    return;
  }

  const exampleReading = getExampleReading(currentRow);
  if (exampleReading) {
    const fragment = createSentenceRubyFragment(text, exampleReading);
    cell.classList.add("has-ruby");
    cell.append(fragment);
    return;
  }

  if (!rubyTerms.length) {
    cell.textContent = text;
    return;
  }

  const excludedTerms = getCurrentRowTerms(currentRow);
  const fragment = createRubyFragment(text, rubyTerms, excludedTerms);
  if (fragment.childNodes.length === 1 && fragment.textContent === text) {
    cell.textContent = text;
    return;
  }

  cell.classList.add("has-ruby");
  cell.append(fragment);
}

function isExampleHeader(header) {
  const normalizedHeader = String(header).trim().replace(/[【】\[\]()（）]/g, "");
  return /^(例句|例文|例句漢字|句子|造句)$/.test(normalizedHeader);
}

function isExampleReadingHeader(header) {
  const normalizedHeader = String(header).trim().replace(/[【】\[\]()（）]/g, "");
  return /^(例句讀音|例句读音|例文讀音|例文读音|例句読み|例文読み|例句假名|例文假名|例句かな|例文かな)$/.test(normalizedHeader);
}

function getExampleReading(row) {
  const readingIndex = state.headers.findIndex(isExampleReadingHeader);
  if (readingIndex === -1) return "";

  return String(row[readingIndex] || "").trim();
}

function createSentenceRubyFragment(text, reading) {
  const fragment = document.createDocumentFragment();
  const normalizedReading = normalizeReadingText(reading);
  let textIndex = 0;
  let readingIndex = 0;

  while (textIndex < text.length) {
    const char = text[textIndex];

    if (!isKanji(char)) {
      fragment.append(document.createTextNode(char));
      readingIndex = consumeMatchingReading(normalizedReading, readingIndex, char);
      textIndex += 1;
      continue;
    }

    let kanjiEnd = textIndex + 1;
    while (kanjiEnd < text.length && isKanji(text[kanjiEnd])) {
      kanjiEnd += 1;
    }

    const kanjiText = text.slice(textIndex, kanjiEnd);
    const nextAnchor = findNextKanaAnchor(text, kanjiEnd);
    let rubyReading = "";

    if (nextAnchor) {
      const nextReadingIndex = normalizedReading.indexOf(nextAnchor, readingIndex);
      if (nextReadingIndex >= readingIndex) {
        rubyReading = normalizedReading.slice(readingIndex, nextReadingIndex);
        readingIndex = nextReadingIndex;
      }
    } else {
      rubyReading = normalizedReading.slice(readingIndex).replace(/[。．、，,.!?！？\s]/g, "");
      readingIndex = normalizedReading.length;
    }

    if (rubyReading) {
      const ruby = document.createElement("ruby");
      ruby.textContent = kanjiText;

      const rt = document.createElement("rt");
      rt.textContent = rubyReading;
      ruby.append(rt);
      fragment.append(ruby);
    } else {
      fragment.append(document.createTextNode(kanjiText));
    }

    textIndex = kanjiEnd;
  }

  return fragment;
}

function normalizeReadingText(text) {
  return String(text)
    .replace(/\s+/g, "")
    .replace(/[【】\[\]()（）]/g, "");
}

function isKanji(char) {
  return /\p{Script=Han}/u.test(char);
}

function isKana(char) {
  return /[\u3040-\u309f\u30a0-\u30ffー]/.test(char);
}

function findNextKanaAnchor(text, start) {
  let anchor = "";

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];

    if (isKana(char)) {
      anchor += char;
      continue;
    }

    if (anchor) break;
  }

  return anchor ? normalizeReadingText(anchor) : "";
}

function consumeMatchingReading(reading, start, char) {
  const normalizedChar = normalizeReadingText(char);
  if (!normalizedChar) return start;

  return reading.startsWith(normalizedChar, start) ? start + normalizedChar.length : start;
}

function getCurrentRowTerms(row) {
  const { wordIndex, readingIndex } = getVocabularyIndexes();
  const excluded = new Set();

  if (wordIndex === -1 || readingIndex === -1) {
    return excluded;
  }

  const word = String(row[wordIndex] || "").trim();
  const reading = String(row[readingIndex] || "").trim();
  const stemTerm = createKanjiStemTerm(word, reading);

  if (word) {
    excluded.add(word);
  }

  if (stemTerm?.text) {
    excluded.add(stemTerm.text);
  }

  return excluded;
}

function createRubyFragment(text, rubyTerms, excludedTerms) {
  const fragment = document.createDocumentFragment();
  let cursor = 0;

  while (cursor < text.length) {
    const next = findNextRubyTerm(text, cursor, rubyTerms, excludedTerms);

    if (!next) {
      fragment.append(document.createTextNode(text.slice(cursor)));
      break;
    }

    if (next.index > cursor) {
      fragment.append(document.createTextNode(text.slice(cursor, next.index)));
    }

    const ruby = document.createElement("ruby");
    ruby.textContent = next.term.text;

    const rt = document.createElement("rt");
    rt.textContent = next.term.reading;
    ruby.append(rt);
    fragment.append(ruby);

    cursor = next.index + next.term.text.length;
  }

  return fragment;
}

function findNextRubyTerm(text, start, rubyTerms, excludedTerms) {
  let match = null;

  rubyTerms.forEach((term) => {
    if (excludedTerms.has(term.text)) return;

    const index = text.indexOf(term.text, start);
    if (index === -1) return;

    if (!match || index < match.index || (index === match.index && term.text.length > match.term.text.length)) {
      match = { index, term };
    }
  });

  return match;
}

async function loadSheet(index) {
  state.activeIndex = index;
  state.filter = searchInput.value;
  renderTabs();

  const sheet = sheets[index];
  activeSheetTitle.textContent = sheet.label;
  setStatus("正在讀取資料...");

  try {
    let tableData = sheetCache.get(sheet.sheetName);

    if (!tableData) {
      const payload = await loadGoogleSheet(sheet.sheetName);
      tableData = parseGooglePayload(payload);
      sheetCache.set(sheet.sheetName, tableData);
    }

    const { columns, rows } = tableData;
    state.headers = columns;
    state.rows = rows;
    renderTable();
  } catch (error) {
    setStatus(error.message || "無法讀取試算表資料。", true);
  }
}

toggleSidebar.addEventListener("click", () => {
  const collapsed = sidebar.classList.toggle("is-collapsed");
  appShell.classList.toggle("is-sidebar-collapsed", collapsed);
  toggleSidebar.setAttribute("aria-label", collapsed ? "展開側欄" : "收合側欄");
  toggleSidebar.setAttribute("title", collapsed ? "展開側欄" : "收合側欄");
});

searchInput.addEventListener("input", (event) => {
  state.filter = event.target.value;
  renderTable();
});

toggleRuby.addEventListener("click", () => {
  state.showRuby = !state.showRuby;
  table.classList.toggle("ruby-hidden", !state.showRuby);
  toggleRuby.textContent = state.showRuby ? "隱藏讀音" : "顯示讀音";
});

async function init() {
  renderTabs();
  const availableSheets = await discoverAvailableDaySheets();

  if (!availableSheets.length) {
    setStatus("目前 Day1-Day100 沒有可顯示的資料。", true);
    return;
  }

  sheets = availableSheets;
  state.activeIndex = 0;
  renderTabs();
  loadSheet(0);
}

init();
