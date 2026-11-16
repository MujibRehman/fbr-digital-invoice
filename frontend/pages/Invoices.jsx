import {
  lineValues,
  sumMoney,
  numberWords,
} from "../../shared/invoice-money.js";
import "./Invoices.css";
import { useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { api, post } from "../api.js";
import { useResource } from "../hooks.js";
import { useSession } from "../session.jsx";
import {
  Badge,
  date,
  Field,
  Form,
  Heading,
  LoadState,
  Modal,
  money,
  Pagination,
  Select,
  today,
} from "../components/ui.jsx";

const editableStatuses = [
  "DRAFT",
  "INTERNALLY_VALIDATED",
  "FBR_VALIDATION_FAILED",
  "FBR_VALIDATED",
  "FBR_SUBMISSION_FAILED",
];
const fbrValidationStatuses = [
  "DRAFT",
  "INTERNALLY_VALIDATED",
  "FBR_VALIDATION_FAILED",
];
const statusOptions = [
  "",
  "DRAFT",
  "INTERNALLY_VALIDATED",
  "VALIDATING_FBR",
  "FBR_VALIDATION_FAILED",
  "FBR_VALIDATED",
  "SUBMITTING",
  "FBR_SUBMISSION_FAILED",
  "SUBMISSION_UNKNOWN",
  "FBR_ACCEPTED",
];
const sandboxSaleTypes = {
  "SN001": "Goods at standard rate (default)",
  "SN002": "Goods at standard rate (default)",
  "SN005": "Goods at Reduced Rate",
  "SN006": "Exempt goods",
  "SN007": "Goods at zero-rate",
  "SN016": "Processing/Conversion of Goods",
  "SN017": "Goods (FED in ST Mode)",
  "SN018": "Services (FED in ST Mode)",
  "SN019": "Services",
  "SN024": "Goods as per SRO.297(|)/2023"
};
const adjustments = [
  ["discount", "Discount"],
  ["extraTax", "Extra tax"],
  ["furtherTax", "Further tax"],
  ["fedPayable", "FED payable"],
  ["salesTaxWithheldAtSource", "Sales tax withheld"],
  ["fixedNotifiedValueOrRetailPrice", "Notified / retail price"],
];
function printDate(value) {
  if (!value) return "—";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Karachi",
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  }).formatToParts(new Date(value));
  const pick = (type) => parts.find((part) => part.type === type)?.value;
  return `${pick("day")}-${pick("month")}-${pick("year")}`;
}
function Workflow({ status }) {
  const normalized =
    status === "VALIDATING_FBR" || status === "FBR_VALIDATION_FAILED"
      ? "INTERNALLY_VALIDATED"
      : status === "SUBMITTING" ||
          status === "FBR_SUBMISSION_FAILED" ||
          status === "SUBMISSION_UNKNOWN"
        ? "FBR_VALIDATED"
        : status;
  const position = [
    "DRAFT",
    "INTERNALLY_VALIDATED",
    "FBR_VALIDATED",
    "FBR_ACCEPTED",
  ].indexOf(normalized);
  return (
    <ol className="invoice-workflow no-print" aria-label="Invoice workflow">
      {[
        "Draft",
        "Internally validated",
        "Validated with FBR",
        "FBR submitted",
      ].map((label, index) => (
        <li
          key={label}
          className={
            index < position ? "complete" : index === position ? "current" : ""
          }
        >
          <span className="workflow-label">{label}</span>
          <span className="workflow-dot">
            {index < position ? "✓" : index + 1}
          </span>
        </li>
      ))}
    </ol>
  );
}

