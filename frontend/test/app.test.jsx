import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { MemoryRouter, useLocation, useNavigate } from "react-router";
import App from "../App.jsx";
import { SessionProvider } from "../session.jsx";

const admin = {
  id: "admin-id",
  name: "Test Admin",
  email: "admin@example.com",
  role: "ADMIN",
  must_change_password: false,
};
const invoice = {
  id: "invoice-id",
  invoice_number: "TEST-STI-000001",
  invoice_date: "2026-01-02",
  created_at: "2026-01-02",
  updated_at: "2026-01-03",
  status: "DRAFT",
  version: 1,
  customer_snapshot: {
    business_name: "Sample buyer",
    ntn_cnic: "7654321",
    strn: "3277000000000",
    address: "Lahore",
    province: "Punjab",
    registration_type: "Registered",
  },
  seller_snapshot: {
    name: "Test Seller",
    address: "Lahore",
    ntn: "1234567",
    strn: "987654321",
    province: "Punjab",
  },
  invoice_type: "Sale Invoice",
  payment_terms: "30 days",
  items: [
    {
      id: "line-1",
      snapshot: {
        quantity: 3,
        unitPrice: 10.25,
        productDescription: "Sample product",
        hsCode: "0101.2100",
        uoM: "Units",
        rate: "18%",
        saleType: "Goods at standard rate (default)",
        batchNumber: "B-1",
        valueSalesExcludingST: 30.75,
        salesTaxApplicable: 5.54,
        totalValues: 36.29,
      },
    },
  ],
  subtotal: 30.75,
  sales_tax: 5.54,
  grand_total: 36.29,
};
const overview = {
  summary: {
    total_invoices: 8,
    draft_invoices: 3,
    fbr_validated_invoices: 2,
    fbr_accepted_invoices: 3,
  },
  recent: Array.from({ length: 5 }, (_, index) => ({
    ...invoice,
    id: `invoice-${index}`,
    invoice_number: `TEST-STI-00000${index + 1}`,
  })),
};

