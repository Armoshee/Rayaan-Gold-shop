function doGet(e) {
  var params = getParams(e);
  var action = String(params.action || "health").toLowerCase();

  if (action === "gettransactions") {
    try {
      var spreadsheet = getSpreadsheet(params.spreadsheetId);
      return jsonResponse({
        status: "success",
        action: "getTransactions",
        history: getTransactionsFromSheet(spreadsheet)
      });
    } catch (error) {
      return jsonResponse({ status: "error", message: String(error) });
    }
  }

  return jsonResponse({
    status: "ok",
    message: "Web app is live",
    timestamp: new Date().toISOString()
  });
}

function doPost(e) {
  var params = getParams(e);
  var action = String(params.action || "saveTransaction").toLowerCase();
  var spreadsheet = getSpreadsheet(params.spreadsheetId);

  try {
    if (action === "logactivity") {
      appendActivityLog(spreadsheet, params);
      return jsonResponse({ status: "success", action: "logActivity" });
    }

    if (!params.type || !params.product) {
      return jsonResponse({
        status: "skipped",
        action: "saveTransaction",
        message: "Missing required fields: type/product"
      });
    }

    appendTransactionLog(spreadsheet, params);
    return jsonResponse({ status: "success", action: "saveTransaction" });
  } catch (error) {
    return jsonResponse({ status: "error", message: String(error) });
  }
}

function appendTransactionLog(spreadsheet, params) {
  var headers = [
    "Timestamp",
    "Product",
    "Type",
    "Quantity",
    "Total Gram Weight",
    "Gram Price",
    "Total Gram Amount",
    "Making Charges (Rs)",
    "GST %",
    "GST Amount (Rs)",
    "Making Charges %",
    "Discount %",
    "Discount (Rs)",
    "Net Amount",
    "Stock After"
  ];

  var quantity = toNumber(params.quantity);
  var totalGramWeight = firstPositive(params.totalGramWeight, quantity);
  var gramPrice = firstPositive(params.gramPrice, params.purchaseGramPrice);
  var totalGramAmount = firstPositive(params.totalGramAmount, totalGramWeight * gramPrice);
  var wastagePercent = toNumber(params.wastagePercent);
  var makingCharges = firstPositive(params.makingChargesAmount, totalGramAmount * (wastagePercent / 100));
  var gstPercent = toNumber(params.gstPercent);
  var type = String(params.type || "").toUpperCase();
  if (type === "PURCHASE" && gstPercent <= 0) {
    gstPercent = 3;
  }
  var gstAmount = firstPositive(params.gstAmount, (totalGramAmount + makingCharges) * (gstPercent / 100));
  var discountPercent = toNumber(params.discountPercent);
  var discountAmount = firstPositive(params.discountAmount, (totalGramAmount + makingCharges + gstAmount) * (discountPercent / 100));
  var netAmount = firstPositive(params.netAmount, totalGramAmount + makingCharges + gstAmount - discountAmount);

  var row = [
    params.date || new Date().toISOString(),
    params.product || "",
    params.type || "",
    asCellNumber(quantity),
    asCellNumber(totalGramWeight),
    asCellNumber(gramPrice),
    asCellNumber(totalGramAmount),
    asCellNumber(makingCharges),
    asCellNumber(gstPercent),
    asCellNumber(gstAmount),
    asCellNumber(wastagePercent),
    asCellNumber(discountPercent),
    asCellNumber(discountAmount),
    asCellNumber(netAmount),
    params.stockAfter || "0"
  ];

  var targetSheetName = type === "SALE"
    ? findOrCreateSheetName(spreadsheet, ["Sales_History", "Sales History"])
    : findOrCreateSheetName(spreadsheet, ["Stock History", "Stock_History"]);
  var transactionSheetName = findOrCreateSheetName(spreadsheet, ["Transactions", "Transaction History"]);

  appendWithHeader(spreadsheet, transactionSheetName, headers, row);
  appendWithHeader(spreadsheet, targetSheetName, headers, row);
}

function findOrCreateSheetName(spreadsheet, candidates) {
  for (var i = 0; i < candidates.length; i += 1) {
    var existing = spreadsheet.getSheetByName(candidates[i]);
    if (existing) {
      return candidates[i];
    }
  }

  var preferredName = candidates[0];
  spreadsheet.insertSheet(preferredName);
  return preferredName;
}