export function InvoicesPage() {
  const { user } = useSession(),
    [params, setParams] = useSearchParams();
  const search = params.get("search") || "",
    status = params.get("status") || "",
    page = Math.max(
      1,
      Math.min(100000, Math.floor(Number(params.get("page")) || 1)),
    );
  const pageSize = [10, 25, 50].includes(Number(params.get("pageSize")))
    ? Number(params.get("pageSize"))
    : 10;
  const resource = useResource(
    `/invoices?page=${page}&pageSize=${pageSize}&search=${encodeURIComponent(search)}&status=${encodeURIComponent(status)}`,
  );
  return (
    <>
      <Heading
        title="Invoices"
        subtitle="Search, review and continue your invoice workflow."
      >
        {user.role !== "VIEWER" && (
          <Link className="button primary" to="/create-invoice">
            + New invoice
          </Link>
        )}
      </Heading>
      <div className="invoice-list-controls">
        <form
          className="toolbar"
          key={`${search}:${status}:${pageSize}`}
          onSubmit={(event) => {
            event.preventDefault();
            const data = Object.fromEntries(new FormData(event.currentTarget));
            setParams({
              search: data.search,
              status: data.status,
              pageSize: String(pageSize),
            });
          }}
        >
          <Field
            label="Search invoices"
            name="search"
            type="search"
            defaultValue={search}
            placeholder="Invoice number or buyer"
          />
          <Select
            label="Status"
            name="status"
            defaultValue={status}
            options={statusOptions.map((value) =>
              value ? value : ["", "All statuses"],
            )}
          />
          <button>Search</button>
        </form>
        <div className="invoice-list-page-size">
          <Select
            label="Invoices per page"
            value={pageSize}
            options={[10, 25, 50]}
            onChange={(event) =>
              setParams({ search, status, pageSize: event.target.value })
            }
          />
        </div>
      </div>
      <LoadState resource={resource}>
        {(result) => (
          <>
            <section className="panel table-panel">
              {result.invoices.length ? (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Invoice</th>
                        <th>Buyer</th>
                        <th>Date</th>
                        <th>Status</th>
                        <th>Total · PKR</th>
                        <th>Last updated</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.invoices.map((invoice) => (
                        <tr key={invoice.id}>
                          <td>
                            <Link
                              className="table-link"
                              to={`/invoices/${invoice.id}`}
                            >
                              {invoice.invoice_number}
                            </Link>
                          </td>
                          <td>{invoice.customer_name}</td>
                          <td>{date(invoice.invoice_date)}</td>
                          <td>
                            <Badge value={invoice.status} />
                          </td>
                          <td>{money(invoice.grand_total)}</td>
                          <td>{date(invoice.updated_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="empty">
                  <h2>
                    {search || status
                      ? "No matching invoices"
                      : "Your invoices start here"}
                  </h2>
                  <p>
                    {search || status
                      ? "Try another search or status."
                      : "Create an invoice and save it as a draft."}
                  </p>
                  {user.role !== "VIEWER" && (
                    <Link className="button primary" to="/create-invoice">
                      Create invoice
                    </Link>
                  )}
                </div>
              )}
            </section>
            <div className="invoice-list-footer">
              <Pagination
                page={page}
                pageSize={result.pageSize || pageSize}
                hasMore={result.hasMore}
                onPage={(next) =>
                  setParams({
                    search,
                    status,
                    page: String(next),
                    pageSize: String(pageSize),
                  })
                }
              />
            </div>
          </>
        )}
      </LoadState>
    </>
  );
}

const newItem = (snapshot = {}) => ({
  key: crypto.randomUUID(),
  productDescription: "",
  hsCode: "",
  uoM: "",
  quantity: 1,
  unitPrice: "",
  rate: "18%",
  saleType: "Goods at standard rate (default)",
  batchNumber: "",
  discount: 0,
  extraTax: 0,
  furtherTax: 0,
  fedPayable: 0,
  salesTaxWithheldAtSource: 0,
  fixedNotifiedValueOrRetailPrice: 0,
  sroScheduleNo: "",
  sroItemSerialNo: "",
  ...snapshot,
});
function ReadonlyField({ label, value }) {
  return (
    <label>
      {label}
      <output className="readonly-field">{value || "—"}</output>
    </label>
  );
}

export function InvoiceEditorPage() {
  const { id } = useParams(),
    options = useResource("/invoices/form-options"),
    invoice = useResource(id ? `/invoices/${id}` : null);
  const waiting = [options, invoice].find(
    (resource) => resource.loading || resource.error,
  );
  if (waiting) return <LoadState resource={waiting}>{() => null}</LoadState>;
  if (id && !editableStatuses.includes(invoice.data.status))
    return (
      <section className="panel">
        <h1>Invoice locked</h1>
        <p>This invoice cannot be edited in its current state.</p>
        <Link to={`/invoices/${id}`}>View invoice</Link>
      </section>
    );
  return (
    <InvoiceForm
      key={id || "new"}
      invoice={invoice.data}
      sellerDefaults={options.data.seller}
      provinces={options.data.provinces}
      uoms={options.data.uoms}
    />
  );
}

function TaxRateField({
  value,
  onChange,
  invoiceDate,
  sellerProvince,
  saleType,
}) {
  const { mock } = useSession();
  const path =
    !mock && invoiceDate && sellerProvince && saleType
      ? `/invoices/rates?${new URLSearchParams({ invoiceDate, sellerProvince, saleType })}`
      : null;
  const resource = useResource(path);
  const rates = resource.data?.rates || [],
    valid = rates.some((rate) => rate.description === value);
  return (
    <div>
      <Field
        label="Tax Rate"
        required
        placeholder="18%"
        value={value}
        onChange={onChange}
      />
      {path && resource.loading && (
        <small role="status">Checking FBR rates for {invoiceDate}…</small>
      )}
      {path && resource.error && (
        <small className="error" role="alert">
          Unable to check FBR rates: {resource.error}
        </small>
      )}
      {path && !resource.loading && !resource.error && rates.length > 0 && (
        <small
          className={valid ? "muted" : "error"}
          role={valid ? "status" : "alert"}
        >
          {valid
            ? `Rate confirmed by FBR for ${invoiceDate}.`
            : `${value || "This rate"} is not allowed by FBR for ${invoiceDate}. Listed rates: ${rates.map((rate) => rate.description).join("; ")}.`}
          {!valid &&
            rates.every((rate) => !rate.supported) &&
            " This compound rate needs a reviewed tax calculation and unit basis. The app has not changed your amounts."}
        </small>
      )}
    </div>
  );
}

function InvoiceForm({ invoice, sellerDefaults, provinces, uoms }) {
  const { environment, notify } = useSession(),
    navigate = useNavigate(),
    buyer = invoice?.customer_snapshot || {};
  const seller = invoice?.seller_snapshot || sellerDefaults;
  const provinceOptions = (current) => [
    ["", "Select province"],
    ...[...new Set([...(provinces || []), current].filter(Boolean))].map(
      (value) => [value, value],
    ),
  ];
  const uomOptions = (current) => [
    ["", "Select unit"],
    ...[...new Set([...(uoms || []), current].filter(Boolean))].map((value) => [
      value,
      value,
    ]),
  ];
  const [items, setItems] = useState(() =>
    invoice ? invoice.items.map((item) => newItem(item.snapshot)) : [newItem()],
  );
  const [scenarioId, setScenarioId] = useState(invoice?.scenario_id || "");
  const [invoiceDate, setInvoiceDate] = useState(
    invoice?.invoice_date?.slice(0, 10) || today(),
  );
  const [sellerProvince, setSellerProvince] = useState(seller.province || "");
  const scenarioSaleType = sandboxSaleTypes[scenarioId] || "";

  const computed = useMemo(() => items.map(lineValues), [items]);
  const totals = useMemo(
    () => ({
      subtotal: sumMoney(computed.map((row) => row.taxable)),
      tax: sumMoney(computed.map((row) => row.tax)),
      total: sumMoney(computed.map((row) => row.total)),
    }),
    [computed],
  );
  const setItem = (key, field, value) =>
    setItems((rows) =>
      rows.map((row) => (row.key === key ? { ...row, [field]: value } : row)),
    );
  async function save(data) {
    const body = {
      invoiceNumber: data.invoiceNumber,
      buyer: {
        businessName: data.buyerBusinessName,
        ntnCnic: data.buyerNtnCnic,
        strn: data.buyerStrn,
        registrationType: data.buyerRegistrationType,
        province: data.buyerProvince,
        address: data.buyerAddress,
      },
      seller: {
        businessName: data.sellerBusinessName,
        ntnCnic: data.sellerNtnCnic,
        strn: data.sellerStrn,
        province: data.sellerProvince,
        address: data.sellerAddress,
      },
      invoiceDate: data.invoiceDate,
      poNumber: data.poNumber,
      deliveryChallanNumber: data.deliveryChallanNumber,
      paymentTerms: data.paymentTerms,
      invoiceType: data.invoiceType,
      invoiceRefNo: data.invoiceRefNo,
      scenarioId: data.scenarioId || "",
      ...(invoice ? { version: invoice.version } : {}),
      items: items.map(({ key, ...item }) => ({
        ...item,
        ...(environment === "sandbox" ? { saleType: scenarioSaleType } : {}),
      })),
    };
    const saved = await api(`/invoices${invoice ? `/${invoice.id}` : ""}`, {
      method: invoice ? "PUT" : "POST",
      body,
    });
    notify(invoice ? "Invoice updated." : "Invoice saved.");
    navigate(`/invoices/${saved.id}`, { replace: true });
  }
  return (
    <>
      <Heading
        title={invoice ? "Edit invoice" : "Create invoice"}
        subtitle="Enter buyer and item details directly, then save the invoice as a draft."
      >
        <Link
          className="button"
          to={invoice ? `/invoices/${invoice.id}` : "/invoices"}
        >
          Cancel
        </Link>
      </Heading>
      <div>
        <Form onSubmit={save}>
          <article className="panel invoice-composer">
            <header className="composer-title">
              <div>
                <div className="eyebrow">Invoice workspace</div>
                <p>
                  {invoice?.invoice_number ||
                    "Enter the fbr-digital-invoice invoice number below"}
                </p>
              </div>
              <h2>SALES TAX INVOICE</h2>
            </header>
            <div className="composer-columns">
              <section>
                <h2>Invoice Details</h2>
                <Field
                  label="Internal Invoice No."
                  name="invoiceNumber"
                  required
                  maxLength={100}
                  defaultValue={invoice?.invoice_number || ""}
                  placeholder="Enter your fbr-digital-invoice invoice number"
                />
                <Field
                  label="Invoice Date"
                  name="invoiceDate"
                  type="date"
                  required
                  value={invoiceDate}
                  onChange={(event) => setInvoiceDate(event.target.value)}
                />
                <Field
                  label="PO No."
                  name="poNumber"
                  defaultValue={invoice?.po_number || ""}
                />
                <Field
                  label="Delivery Challan No."
                  name="deliveryChallanNumber"
                  defaultValue={invoice?.delivery_challan_number || ""}
                />
                <Field
                  label="Payment Terms"
                  name="paymentTerms"
                  defaultValue={invoice?.payment_terms || ""}
                />
                <Select
                  label="Invoice Type"
                  name="invoiceType"
                  defaultValue={invoice?.invoice_type || "Sale Invoice"}
                  options={["Sale Invoice", "Debit Note"]}
                />
                <Field
                  label="Original FBR Invoice Reference (Debit Notes)"
                  name="invoiceRefNo"
                  defaultValue={invoice?.invoice_ref_no || ""}
                />
              </section>
              <section>
                <h2>Customer / Buyer</h2>
                <Field
                  label="Business Name"
                  name="buyerBusinessName"
                  required
                  defaultValue={buyer.business_name || ""}
                />
                <Field
                  label="Address"
                  name="buyerAddress"
                  required
                  defaultValue={buyer.address || ""}
                />
                <div className="grid">
                  <Field
                    label="NTN / CNIC"
                    name="buyerNtnCnic"
                    maxLength={30}
                    defaultValue={buyer.ntn_cnic || ""}
                  />
                  <Field
                    label="STRN"
                    name="buyerStrn"
                    defaultValue={buyer.strn || ""}
                  />
                </div>
                <div className="grid">
                  <Select
                    label="Registration Type"
                    name="buyerRegistrationType"
                    defaultValue={buyer.registration_type || "Registered"}
                    options={["Registered", "Unregistered"]}
                  />
                  <Select
                    label="Province"
                    name="buyerProvince"
                    required
                    defaultValue={buyer.province || ""}
                    options={provinceOptions(buyer.province)}
                  />
                </div>
              </section>
            </div>
            <section className="seller-strip">
              <h2>Seller FBR Details</h2>
              <div className="seller-grid">
                <Field
                  label="Seller Business Name"
                  name="sellerBusinessName"
                  required
                  defaultValue={seller.name || ""}
                />
                <Field
                  label="FBR NTN/CNIC"
                  name="sellerNtnCnic"
                  required
                  maxLength={30}
                  defaultValue={seller.ntn || ""}
                />
                <Field
                  label="STRN"
                  name="sellerStrn"
                  defaultValue={seller.strn || ""}
                />
                <Select
                  label="Province"
                  name="sellerProvince"
                  required
                  value={sellerProvince}
                  onChange={(event) => setSellerProvince(event.target.value)}
                  options={provinceOptions(seller.province)}
                />
                <Field
                  className="seller-address"
                  label="Seller Address"
                  name="sellerAddress"
                  required
                  defaultValue={seller.address || ""}
                />
              </div>
            </section>
            <section className="composer-items">
              <div className="section-head">
                <div>
                  <h2>Invoice Items</h2>
                  <p className="muted">
                    {items.length} {items.length === 1 ? "item" : "items"} on
                    this invoice
                  </p>
                </div>
                <div className="invoice-tools">
                  {environment === "sandbox" && (
                    <Select
                      label="Select Scenario"
                      name="scenarioId"
                      required
                      value={scenarioId}
                      onChange={(event) => setScenarioId(event.target.value)}
                      options={[
                        ["", "Select scenario"],
                        ...Object.keys(sandboxSaleTypes).map((id) => [id, id]),
                      ]}
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => setItems((rows) => [...rows, newItem()])}
                    disabled={items.length >= 100}
                  >
                    + Add Item
                  </button>
                </div>
              </div>
              {items.map((item, index) => {
                const values = computed[index];
                return (
                  <section
                    className="composer-item"
                    key={item.key}
                    aria-label={`Invoice item ${index + 1}`}
                  >
                    <header>
                      <h3>Item {index + 1}</h3>
                      <span>
                        {item.productDescription || "Enter product details"}
                      </span>
                    </header>
                    <div className="item-grid">
                      <Field
                        label="Product Description"
                        required
                        value={item.productDescription}
                        onChange={(event) =>
                          setItem(
                            item.key,
                            "productDescription",
                            event.target.value,
                          )
                        }
                      />
                      <Field
                        label="Batch No."
                        value={item.batchNumber}
                        maxLength={100}
                        onChange={(event) =>
                          setItem(item.key, "batchNumber", event.target.value)
                        }
                      />
                      <Field
                        label="Quantity"
                        type="number"
                        required
                        min="0.0001"
                        step="0.0001"
                        value={item.quantity}
                        onChange={(event) =>
                          setItem(item.key, "quantity", event.target.value)
                        }
                      />
                      <Select
                        label="UOM"
                        required
                        value={item.uoM}
                        options={uomOptions(item.uoM)}
                        onChange={(event) =>
                          setItem(item.key, "uoM", event.target.value)
                        }
                      />
                      <Field
                        label="Unit Price (PKR)"
                        type="number"
                        required
                        min="0"
                        step="0.0001"
                        value={item.unitPrice}
                        onChange={(event) =>
                          setItem(item.key, "unitPrice", event.target.value)
                        }
                      />
                      <ReadonlyField
                        label="Taxable Value"
                        value={money(values.taxable)}
                      />
                      <TaxRateField
                        value={item.rate}
                        onChange={(event) =>
                          setItem(item.key, "rate", event.target.value)
                        }
                        invoiceDate={invoiceDate}
                        sellerProvince={sellerProvince}
                        saleType={
                          environment === "sandbox"
                            ? scenarioSaleType
                            : item.saleType
                        }
                      />
                      <ReadonlyField
                        label="Sales Tax"
                        value={money(values.tax)}
                      />
                    </div>
                    <div className="fbr-item-strip">
                      <Field
                        label="HS Code"
                        required
                        placeholder="0101.2100"
                        value={item.hsCode}
                        onChange={(event) =>
                          setItem(item.key, "hsCode", event.target.value)
                        }
                      />
                      <Field
                        label="FBR Sale Type"
                        required
                        readOnly={environment === "sandbox"}
                        placeholder="Select a scenario"
                        value={
                          environment === "sandbox"
                            ? scenarioSaleType
                            : item.saleType
                        }
                        onChange={(event) =>
                          setItem(item.key, "saleType", event.target.value)
                        }
                      />
                      <div className="line-total">
                        <span>Line total</span>
                        <strong>{money(values.total)}</strong>
                      </div>
                    </div>
                    <details>
                      <summary>Additional tax and SRO fields</summary>
                      <div className="grid">
                        {adjustments.map(([key, label]) => (
                          <Field
                            key={key}
                            label={`${label} · PKR`}
                            type="number"
                            min="0"
                            step="0.01"
                            value={item[key]}
                            onChange={(event) =>
                              setItem(item.key, key, event.target.value)
                            }
                          />
                        ))}
                        <Field
                          label="SRO schedule"
                          value={item.sroScheduleNo}
                          onChange={(event) =>
                            setItem(
                              item.key,
                              "sroScheduleNo",
                              event.target.value,
                            )
                          }
                        />
                        <Field
                          label="SRO item serial no."
                          value={item.sroItemSerialNo}
                          onChange={(event) =>
                            setItem(
                              item.key,
                              "sroItemSerialNo",
                              event.target.value,
                            )
                          }
                        />
                      </div>
                    </details>
                    <button
                      type="button"
                      className="text-button danger"
                      disabled={items.length === 1}
                      onClick={() =>
                        setItems((rows) =>
                          rows.filter((row) => row.key !== item.key),
                        )
                      }
                    >
                      Remove item
                    </button>
                  </section>
                );
              })}
            </section>
            <div className="composer-summary">
              <div>
                <strong>Amount in Words:</strong> {numberWords(totals.total)}
              </div>
              <div className="summary-table">
                <p>
                  <span>Subtotal</span>
                  <strong>{money(totals.subtotal)}</strong>
                </p>
                <p>
                  <span>Sales Tax</span>
                  <strong>{money(totals.tax)}</strong>
                </p>
                <p>
                  <span>Grand Total</span>
                  <strong>{money(totals.total)}</strong>
                </p>
              </div>
            </div>
          </article>
          <div className="actions">
            <button className="primary">Save draft</button>
            <Link
              className="button"
              to={invoice ? `/invoices/${invoice.id}` : "/invoices"}
            >
              Cancel
            </Link>
          </div>
        </Form>
      </div>
    </>
  );
}

export function InvoiceDetailPage() {
  const { id } = useParams(),
    resource = useResource(`/invoices/${id}`);
  return (
    <LoadState resource={resource}>
      {(invoice) => (
        <InvoiceDetail
          key={`${id}:${invoice.status}`}
          invoice={invoice}
          reload={resource.reload}
        />
      )}
    </LoadState>
  );
}
function InvoiceDetail({ invoice: i, reload }) {
  const { user, notify } = useSession(),
    navigate = useNavigate();
  const [submissionVersion, setSubmissionVersion] = useState(null);
  const [confirm, setConfirm] = useState(""),
    [busy, setBusy] = useState(""),
    [error, setError] = useState("");
  const locked = useRef(false),
    editable = editableStatuses.includes(i.status),
    canWrite = user.role !== "VIEWER",
    canPrint = ["FBR_VALIDATED", "FBR_ACCEPTED"].includes(i.status);
  async function operate(operation) {
    if (locked.current) return;
    locked.current = true;
    setBusy(operation);
    setError("");
    try {
      if (operation === "delete") {
        await api(`/invoices/${i.id}`, { method: "DELETE" });
        notify("Invoice deleted.");
        navigate("/invoices", { replace: true });
        return;
      }
      const path = operation === "internal" ? "validate-internal" : operation;
      const result = await post(
        `/invoices/${i.id}/${path}`,
        operation === "submit" ? { version: submissionVersion } : {},
      );
      const failed = [
        "FBR_VALIDATION_FAILED",
        "FBR_SUBMISSION_FAILED",
        "SUBMISSION_UNKNOWN",
      ].includes(result.status);
      const detail = result.errorMessage ? ` ${result.errorMessage}` : "";
      const message =
        operation === "internal"
          ? "Invoice internally validated."
          : operation === "validate"
            ? failed
              ? `Invoice validation with FBR failed.${detail}`
              : "Invoice validated with FBR."
            : failed
              ? `Invoice submission to FBR failed.${detail}`
              : "Invoice submitted to FBR.";
      notify(message, failed ? "error" : "success");
      reload();
    } catch (err) {
      const message =
        operation === "validate"
          ? `Invoice validation with FBR failed. ${err.message}`
          : operation === "submit"
            ? `Invoice submission to FBR failed. ${err.message}`
            : err.message;
      setError(message);
      notify(message, "error");
      if (operation === "submit" && err.status === 409) reload();
    } finally {
      locked.current = false;
      setBusy("");
      setConfirm("");
    }
  }
  return (
    <>
      <Heading
        title={i.invoice_number}
        subtitle={`Last updated ${date(i.updated_at)}`}
      >
        <div className="actions">
          <Link className="button" to="/invoices">
            Back
          </Link>
          {canWrite && editable && (
            <Link className="button" to={`/invoices/${i.id}/edit`}>
              Edit invoice
            </Link>
          )}
          {canWrite && i.status === "DRAFT" && (
            <button disabled={!!busy} onClick={() => operate("internal")}>
              Validate internally
            </button>
          )}
          {canWrite && fbrValidationStatuses.includes(i.status) && (
            <button disabled={!!busy} onClick={() => operate("validate")}>
              Validate with FBR
            </button>
          )}
          {canWrite &&
            ["FBR_VALIDATED", "FBR_SUBMISSION_FAILED"].includes(i.status) && (
              <button
                className="primary"
                disabled={!!busy}
                onClick={() => {
                  setSubmissionVersion(i.version);
                  setConfirm("submit");
                }}
              >
                {i.status === "FBR_SUBMISSION_FAILED"
                  ? "Retry FBR submission"
                  : "Submit to FBR"}
              </button>
            )}
          {canWrite && editable && !i.fbr_invoice_number && !i.submitted_at && (
            <button
              className="danger"
              disabled={!!busy}
              onClick={() => setConfirm("delete")}
            >
              Delete invoice
            </button>
          )}
          {canPrint && (
            <button onClick={() => window.print()}>Print invoice</button>
          )}
          <button disabled={!!busy} onClick={reload}>
            Refresh
          </button>
        </div>
      </Heading>
      <Workflow status={i.status} />
      {error && (
        <p className="error no-print" role="alert">
          {error}
        </p>
      )}
      {["SUBMITTING", "SUBMISSION_UNKNOWN", "VALIDATING_FBR"].includes(
        i.status,
      ) && (
        <p className="note warning no-print">
          This invoice is locked while its FBR outcome is checked. Refresh the
          status before taking any further action.
        </p>
      )}
      {i.status === "FBR_ACCEPTED" && (
        <p className="note success no-print">
          <strong>FBR submission complete.</strong> This invoice is permanent
          and can only be viewed or printed.
        </p>
      )}
      <InvoicePaper invoice={i} />
      {confirm === "submit" && (
        <Modal
          title={`Submit ${i.invoice_number}?`}
          onClose={() => setConfirm("")}
          busy={!!busy}
        >
          <p>
            If FBR accepts it, the invoice becomes permanent and cannot be
            edited or deleted.
          </p>
          <div className="actions">
            <button
              className="primary"
              disabled={!!busy}
              onClick={() => operate("submit")}
            >
              {busy ? "Submitting…" : "Confirm submission"}
            </button>
            <button disabled={!!busy} onClick={() => setConfirm("")}>
              Cancel
            </button>
          </div>
        </Modal>
      )}
      {confirm === "delete" && (
        <Modal
          title={`Delete ${i.invoice_number}?`}
          onClose={() => setConfirm("")}
          busy={!!busy}
        >
          <p>
            This permanently deletes this invoice and its local FBR validation
            history. The action will be recorded in the audit trail.
          </p>
          <div className="actions">
            <button
              className="danger"
              disabled={!!busy}
              onClick={() => operate("delete")}
            >
              {busy ? "Deleting…" : "Delete invoice"}
            </button>
            <button disabled={!!busy} onClick={() => setConfirm("")}>
              Cancel
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

function InvoicePaper({ invoice: i }) {
  const buyer = i.customer_snapshot,
    seller = i.seller_snapshot;
  const printable = ["FBR_VALIDATED", "FBR_ACCEPTED"].includes(i.status);
  const rows = [
    ...i.items,
    ...Array.from({ length: Math.max(0, 10 - i.items.length) }, (_, index) => ({
      id: `blank-${index}`,
      snapshot: null,
    })),
  ];
  const taxRates = [
    ...new Set(i.items.map(({ snapshot }) => snapshot.rate).filter(Boolean)),
  ];
  const taxLabel =
    taxRates.length === 1 ? `Sales Tax (${taxRates[0]})` : "Sales Tax";
  return (
    <article
      className={`panel invoice-paper${printable ? "" : " print-disabled"}`}
    >
      <div className="document-status no-print">
        <Badge value={i.status} />
      </div>
      <header className="invoice-letterhead">
        <div>
          <h2>{seller.name}</h2>
          <p>{seller.address}</p>
          <p>
            <strong>NTN: {seller.ntn}</strong>
            {seller.strn && (
              <>
                {" "}
                &nbsp; <strong>STRN: {seller.strn}</strong>
              </>
            )}
          </p>
        </div>
        <div className="invoice-brand" aria-label="fbr-digital-invoice">
          <strong>
            fbr-digital-invoice
          </strong>
          <small>Digital Invoicing</small>
        </div>
      </header>
      <h2 className="invoice-paper-title">
        {i.invoice_type === "Debit Note" ? "DEBIT NOTE" : "SALES TAX INVOICE"}
      </h2>
      <div className="invoice-parties">
        <dl>
          <div>
            <dt>Invoice No.</dt>
            <dd>{i.invoice_number}</dd>
          </div>
          <div>
            <dt>Invoice Date</dt>
            <dd>{printDate(i.invoice_date)}</dd>
          </div>
          <div>
            <dt>PO No.</dt>
            <dd>{i.po_number || "—"}</dd>
          </div>
          <div>
            <dt>Delivery Challan No.</dt>
            <dd>{i.delivery_challan_number || "—"}</dd>
          </div>
          <div>
            <dt>Payment Terms</dt>
            <dd>{i.payment_terms || "—"}</dd>
          </div>
          {i.invoice_ref_no && (
            <div>
              <dt>Invoice Reference</dt>
              <dd>{i.invoice_ref_no}</dd>
            </div>
          )}
          {i.fbr_invoice_number && (
            <div>
              <dt>FBR Invoice No.</dt>
              <dd>{i.fbr_invoice_number}</dd>
            </div>
          )}
        </dl>
        <dl>
          <div>
            <dt>Customer</dt>
            <dd>{buyer.business_name}</dd>
          </div>
          <div>
            <dt>Address</dt>
            <dd>
              {buyer.address}
              {buyer.province ? `, ${buyer.province}` : ""}
            </dd>
          </div>
          <div>
            <dt>NTN / STRN</dt>
            <dd>
              {buyer.ntn_cnic || "—"} / {buyer.strn || "—"}
            </dd>
          </div>
          <div>
            <dt>Registration</dt>
            <dd>{buyer.registration_type}</dd>
          </div>
        </dl>
      </div>
      <div className="table-wrap">
        <table
          className="invoice-line-table"
          aria-label="Printable invoice items"
        >
          <thead>
            <tr>
              <th>Sr</th>
              <th>Description</th>
              <th>Batch No.</th>
              <th>Qty</th>
              <th>Unit</th>
              <th>Rate</th>
              <th>Taxable Value</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ id, snapshot: item }, index) => (
              <tr key={id || index}>
                <td>{index + 1}</td>
                <td>
                  {item && (
                    <>
                      {item.productDescription}
                      <small>{item.hsCode}</small>
                    </>
                  )}
                </td>
                <td>{item?.batchNumber || ""}</td>
                <td>{item ? item.quantity : ""}</td>
                <td>{item?.uoM || ""}</td>
                <td>{item ? money(item.unitPrice) : ""}</td>
                <td>{item ? money(item.valueSalesExcludingST) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="invoice-financials">
        <div className="invoice-qr-block">
          {i.status === "FBR_ACCEPTED" && i.qrCode && (
            <div className="invoice-qr">
              <img
                className="qr"
                alt="FBR invoice number QR code"
                src={i.qrCode}
              />
              <span>{i.fbr_invoice_number}</span>
            </div>
          )}
        </div>
        <div className="summary-table">
          <p>
            <span>Subtotal</span>
            <strong>{money(i.subtotal)}</strong>
          </p>
          <p>
            <span>{taxLabel}</span>
            <strong>{money(i.sales_tax)}</strong>
          </p>
          <p>
            <span>Grand Total</span>
            <strong>{money(i.grand_total)}</strong>
          </p>
        </div>
      </div>
      <p className="amount-words">
        <strong>Amount in Words:</strong> {numberWords(i.grand_total)}
      </p>
    </article>
  );
}
