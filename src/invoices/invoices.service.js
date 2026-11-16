import { randomUUID } from "node:crypto";
import { lineValues, sumMoney } from "../../shared/invoice-money.js";
import { z } from "zod";
import { parse, text, optionalText, fail } from "../middleware/validation.js";
import { transaction } from "../config/database.js";
import { audit } from "../audit/audit.service.js";

const decimal = (max = 1e10) =>
  z
    .union([z.number(), z.string().regex(/^\d+(\.\d{1,4})?$/)])
    .transform(Number)
    .pipe(z.number().finite().min(0).max(max));
const amount = () => decimal().default(0);
const rate = z
  .string()
  .trim()
  .regex(
    /^(Exempt|(100|\d{1,2})(\.\d{1,4})?%)$/,
    "Use Exempt or a percentage such as 18%",
  );
const buyerSchema = z
  .object({
    businessName: text(255),
    ntnCnic: optionalText(30).refine(
      (value) => !value || /^([A-Za-z0-9]{7}|\d{13})$/.test(value),
      "Use a 7-character NTN or 13-digit CNIC",
    ),
    strn: optionalText(50),
    registrationType: z.enum(["Registered", "Unregistered"]),
    province: text(100),
    address: text(1000),
  })
  .refine((value) => value.registrationType !== "Registered" || value.ntnCnic, {
    message: "Registered buyers require NTN/CNIC",
    path: ["ntnCnic"],
  });
const sellerSchema = z.object({
  businessName: text(255),
  ntnCnic: z
    .string()
    .trim()
    .regex(
      /^([A-Za-z0-9]{7}|\d{13})$/,
      "Use a 7-character NTN or 13-digit CNIC",
    ),
  strn: optionalText(50),
  province: text(100),
  address: text(1000),
});
const itemSchema = z.object({
  productDescription: text(255),
  hsCode: z
    .string()
    .trim()
    .regex(/^\d{4}\.\d{4}$/, "Use an 8-digit HS code such as 0101.2100"),
  uoM: text(100),
  rate,
  saleType: text(255),
  batchNumber: optionalText(100),
  quantity: decimal(1e7).refine(
    (value) => value > 0,
    "Quantity must be greater than zero",
  ),
  unitPrice: decimal(),
  discount: amount(),
  extraTax: z.union([z.literal(""), amount()]).default(0),
  furtherTax: amount(),
  fedPayable: amount(),
  salesTaxWithheldAtSource: amount(),
  fixedNotifiedValueOrRetailPrice: amount(),
  sroScheduleNo: optionalText(),
  sroItemSerialNo: optionalText(),
});
const schema = z.object({
  invoiceNumber: text(100),
  buyer: buyerSchema,
  seller: sellerSchema,
  invoiceDate: z.iso.date(),
  invoiceType: z.enum(["Sale Invoice", "Debit Note"]).default("Sale Invoice"),
  invoiceRefNo: optionalText(255),
  scenarioId: optionalText(10),
  poNumber: optionalText(),
  deliveryChallanNumber: optionalText(),
  paymentTerms: optionalText(),
  version: z.number().int().positive().optional(),
  items: z.array(itemSchema).min(1).max(100),
});

export async function getInvoice(db, id) {
  const {
    rows: [invoice],
  } = await db.query("SELECT * FROM invoices WHERE id=$1", [id]);
  if (!invoice) fail(404, "Invoice not found");
  invoice.items = (
    await db.query(
      "SELECT * FROM invoice_items WHERE invoice_id=$1 ORDER BY position",
      [id],
    )
  ).rows;
  return invoice;
}