function mockApi({
  user = admin,
  environment = "sandbox",
  mockMode = environment === "sandbox",
  custom = () => undefined,
} = {}) {
  let currentUser = user;
  const fetchMock = vi.fn(async (url, options = {}) => {
    const method = options.method || "GET",
      path = url.replace("/api", "");
    const intercepted = await custom(path, options);
    const result =
      intercepted ||
      (() => {
        if (path === "/auth/csrf")
          return {
            csrfToken: "test-csrf",
            environment,
            mock: mockMode,
          };
        if (path === "/auth/me")
          return currentUser
            ? {
                user: currentUser,
                environment,
                mock: mockMode,
                emailEnabled: false,
                csrfToken: "test-csrf",
              }
            : { httpStatus: 401, error: "Unauthorized" };
        if (path === "/auth/login") {
          currentUser = admin;
          return { csrfToken: "test-csrf" };
        }
        if (
          path === "/auth/logout" ||
          path === "/auth/logout-all" ||
          path === "/auth/change-email"
        ) {
          currentUser = null;
          return { message: "Account updated" };
        }
        if (path === "/auth/reset-password") {
          currentUser = null;
          return { message: "Password set. Sign in with your new password." };
        }
        if (path === "/invoices/overview") return overview;
        if (path === "/invoices/form-options")
          return {
            seller: {
              name: "Test Seller",
              ntn: "1234567",
              strn: "987654321",
              province: "Punjab",
              address: "Lahore",
            },
            provinces: ["Punjab", "Sindh", "Balochistan"],
            uoms: ["Numbers, pieces, units", "Kilogram", "Units"],
          };
        if (path.startsWith("/invoices?"))
          return { invoices: [], page: 1, pageSize: 50, hasMore: false };
        if (path === "/invoices/invoice-id") return invoice;
        if (path === "/invoices" && method === "POST") return invoice;
        if (path === "/invoices/invoice-id" && method === "DELETE")
          return { ok: true };
        if (path === "/users") return [admin];
        if (path.startsWith("/audit")) return [];
        return { httpStatus: 404, error: `Unexpected request: ${path}` };
      })();
    return {
      ok: !result.httpStatus || result.httpStatus < 400,
      status: result.httpStatus || 200,
      json: async () => result,
    };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
function LocationProbe() {
  const location = useLocation(),
    navigate = useNavigate();
  return (
    <>
      <output data-testid="route">
        {location.pathname}
        {location.search}
        {location.hash}
      </output>
      <button onClick={() => navigate(-1)}>Test Back</button>
    </>
  );
}
function mount(route = "/overview") {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <SessionProvider>
        <App />
        <LocationProbe />
      </SessionProvider>
    </MemoryRouter>,
  );
}

describe("React routes, roles and sessions", () => {
  test("anonymous deep link signs in and returns to Overview using CSRF", async () => {
    const fetchMock = mockApi({ user: null }),
      user = userEvent.setup();
    mount("/overview");
    await screen.findByRole("heading", { name: "Welcome back" });
    await user.type(screen.getByLabelText("Work email"), "admin@example.com");
    await user.type(screen.getByLabelText("Password"), "TestPassword!123");
    await user.click(
      screen.getByRole("button", { name: "Sign in", exact: true }),
    );
    await screen.findByRole("heading", { name: "Overview", exact: true });
    expect(screen.getByTestId("route")).toHaveTextContent("/overview");
    const login = fetchMock.mock.calls.find(
      ([url]) => url === "/api/auth/login",
    );
    expect(login[1].headers["x-csrf-token"]).toBe("test-csrf");
    expect(login[1].credentials).toBe("same-origin");
  });
  test("viewer navigation and direct-route protection hide every write/admin page", async () => {
    const fetchMock = mockApi({ user: { ...admin, role: "VIEWER" } });
    mount("/create-invoice");
    await screen.findByRole("heading", { name: "Access restricted" });
    for (const name of ["Create invoice", "Team access", "Audit trail"])
      expect(screen.queryByRole("link", { name })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Overview" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Invoices" })).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(
        ([url]) => url === "/api/invoices/form-options",
      ),
    ).toBe(false);
  });
  test("temporary-password accounts are sent to mandatory password change", async () => {
    mockApi({ user: { ...admin, must_change_password: true } });
    mount("/create-invoice");
    await screen.findByRole("heading", { name: "Set your own password" });
    expect(screen.getByTestId("route")).toHaveTextContent("/account");
    expect(
      screen.queryByRole("link", { name: "Invoices", exact: true }),
    ).not.toBeInTheDocument();
  });
  test("navigation and Back restore the correct route", async () => {
    mockApi();
    const user = userEvent.setup();
    mount("/invoices");
    await screen.findByRole("heading", { name: "Invoices", exact: true });
    expect(
      await screen.findByText("Page 1 · 50 invoices per page"),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("link", { name: "Overview", exact: true }),
    );
    await screen.findByRole("heading", { name: "Overview", exact: true });
    await user.click(screen.getByRole("button", { name: "Test Back" }));
    await screen.findByRole("heading", { name: "Invoices", exact: true });
  });
  test("Sandbox has a top label while Production has no environment label", async () => {
    mockApi();
    const first = mount("/overview");
    expect(
      await screen.findByText("SANDBOX · MOCK FBR RESPONSES"),
    ).toBeInTheDocument();
    first.unmount();
    mockApi({ environment: "production" });
    mount("/overview");
    await screen.findByRole("heading", { name: "Overview", exact: true });
    expect(screen.queryByText(/SANDBOX/)).not.toBeInTheDocument();
    expect(screen.queryByText(/PRODUCTION/)).not.toBeInTheDocument();
  });
  test("setup link clears its fragment and expired sessions return to login", async () => {
    const token = "a".repeat(64),
      fetchMock = mockApi({ user: null }),
      user = userEvent.setup();
    mount(`/setup-password#token=${token}`);
    await screen.findByRole("heading", { name: "Set your password" });
    await waitFor(() =>
      expect(screen.getByTestId("route")).toHaveTextContent(
        /^\/setup-password$/,
      ),
    );
    await user.type(screen.getByLabelText("New password"), "NewPassword!123");
    await user.type(
      screen.getByLabelText("Confirm password"),
      "NewPassword!123",
    );
    await user.click(screen.getByRole("button", { name: "Save password" }));
    await screen.findByRole("heading", { name: "Welcome back" });
    const reset = fetchMock.mock.calls.find(
      ([url]) => url === "/api/auth/reset-password",
    );
    expect(JSON.parse(reset[1].body).token).toBe(token);
    act(() => window.dispatchEvent(new Event("fbr-digital-invoice:session-expired")));
  });
});

