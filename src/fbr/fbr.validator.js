import { fail } from "../middleware/validation.js";
export function validatePayload(p, config) {
  const errors = [];
  for (const k of [
    "sellerNTNCNIC",
    "sellerBusinessName",
    "sellerProvince",
    "sellerAddress",
    "buyerBusinessName",
    "buyerProvince",
    "buyerAddress",
    "buyerRegistrationType",
  ])
    if (!p[k]) errors.push(`${k} is required`);
  if (!/^([A-Za-z0-9]{7}|\d{13})$/.test(p.sellerNTNCNIC))
    errors.push("Seller NTN/CNIC is invalid");
  if (
    (p.buyerRegistrationType === "Registered" || p.buyerNTNCNIC) &&
    !/^([A-Za-z0-9]{7}|\d{13})$/.test(p.buyerNTNCNIC)
  )
    errors.push("Buyer NTN/CNIC is invalid");
  if (!["Registered", "Unregistered"].includes(p.buyerRegistrationType))
    errors.push("Invalid buyer registration type");
  if (
    config.appEnv === "sandbox" &&
    !/^SN0(0[1-9]|1\d|2[0-8])$/.test(p.scenarioId)
  )
    errors.push("Select a sandbox scenario SN001–SN028");
  if (
    config.appEnv === "sandbox" &&
    p.scenarioId === "SN002" &&
    p.buyerRegistrationType !== "Unregistered"
  )
    errors.push("SN002 requires an Unregistered buyer");
  if (p.invoiceType === "Debit Note" && !p.invoiceRefNo)
    errors.push("Debit notes require an original FBR invoice reference");
  p.items.forEach((i, index) => {
    if (
      !/^\d{4}\.\d{4}$/.test(i.hsCode) ||
      !i.uoM ||
      !i.saleType ||
      !/^(Exempt|(100|\d{1,2})(\.\d{1,4})?%)$/.test(i.rate)
    )
      errors.push(`Item ${index + 1}: check HS code, UOM, sale type and rate`);
    if (!(i.quantity > 0))
      errors.push(`Item ${index + 1}: quantity must be positive`);
  });
  if (errors.length) fail(400, errors.join("; "));
}
export function interpretResponse(response, operation, httpStatus) {
  const v = response?.validationResponse;
  const items = v?.invoiceStatuses;
  const validItems =
    items == null ||
    (Array.isArray(items) &&
      items.every(
        (i) =>
          i.statusCode === "00" &&
          String(i.status).toLowerCase() === "valid" &&
          !i.error &&
          !i.errorCode,
      ));
  const valid =
    httpStatus >= 200 &&
    httpStatus < 300 &&
    v?.statusCode === "00" &&
    String(v?.status).toLowerCase() === "valid" &&
    !v.error &&
    !v.errorCode &&
    validItems;
  const invoiceNumber =
    typeof response?.invoiceNumber === "string" && response.invoiceNumber.trim()
      ? response.invoiceNumber.trim()
      : null;
  // A partial success or invoice number with contradictory status must be reconciled manually.
  const partial = Array.isArray(items) && items.some((i) => i.invoiceNo);
  const rejected =
    httpStatus >= 200 &&
    httpStatus < 300 &&
    !!v &&
    !invoiceNumber &&
    !partial &&
    (v.statusCode === "01" ||
      (Array.isArray(items) && items.some((i) => i.statusCode === "01")));
  const itemErrors = Array.isArray(items)
    ? items
        .map((item, index) =>
          item.error || item.errorCode
            ? `Item ${item.itemSNo || index + 1}${item.errorCode ? ` [${item.errorCode}]` : ""}: ${item.error || "FBR rejected the item"}`
            : "",
        )
        .filter(Boolean)
        .join("; ")
    : "";
  const itemErrorCode = Array.isArray(items)
    ? items.find((item) => item.errorCode)?.errorCode
    : null;
  return {
    valid: valid && (operation === "VALIDATE" || !!invoiceNumber),
    rejected,
    invoiceNumber,
    statusCode: v?.statusCode || null,
    errorCode: v?.errorCode || itemErrorCode || null,
    error: v?.error || itemErrors || null,
  };
}