export async function saveInvoice(pool, config, req, id = null) {
  const data = parse(schema, req.body);
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Karachi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  if (data.invoiceDate > today)
    fail(400, "Invoice date cannot be in the future");
  if (data.invoiceType === "Debit Note" && !data.invoiceRefNo)
    fail(400, "A debit note requires the original FBR invoice reference");
  if (
    config.appEnv === "sandbox" &&
    !/^SN0(0[1-9]|1\d|2[0-8])$/.test(data.scenarioId)
  )
    fail(400, "Select a valid sandbox scenario");

  const buyer = {
    business_name: data.buyer.businessName,
    ntn_cnic: data.buyer.ntnCnic,
    strn: data.buyer.strn,
    registration_type: data.buyer.registrationType,
    province: data.buyer.province,
    address: data.buyer.address,
  };
  const seller = {
    name: data.seller.businessName,
    ntn: data.seller.ntnCnic,
    strn: data.seller.strn,
    province: data.seller.province,
    address: data.seller.address,
  };
  const items = data.items.map((input) => {
    const { taxable, tax, total } = lineValues(input);
    if (input.discount > taxable)
      fail(400, "Discount cannot exceed the sales value");
    if (input.salesTaxWithheldAtSource > tax)
      fail(400, "Withheld sales tax cannot exceed sales tax");
    if (total > 1e12) fail(400, "Line total exceeds the supported amount");
    return {
      ...input,
      quantity: input.quantity,
      valueSalesExcludingST: taxable,
      salesTaxApplicable: tax,
      totalValues: total,
    };
  });
  const sum = (key) => sumMoney(items.map((item) => item[key]));

  return transaction(pool, async (db) => {
    let old;
    if (id) {
      ({
        rows: [old],
      } = await db.query("SELECT * FROM invoices WHERE id=$1 FOR UPDATE", [
        id,
      ]));
      if (!old) fail(404, "Invoice not found");
      if (
        ![
          "DRAFT",
          "INTERNALLY_VALIDATED",
          "FBR_VALIDATION_FAILED",
          "FBR_VALIDATED",
          "FBR_SUBMISSION_FAILED",
        ].includes(old.status)
      )
        fail(409, "This invoice is locked and cannot be edited");
      if (data.version !== old.version)
        fail(409, "Invoice changed. Reload before editing");
    }
    const invoiceId = id || randomUUID();
    if (id) {
      await db.query(
        "UPDATE invoices SET invoice_number=$1,invoice_date=$2,customer_id=NULL,customer_snapshot=$3,seller_snapshot=$4,po_number=$5,delivery_challan_number=$6,payment_terms=$7,invoice_type=$8,invoice_ref_no=$9,scenario_id=$10,subtotal=$11,sales_tax=$12,grand_total=$13,updated_by=$14,status='DRAFT',fbr_validation_status=NULL,fbr_status=NULL,fbr_invoice_number=NULL,submitted_by=NULL,submitted_at=NULL,version=version+1,updated_at=now() WHERE id=$15",
        [
          data.invoiceNumber,
          data.invoiceDate,
          JSON.stringify(buyer),
          JSON.stringify(seller),
          data.poNumber,
          data.deliveryChallanNumber,
          data.paymentTerms,
          data.invoiceType,
          data.invoiceRefNo,
          config.appEnv === "sandbox" ? data.scenarioId : "",
          sum("valueSalesExcludingST"),
          sum("salesTaxApplicable"),
          sum("totalValues"),
          req.user.id,
          id,
        ],
      );
      await db.query("DELETE FROM invoice_items WHERE invoice_id=$1", [id]);
    } else {
      await db.query(
        "INSERT INTO invoices(id,invoice_number,invoice_date,customer_id,customer_snapshot,seller_snapshot,po_number,delivery_challan_number,payment_terms,invoice_type,invoice_ref_no,scenario_id,subtotal,sales_tax,grand_total,created_by,updated_by) VALUES($1,$2,$3,NULL,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15)",
        [
          invoiceId,
          data.invoiceNumber,
          data.invoiceDate,
          JSON.stringify(buyer),
          JSON.stringify(seller),
          data.poNumber,
          data.deliveryChallanNumber,
          data.paymentTerms,
          data.invoiceType,
          data.invoiceRefNo,
          config.appEnv === "sandbox" ? data.scenarioId : "",
          sum("valueSalesExcludingST"),
          sum("salesTaxApplicable"),
          sum("totalValues"),
          req.user.id,
        ],
      );
    }
    for (const [index, item] of items.entries())
      await db.query(
        "INSERT INTO invoice_items(id,invoice_id,position,product_id,snapshot) VALUES($1,$2,$3,NULL,$4)",
        [randomUUID(), invoiceId, index, JSON.stringify(item)],
      );
    await audit(
      db,
      req,
      id ? "INVOICE_UPDATED" : "INVOICE_CREATED",
      "invoice",
      invoiceId,
    );
    return getInvoice(db, invoiceId);
  });
}

export async function deleteInvoice(pool, req, id) {
  return transaction(pool, async (db) => {
    const {
      rows: [invoice],
    } = await db.query(
      "SELECT status,fbr_invoice_number,submitted_at FROM invoices WHERE id=$1 FOR UPDATE",
      [id],
    );
    if (!invoice) fail(404, "Invoice not found");
    if (
      invoice.status === "FBR_ACCEPTED" ||
      invoice.fbr_invoice_number ||
      invoice.submitted_at
    )
      fail(409, "An invoice submitted to FBR cannot be deleted");
    if (["SUBMITTING", "SUBMISSION_UNKNOWN"].includes(invoice.status))
      fail(
        409,
        "Resolve the FBR submission outcome before deleting this invoice",
      );
    if (invoice.status === "VALIDATING_FBR")
      fail(
        409,
        "Wait for FBR validation to finish before deleting this invoice",
      );
    if (
      ![
        "DRAFT",
        "INTERNALLY_VALIDATED",
        "FBR_VALIDATION_FAILED",
        "FBR_VALIDATED",
        "FBR_SUBMISSION_FAILED",
      ].includes(invoice.status)
    )
      fail(409, "This invoice cannot be deleted in its current state");
    await db.query("DELETE FROM fbr_submissions WHERE invoice_id=$1", [id]);
    await db.query("DELETE FROM invoice_items WHERE invoice_id=$1", [id]);
    await db.query("DELETE FROM invoices WHERE id=$1", [id]);
    await audit(db, req, "INVOICE_DELETED", "invoice", id);
    return { ok: true };
  });
}