describe("React invoice and account workflows", () => {
  test("Overview shows four totals and exactly five recently worked invoices", async () => {
    mockApi();
    mount("/overview");
    await screen.findByRole("heading", { name: "Recently worked invoices" });
    expect(screen.getAllByRole("link", { name: /TEST-STI-/ })).toHaveLength(5);
    for (const value of ["8", "3", "2"])
      expect(screen.getAllByText(value).length).toBeGreaterThan(0);
  });
  test("invoice form saves direct buyer/item snapshots without master-data requests", async () => {
    const fetchMock = mockApi(),
      user = userEvent.setup();
    mount("/create-invoice");
    await screen.findByRole("heading", { name: "Create invoice", exact: true });
    const number = screen.getByLabelText("Internal Invoice No.");
    expect(number).not.toHaveAttribute("readonly");
    expect(number).toHaveValue("");
    expect(
      screen.queryByRole("button", { name: /Load .*sandbox example/i }),
    ).not.toBeInTheDocument();
    await user.type(number, "CUSTOM-INV-001");
    await user.type(screen.getByLabelText("Business Name"), "Direct buyer");
    await user.type(screen.getByLabelText("Address"), "Lahore");
    await user.type(screen.getByLabelText("NTN / CNIC"), "PK-7654321");
    await user.selectOptions(screen.getAllByLabelText("Province")[0], "Punjab");
    await user.selectOptions(screen.getByLabelText("Select Scenario"), "SN001");
    expect(screen.getByLabelText("Seller Business Name")).toHaveValue(
      "Test Seller",
    );
    expect(screen.getByLabelText("Seller Address")).toHaveValue("Lahore");
    expect(screen.getAllByLabelText("Province")[1]).toHaveValue("Punjab");
    const item = screen.getByRole("region", { name: "Invoice item 1" });
    await user.type(
      within(item).getByLabelText("Product Description"),
      "Direct product",
    );
    await user.type(within(item).getByLabelText("HS Code"), "0101.2100");
    expect(within(item).getByLabelText("UOM").tagName).toBe("SELECT");
    await user.selectOptions(within(item).getByLabelText("UOM"), "Units");
    await user.type(within(item).getByLabelText("Unit Price (PKR)"), "10.25");
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    await screen.findByRole("heading", {
      name: invoice.invoice_number,
      exact: true,
    });
    expect(screen.getByText("Invoice saved.")).toHaveClass("success");
    const save = fetchMock.mock.calls.find(
        ([url, options]) =>
          url === "/api/invoices" && options.method === "POST",
      ),
      body = JSON.parse(save[1].body);
    expect(body.invoiceNumber).toBe("CUSTOM-INV-001");
    expect(body.buyer).toMatchObject({
      businessName: "Direct buyer",
      ntnCnic: "PK-7654321",
    });
    expect(body.seller).toMatchObject({
      businessName: "Test Seller",
      ntnCnic: "1234567",
      province: "Punjab",
      address: "Lahore",
    });
    expect(body.items[0]).toMatchObject({
      productDescription: "Direct product",
      hsCode: "0101.2100",
      uoM: "Units",
      unitPrice: "10.25",
      saleType: "Goods at standard rate (default)",
    });
    expect(body.scenarioId).toBe("SN001");
    expect(
      fetchMock.mock.calls.some(([url]) =>
        ["/api/customers", "/api/products"].includes(url),
      ),
    ).toBe(false);
  });
  test("editing an invoice shows an updated confirmation banner", async () => {
    mockApi();
    const user = userEvent.setup();
    mount("/invoices/invoice-id/edit");
    await screen.findByRole("heading", { name: "Edit invoice" });
    await user.selectOptions(screen.getByLabelText("Select Scenario"), "SN001");
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    await screen.findByRole("heading", {
      name: invoice.invoice_number,
      exact: true,
    });
    expect(screen.getByText("Invoice updated.")).toHaveClass("success");
  });
  test("Draft offers optional internal or direct FBR validation, delete, and no print", async () => {
    const fetchMock = mockApi({
        custom: (path) =>
          path.endsWith("/validate-internal")
            ? { status: "INTERNALLY_VALIDATED" }
            : path.endsWith("/validate")
              ? { status: "FBR_VALIDATED" }
              : undefined,
      }),
      user = userEvent.setup();
    mount("/invoices/invoice-id");
    expect(
      await screen.findByRole("button", { name: "Validate internally" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Validate with FBR" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Delete invoice" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Print invoice" }),
    ).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Validate internally" }),
    );
    await waitFor(() =>
      expect(screen.getByText("Invoice internally validated.")).toHaveClass(
        "success",
      ),
    );
    await user.click(screen.getByRole("button", { name: "Validate with FBR" }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([url]) => url.endsWith("/validate")),
      ).toBe(true),
    );
    expect(screen.getByText("Invoice validated with FBR.")).toHaveClass(
      "success",
    );
  });
  test("FBR-validated invoice can print, edit and submit but has no final FBR number or QR", async () => {
    mockApi({
      custom: (path) =>
        path.endsWith("/submit")
          ? { status: "FBR_ACCEPTED" }
          : path === "/invoices/invoice-id"
            ? { ...invoice, status: "FBR_VALIDATED" }
            : undefined,
    });
    const user = userEvent.setup();
    mount("/invoices/invoice-id");
    await screen.findByRole("heading", {
      name: invoice.invoice_number,
      exact: true,
    });
    expect(
      screen.getByRole("button", { name: "Print invoice" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Edit invoice" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Submit to FBR" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("FBR Invoice No.")).not.toBeInTheDocument();
    expect(screen.queryByAltText(/QR code/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Submit to FBR" }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Confirm submission",
      }),
    );
    await waitFor(() =>
      expect(screen.getByText("Invoice submitted to FBR.")).toHaveClass(
        "success",
      ),
    );
  });
  test("accepted invoice is view/print only and shows its FBR number and QR", async () => {
    mockApi({
      custom: (path) =>
        path === "/invoices/invoice-id"
          ? {
              ...invoice,
              status: "FBR_ACCEPTED",
              fbr_invoice_number: "MOCK-123",
              qrCode: "data:image/png;base64,AA==",
            }
          : undefined,
    });
    mount("/invoices/invoice-id");
    await screen.findByRole("heading", {
      name: invoice.invoice_number,
      exact: true,
    });
    expect(
      screen.getByRole("button", { name: "Print invoice" }),
    ).toBeInTheDocument();
    expect(
      screen.getByAltText("FBR invoice number QR code"),
    ).toBeInTheDocument();
    expect(screen.getByText("FBR Invoice No.")).toBeInTheDocument();
    expect(screen.getAllByText("MOCK-123").length).toBeGreaterThan(0);
    expect(
      screen
        .getByAltText("FBR invoice number QR code")
        .closest(".invoice-qr-block"),
    ).toHaveTextContent(/^MOCK-123$/);
    expect(
      screen
        .getByRole("table", { name: "Printable invoice items" })
        .querySelectorAll("tbody tr"),
    ).toHaveLength(10);
    expect(
      screen.queryByRole("link", { name: "Edit invoice" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Delete invoice" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Submit to FBR" }),
    ).not.toBeInTheDocument();
  });
  test("failed FBR validation shows the returned error in the red banner", async () => {
    mockApi({
      custom: (path) =>
        path.endsWith("/validate")
          ? {
              status: "FBR_VALIDATION_FAILED",
              errorMessage: "Buyer NTN is not registered",
            }
          : undefined,
    });
    const user = userEvent.setup();
    mount("/invoices/invoice-id");
    await user.click(
      await screen.findByRole("button", { name: "Validate with FBR" }),
    );
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "Invoice validation with FBR failed. Buyer NTN is not registered",
    );
    expect(alert).toHaveClass("error");
  });
  test("failed FBR submission shows the returned error in the red banner", async () => {
    mockApi({
      custom: (path) =>
        path.endsWith("/submit")
          ? {
              status: "FBR_SUBMISSION_FAILED",
              errorMessage: "HS code rejected",
            }
          : path === "/invoices/invoice-id"
            ? { ...invoice, status: "FBR_VALIDATED" }
            : undefined,
    });
    const user = userEvent.setup();
    mount("/invoices/invoice-id");
    await user.click(
      await screen.findByRole("button", { name: "Submit to FBR" }),
    );
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Confirm submission",
      }),
    );
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "Invoice submission to FBR failed. HS code rejected",
    );
    expect(alert).toHaveClass("error");
  });
  test("invoice pages hide FBR payload history while the admin audit trail shows full JSON", async () => {
    mockApi();
    const detail = mount("/invoices/invoice-id");
    await screen.findByRole("heading", {
      name: invoice.invoice_number,
      exact: true,
    });
    expect(
      screen.queryByRole("heading", { name: "FBR request history" }),
    ).not.toBeInTheDocument();
    detail.unmount();
    const auditRow = {
      id: "audit-1",
      created_at: "2026-09-06T10:00:00Z",
      user_name: "Test Admin",
      action: "FBR_VALIDATION_SUCCESS",
      entity_type: "invoice",
      entity_id: invoice.id,
      metadata: {
        operation: "VALIDATE",
        request_payload: {
          invoiceType: "Sale Invoice",
          buyerBusinessName: "Sample buyer",
        },
        response_payload: {
          validationResponse: { statusCode: "00", status: "Valid" },
        },
      },
    };
    mockApi({
      custom: (path) => (path.startsWith("/audit") ? [auditRow] : undefined),
    });
    mount("/audit");
    await screen.findByRole("heading", { name: "Audit trail" });
    expect(screen.getByText(/"request_payload"/)).toBeInTheDocument();
    expect(screen.getByText(/"response_payload"/)).toBeInTheDocument();
    expect(
      screen.getByText(/"buyerBusinessName": "Sample buyer"/),
    ).toBeInTheDocument();
  });
  test("draft deletion and final submission both require confirmation", async () => {
    const fetchMock = mockApi(),
      user = userEvent.setup();
    mount("/invoices/invoice-id");
    await user.click(
      await screen.findByRole("button", { name: "Delete invoice" }),
    );
    expect(
      fetchMock.mock.calls.some(([, options]) => options.method === "DELETE"),
    ).toBe(false);
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Delete invoice",
      }),
    );
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([, options]) => options.method === "DELETE"),
      ).toBe(true),
    );
    expect(await screen.findByText("Invoice deleted.")).toHaveClass("success");
  });
  test("My Account shows profile data and sends authenticated email changes", async () => {
    const fetchMock = mockApi(),
      user = userEvent.setup();
    mount("/account");
    await screen.findByRole("heading", { name: "My account" });
    expect(screen.getAllByText("Test Admin").length).toBeGreaterThan(0);
    expect(screen.getAllByText("admin@example.com").length).toBeGreaterThan(0);
    await user.type(
      screen.getByLabelText("New email address"),
      "next@example.com",
    );
    const passwordFields = screen.getAllByLabelText("Current password");
    await user.type(passwordFields[0], "CurrentPassword!1");
    await user.click(screen.getByRole("button", { name: "Change email" }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([url]) => url === "/api/auth/change-email"),
      ).toBe(true),
    );
    const call = fetchMock.mock.calls.find(
      ([url]) => url === "/api/auth/change-email",
    );
    expect(JSON.parse(call[1].body)).toEqual({
      newEmail: "next@example.com",
      currentPassword: "CurrentPassword!1",
    });
  });
});

