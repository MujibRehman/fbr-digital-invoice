import { fail } from "../middleware/validation.js";
export const simpleRate = (rate) =>
  /^(Exempt|(100|\d{1,2})(\.\d{1,4})?%)$/.test(rate);
export function referenceDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
    fail(400, "Select a valid invoice date");
  const date = new Date(`${value}T00:00:00Z`);
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  )
    fail(400, "Select a valid invoice date");
  return `${String(date.getUTCDate()).padStart(2, "0")}-${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][date.getUTCMonth()]}-${date.getUTCFullYear()}`;
}
export function rateRows(data) {
  const rows = Array.isArray(data)
    ? data
    : Array.isArray(data?.data)
      ? data.data
      : [];
  const rates = rows
    .filter((row) => typeof row.ratE_DESC === "string" && row.ratE_DESC.trim())
    .map((row) => ({
      id: row.ratE_ID,
      description: row.ratE_DESC.trim(),
      value: row.ratE_VALUE,
      supported: simpleRate(row.ratE_DESC.trim()),
    }));
  if (!rates.length)
    fail(
      502,
      "FBR returned no rate choices for this date, sale type and seller province. Try again or check the invoice details.",
    );
  return rates;
}
export async function checkInvoiceRates(invoice, config, client) {
  if (config.mock) return;
  for (const [index, { snapshot: item }] of invoice.items.entries()) {
    const choices = await client.reference("rates", {
      invoiceDate: invoice.invoice_date.slice(0, 10),
      sellerProvince: invoice.seller_snapshot.province,
      saleType: item.saleType,
    });
    if (!choices.rates.some((rate) => rate.description === item.rate)) {
      const allowed = choices.rates.map((rate) => rate.description).join("; ");
      fail(
        400,
        `Item ${index + 1}: rate ${item.rate} is not valid for ${item.saleType} on ${invoice.invoice_date.slice(0, 10)}. FBR lists: ${allowed}. Select a listed supported rate, or review the invoice date and product tax treatment. Compound rates require review; amounts have not been changed.`,
      );
    }
  }
}