function toNumber(value) {
  var num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function firstPositive(primary, fallback) {
  var first = toNumber(primary);
  if (first > 0) {
    return first;
  }

  return toNumber(fallback);
}

function asCellNumber(value) {
  return toNumber(value).toFixed(2);
}

function appendActivityLog(spreadsheet, params) {
  var headers = ["Timestamp", "Product", "Field Name", "Old Value", "New Value"];
  var row = [
    params.timestamp || new Date().toISOString(),
    params.product || "",
    params.fieldName || "",
    params.oldValue || "",
    params.newValue || ""
  ];

  appendWithHeader(spreadsheet, "Activity_Log", headers, row);
}

function appendWithHeader(spreadsheet, sheetName, headers, row) {
  var sheet = spreadsheet.getSheetByName(sheetName);

  if (!sheet) {
    sheet = spreadsheet.insertSheet(sheetName);
  }

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
  }

  sheet.appendRow(row);
  applySheetFormatting(sheet, headers.length);
}

function getTransactionsFromSheet(spreadsheet) {
  var sheet = spreadsheet.getSheetByName("Transactions");
  if (!sheet || sheet.getLastRow() < 2) {
    return [];
  }

  var values = sheet.getDataRange().getValues();
  var headers = values[0];
  var indexMap = {};
  headers.forEach(function (header, idx) {
    indexMap[String(header).trim()] = idx;
  });

  var out = [];
  for (var r = 1; r < values.length; r += 1) {
    var row = values[r];
    var type = String(getCell(row, indexMap, "Type")).toUpperCase();
    if (type !== "SALE" && type !== "PURCHASE") {
      continue;
    }

    out.push({
      product: String(getCell(row, indexMap, "Product") || ""),
      type: type,
      qty: toNumber(getCell(row, indexMap, "Quantity")),
      purity: "22kt",
      totalGramWeight: toNumber(getCell(row, indexMap, "Total Gram Weight")),
      gramPrice: toNumber(getCell(row, indexMap, "Gram Price")),
      totalGramAmount: toNumber(getCell(row, indexMap, "Total Gram Amount")),
      makingCharges: toNumber(getCell(row, indexMap, "Making Charges (Rs)")),
      gstPercent: toNumber(getCell(row, indexMap, "GST %")),
      gstAmount: toNumber(getCell(row, indexMap, "GST Amount (Rs)")),
      wastagePercent: toNumber(getCell(row, indexMap, "Making Charges %")),
      discountPercent: toNumber(getCell(row, indexMap, "Discount %")),
      discountAmount: toNumber(getCell(row, indexMap, "Discount (Rs)")),
      netAmount: toNumber(getCell(row, indexMap, "Net Amount")),
      stockAfter: toNumber(getCell(row, indexMap, "Stock After")),
      date: String(getCell(row, indexMap, "Timestamp") || new Date().toISOString())
    });
  }

  return out;
}

function getCell(row, indexMap, headerName) {
  if (!(headerName in indexMap)) {
    return "";
  }
  return row[indexMap[headerName]];
}

function applySheetFormatting(sheet, columnCount) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 1) {
    return;
  }

  sheet.setFrozenRows(1);
  sheet.setRowHeight(1, 34);

  var headerRange = sheet.getRange(1, 1, 1, columnCount);
  headerRange
    .setFontWeight("bold")
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle")
    .setWrap(true);

  if (lastRow > 1) {
    var dataRange = sheet.getRange(2, 1, lastRow - 1, columnCount);
    dataRange
      .setHorizontalAlignment("center")
      .setVerticalAlignment("middle");
  }

  sheet.autoResizeColumns(1, columnCount);
}

function getSpreadsheet(incomingSheetId) {
  var sheetId = String(incomingSheetId || SPREADSHEET_ID || "").trim();

  if (sheetId) {
    return SpreadsheetApp.openById(sheetId);
  }

  var active = SpreadsheetApp.getActiveSpreadsheet();
  if (!active) {
    throw new Error("Spreadsheet not found. Pass spreadsheetId in payload or set SPREADSHEET_ID.");
  }

  return active;
}

function getParams(e) {
  var params = {};

  if (e && e.parameter) {
    Object.keys(e.parameter).forEach(function (key) {
      params[key] = e.parameter[key];
    });
  }

  if ((!params || Object.keys(params).length === 0) && e && e.postData && e.postData.contents) {
    try {
      var parsed = JSON.parse(e.postData.contents);
      if (parsed && typeof parsed === "object") {
        Object.keys(parsed).forEach(function (key) {
          params[key] = parsed[key];
        });
      }
    } catch (error) {
      // Ignore non-JSON payloads; form data is already available in e.parameter.
    }
  }

  return params;
}

function jsonResponse(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

const SPREADSHEET_ID = "1Trr5aVWo4pBIz5tx9mtWbmj5KVjLeAs6tfLjK9u0FeU";

const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzx5ZEl9xdjnUa8wf8T61LfyEpcWhCv4xpLp4SwLqFYuK6dr8ImGv-92OX9cUcZz424/exec";