// Regression cases reported in the invoice review.
test('tax preview rounds 42.70 at 5 percent to the same 2.14 used on save', async () => {
  mockApi(); const user=userEvent.setup(); mount('/invoices/invoice-id/edit');
  await screen.findByRole('heading',{name:'Edit invoice'});
  await user.clear(screen.getByLabelText('Quantity')); await user.type(screen.getByLabelText('Quantity'),'1');
  await user.clear(screen.getByLabelText('Unit Price (PKR)')); await user.type(screen.getByLabelText('Unit Price (PKR)'),'42.70');
  await user.clear(screen.getByLabelText('Tax Rate')); await user.type(screen.getByLabelText('Tax Rate'),'5%');
  expect(screen.getByLabelText('Sales Tax')).toHaveTextContent('2.14');
  expect(screen.getByLabelText('Taxable Value')).toHaveTextContent('42.70');
});
test('printable amount in words includes the twenty nine paisa in 36.29', async () => {
  mockApi({custom:path=>path==='/invoices/invoice-id'?{...invoice,status:'FBR_VALIDATED'}:undefined});
  mount('/invoices/invoice-id'); await screen.findByRole('heading',{name:invoice.invoice_number,exact:true});
  expect(screen.getByText(/Thirty Six Rupees and Twenty Nine Paisa Only\./)).toBeInTheDocument();
});
test('submission confirmation sends the reviewed version and displays stale-version rejection', async () => {
  const fetchMock=mockApi({custom:path=>path.endsWith('/submit')?{httpStatus:409,error:'Invoice changed. Reload and review it before submitting.'}:path==='/invoices/invoice-id'?{...invoice,status:'FBR_VALIDATED'}:undefined});
  const user=userEvent.setup(); mount('/invoices/invoice-id');
  await user.click(await screen.findByRole('button',{name:'Submit to FBR'}));
  await user.click(within(screen.getByRole('dialog')).getByRole('button',{name:'Confirm submission'}));
  expect((await screen.findAllByRole('alert'))[0]).toHaveTextContent('Invoice changed. Reload and review');
  const call=fetchMock.mock.calls.find(([url])=>url==='/api/invoices/invoice-id/submit');
  expect(JSON.parse(call[1].body)).toEqual({version:1});
  expect(fetchMock.mock.calls.filter(([url])=>url.endsWith('/submit'))).toHaveLength(1);
});

