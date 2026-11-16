import { Router } from "express";
import QRCode from "qrcode";
import { uuid, page } from "../middleware/validation.js";
import { requireRole } from "../auth/auth.middleware.js";
import { deleteInvoice, getInvoice, saveInvoice } from "./invoices.service.js";
import { operate } from "../fbr/fbr.service.js";
import { internallyValidateInvoice } from "./internal-validation.service.js";

const fallbackProvinces = [
  "CAPITAL TERRITORY",
  "KHYBER PAKHTUNKHWA",
  "Punjab",
  "Sindh",
  "Khyber Pakhtunkhwa",
  "Balochistan",
  "Islamabad Capital Territory",
];
const fallbackUoms = [
  "KG",
  "Numbers, pieces, units",
  "Kilogram",
  "Gram",
  "Liter",
  "Milliliter",
  "Meter",
  "Square meter",
  "Cubic meter",
  "Metric ton",
  "Dozen",
  "Pair",
  "Pack",
  "Carton",
  "Box",
  "Bag",
  "Bottle",
  "Roll",
];
function provinceNames(reference) {
  const rows = Array.isArray(reference)
    ? reference
    : Array.isArray(reference?.data)
      ? reference.data
      : [];
  const values = rows
    .map((row) =>
      typeof row === "string"
        ? row
        : row.stateProvinceDesc ||
          row.provinceName ||
          row.description ||
          row.name ||
          row.value,
    )
    .filter(Boolean);
  return [...new Set(values.length ? values : fallbackProvinces)];
}
function uomNames(reference) {
  const rows = Array.isArray(reference)
    ? reference
    : Array.isArray(reference?.data)
      ? reference.data
      : [];
  const values = rows
    .map((row) =>
      typeof row === "string"
        ? row
        : row.description ||
          row.uoMDesc ||
          row.uomDesc ||
          row.uom ||
          row.name ||
          row.value,
    )
    .filter(Boolean);
  return [...new Set(values.length ? values : fallbackUoms)];
}
export function invoiceRoutes(pool, config, client) {
  const r = Router(),
    write = requireRole("ADMIN", "ACCOUNTANT");
  r.get("/", async (req, res) => {
    const { limit, offset } = page(
        req.query,
        [10, 25, 50].includes(Number(req.query.pageSize))
          ? Number(req.query.pageSize)
          : 50,
      ),
      search = String(req.query.search || "").slice(0, 100),
      status = String(req.query.status || "");
    const { rows } = await pool.query(
      "SELECT id,invoice_number,invoice_date,customer_snapshot->>'business_name' AS customer_name,status,grand_total,fbr_invoice_number,created_at,updated_at FROM invoices WHERE ($1='' OR invoice_number ILIKE '%'||$1||'%' OR customer_snapshot->>'business_name' ILIKE '%'||$1||'%') AND ($2='' OR status=$2) ORDER BY updated_at DESC,id DESC LIMIT $3 OFFSET $4",
      [search, status, limit + 1, offset],
    );
    res.json({
      invoices: rows.slice(0, limit),
      page: offset / limit + 1,
      pageSize: limit,
      hasMore: rows.length > limit,
    });
  });
  r.get("/overview", async (req, res) => {
    const {
      rows: [summary],
    } = await pool.query(
      "SELECT count(*)::int AS total_invoices,count(*) FILTER (WHERE status='DRAFT')::int AS draft_invoices,count(*) FILTER (WHERE status='FBR_VALIDATED')::int AS fbr_validated_invoices,count(*) FILTER (WHERE status='FBR_ACCEPTED')::int AS fbr_accepted_invoices FROM invoices",
    );
    const { rows: recent } = await pool.query(
      "SELECT id,invoice_number,invoice_date,customer_snapshot->>'business_name' AS customer_name,status,grand_total,updated_at FROM invoices ORDER BY updated_at DESC LIMIT 5",
    );
    res.json({ summary, recent });
  });
  r.get("/rates", async (req, res) => {
    res.json(
      await client.reference("rates", {
        invoiceDate: String(req.query.invoiceDate || ""),
        sellerProvince: String(req.query.sellerProvince || ""),
        saleType: String(req.query.saleType || ""),
      }),
    );
  });
  r.get("/form-options", async (req, res) => {
    const [provinceResult, uomResult] = await Promise.allSettled([
      client.reference("provinces"),
      client.reference("uom"),
    ]);
    const provinces = provinceNames(
        provinceResult.status === "fulfilled" ? provinceResult.value : [],
      ),
      uoms = uomNames(uomResult.status === "fulfilled" ? uomResult.value : []);
    if (!provinces.includes(config.seller.province))
      provinces.unshift(config.seller.province);
    res.json({ seller: { ...config.seller }, provinces, uoms });
  });
  r.get("/:id", async (req, res) => {
    const id = uuid(req.params.id),
      invoice = await getInvoice(pool, id);
    if (invoice.status === "FBR_ACCEPTED" && invoice.fbr_invoice_number)
      invoice.qrCode = await QRCode.toDataURL(invoice.fbr_invoice_number, {
        width: 160,
        margin: 1,
      });
    res.json(invoice);
  });
  r.post("/", write, async (req, res) =>
    res.status(201).json(await saveInvoice(pool, config, req)),
  );
  r.put("/:id", write, async (req, res) =>
    res.json(await saveInvoice(pool, config, req, uuid(req.params.id))),
  );
  r.delete("/:id", write, async (req, res) =>
    res.json(await deleteInvoice(pool, req, uuid(req.params.id))),
  );
  r.post("/:id/validate-internal", write, async (req, res) =>
    res.json(
      await internallyValidateInvoice(pool, config, req, uuid(req.params.id)),
    ),
  );
  for (const action of ["validate", "submit"])
    r.post(`/:id/${action}`, write, async (req, res) =>
      res.json(
        await operate(
          pool,
          config,
          client,
          req,
          uuid(req.params.id),
          action.toUpperCase(),
        ),
      ),
    );
  return r;
}