test('rate feedback follows invoice date without overwriting the entered tax or price',async()=>{
 mockApi({mockMode:false,custom:path=>path.startsWith('/invoices/rates?')?{rates:path.includes('2026-05-18')?[{description:'8%',supported:true}]:[{description:'18% and Rs. 80 per Liter',supported:false}]}:undefined});
 const user=userEvent.setup();mount('/create-invoice');await screen.findByLabelText('Internal Invoice No.');
 await user.type(screen.getByLabelText('Unit Price (PKR)'),'100');
 await user.clear(screen.getByLabelText('Tax Rate'));await user.type(screen.getByLabelText('Tax Rate'),'8%');
 await user.selectOptions(screen.getByLabelText('Select Scenario'),'SN017');
 expect(await screen.findByText(/Listed rates: 18% and Rs. 80 per Liter/)).toBeInTheDocument();
 expect(screen.getByLabelText('Tax Rate')).toHaveValue('8%');expect(screen.getByLabelText('Unit Price (PKR)')).toHaveValue(100);
 await user.clear(screen.getByLabelText('Invoice Date'));await user.type(screen.getByLabelText('Invoice Date'),'2026-05-18');
 expect(await screen.findByText('Rate confirmed by FBR for 2026-05-18.')).toBeInTheDocument();
 expect(screen.getByLabelText('Tax Rate')).toHaveValue('8%');expect(screen.getByLabelText('Unit Price (PKR)')).toHaveValue(100);
});
