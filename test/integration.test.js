import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import EmbeddedPostgres from "embedded-postgres";
import request from "supertest";
import bcrypt from "bcrypt";
import { migrate } from "../scripts/migrate.js";
import { readConfig } from "../src/config/env.js";
import { createPool, bindEnvironment } from "../src/config/database.js";
import { createApp } from "../src/app.js";
import { hashToken, sendToken } from "../src/auth/auth.service.js";
let cluster, pool, app, temp, config, admin, creator, viewer;
const secret = "Test-only-Secure!54321",
  changed = "Different-Secure!78654";
const mail = [];
const mailer = {
  available: true,
  send: async (to, url, purpose) => mail.push({ to, url, purpose }),
};
let requests = 0,
  behavior = "ok";
const client = {
  request: async (operation) => {
    requests++;
    await new Promise((r) => setTimeout(r, 40));
    if (behavior === "timeout")
      return { httpStatus: null, response: { error: "Connection timeout" } };
    if (behavior === "rejected")
      return {
        httpStatus: 200,
        response: {
          validationResponse: {
            statusCode: "01",
            status: "Invalid",
            error: "HS code rejected",
          },
        },
      };
    return {
      httpStatus: 200,
      response: {
        ...(operation === "SUBMIT"
          ? { invoiceNumber: `MOCK-${randomUUID()}` }
          : {}),
        validationResponse: {
          statusCode: "00",
          status: "Valid",
          error: "",
          invoiceStatuses: [],
        },
      },
    };
  },
  reference: async () => [],
};
async function freePort() {
  const s = createServer();
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  const port = s.address().port;
  await new Promise((r) => s.close(r));
  return port;
}
async function seed(email, role = "ADMIN", mustChange = false) {
  const id = randomUUID();
  await pool.query(
    "INSERT INTO users(id,name,email,password_hash,role,must_change_password) VALUES($1,$2,$3,$4,$5,$6)",
    [id, role, email, await bcrypt.hash(secret, 12), role, mustChange],
  );
  return id;
}
async function login(email, password = secret) {
  const agent = request.agent(app);
  const boot = await agent.get("/api/auth/csrf").expect(200);
  let csrf = boot.body.csrfToken;
  const r = await agent
    .post("/api/auth/login")
    .set("x-csrf-token", csrf)
    .send({ email, password })
    .expect(200);
  csrf = r.body.csrfToken;
  return { agent, csrf };
}
const write = (actor, path, body = {}, method = "post") =>
  actor.agent[method](path).set("x-csrf-token", actor.csrf).send(body);
let invoiceSerial = 0;
const draft = () => ({
  invoiceNumber: `BT-TEST-${String(++invoiceSerial).padStart(5, "0")}`,
  seller: {
    businessName: "Test seller",
    ntnCnic: "1234567",
    strn: "3277000000000",
    province: "Punjab",
    address: "Test address",
  },
  buyer: {
    businessName: "Test customer",
    ntnCnic: "7654321",
    strn: "3277000000000",
    registrationType: "Registered",
    province: "Punjab",
    address: "Lahore",
  },
  invoiceDate: "2026-01-02",
  scenarioId: "SN001",
  items: [
    {
      productDescription: "Test product",
      hsCode: "0101.2100",
      uoM: "Numbers, pieces, units",
      rate: "18%",
      saleType: "Goods at standard rate (default)",
      batchNumber: "B-123",
      quantity: "3",
      unitPrice: "10.25",
    },
  ],
  grandTotal: 0,
});
async function invoice() {
  const r = await write(creator, "/api/invoices", draft()).expect(201);
  return r.body;
}
before(async () => {
  temp = await mkdtemp(join(tmpdir(), "fbr-digital-invoice-test-"));
  const port = await freePort();
  cluster = new EmbeddedPostgres({
    databaseDir: join(temp, "db"),
    user: "postgres",
    password: randomBytes(16).toString("hex"),
    port,
    persistent: false,
    authMethod: "scram-sha-256",
    postgresFlags: ["-h", "127.0.0.1"],
    onLog: () => {},
    onError: () => {},
  });
  await cluster.initialise();
  await cluster.start();
  await cluster.createDatabase("fbr_digital_invoice_sandbox");
  // Use the package client configuration without exposing connection credentials.
  const pgClient = cluster.getPgClient();
  config = readConfig({
    APP_ENV: "sandbox",
    FBR_MODE: "sandbox",
    FBR_MOCK: "true",
    APP_URL: "http://localhost:3000",
    SESSION_SECRET: randomBytes(48).toString("hex"),
    DATABASE_URL: `postgres://postgres:${pgClient.connectionParameters.password}@127.0.0.1:${port}/fbr_digital_invoice_sandbox`,
    SELLER_NAME: "Test seller",
    SELLER_NTN: "1234567",
    SELLER_ADDRESS: "Test address",
    SELLER_PROVINCE: "Punjab",
  });
  pool = createPool(config);
  await migrate(pool);
  await migrate(pool);
  await bindEnvironment(pool, config);
  app = createApp({ pool, config, client, mailer });
  await seed("admin@example.com");
  await seed("creator@example.com", "ACCOUNTANT");
  await seed("viewer@example.com", "VIEWER");
  admin = await login("admin@example.com");
  creator = await login("creator@example.com");
  viewer = await login("viewer@example.com");
});
after(async () => {
  app?.locals.sessionStore.close();
  if (pool) await pool.end();
  if (cluster) await cluster.stop();
  if (temp) await rm(temp, { recursive: true, force: true });
});
test("anonymous FBR/invoice access is 401; registration does not exist", async () => {
  for (const path of [
    "/api/fbr/submit",
    "/api/invoices",
    "/api/invoices/00000000-0000-4000-8000-000000000000/submit",
  ])
    await request(app).post(path).send({}).expect(401);
  for (const path of ["/register", "/signup", "/create-first-admin"])
    await request(app).get(path).expect(404);
});
test("CSRF and same-origin checks reject forged state changes", async () => {
  await creator.agent.post("/api/invoices").send(draft()).expect(403);
  await write(creator, "/api/invoices", draft())
    .set("Origin", "https://evil.example")
    .expect(403);
  const token = (await request(app).get("/api/auth/csrf")).body.csrfToken;
  assert.equal(token.length, 64);
});
test("viewer cannot mutate and accountant cannot manage users or see audit logs", async () => {
  await write(viewer, "/api/invoices", draft()).expect(403);
  await creator.agent.get("/api/users").expect(403);
  await creator.agent.get("/api/audit").expect(403);
  await creator.agent.get("/api/customers").expect(404);
  await creator.agent.get("/api/products").expect(404);
});
test("first login requires a different password and invalidates the session", async () => {
  await seed("bootstrap@example.com", "VIEWER", true);
  const actor = await login("bootstrap@example.com");
  await actor.agent.get("/api/invoices").expect(403);
  await write(actor, "/api/auth/change-password", {
    currentPassword: secret,
    password: secret,
  }).expect(400);
  await write(actor, "/api/auth/change-password", {
    currentPassword: secret,
    password: changed,
  }).expect(200);
  await actor.agent.get("/api/auth/me").expect(401);
  const fresh = await login("bootstrap@example.com", changed);
  await fresh.agent.get("/api/invoices").expect(200);
});
test("server calculates totals and stores direct buyer and item snapshots", async () => {
  const inv = await invoice();
  assert.equal(Number(inv.subtotal), 30.75);
  assert.equal(Number(inv.sales_tax), 5.54);
  assert.equal(Number(inv.grand_total), 36.29);
  const fetched = (
    await viewer.agent.get(`/api/invoices/${inv.id}`).expect(200)
  ).body;
  assert.equal(fetched.items[0].snapshot.productDescription, "Test product");
  assert.equal(fetched.items[0].snapshot.batchNumber, "B-123");
  assert.equal(fetched.customer_snapshot.business_name, "Test customer");
  assert.equal(fetched.seller_snapshot.address, "Test address");
  assert.match(fetched.invoice_number, /^BT-TEST-/);
});
test("alphanumeric seller and buyer NTN/CNIC values can be saved and validated with FBR", async () => {
  const payload = draft();
  payload.seller.ntnCnic = "A123456";
  payload.buyer.ntnCnic = "A765432";
  const saved = (await write(creator, "/api/invoices", payload).expect(201))
    .body;
  assert.equal(saved.seller_snapshot.ntn, "A123456");
  assert.equal(saved.customer_snapshot.ntn_cnic, "A765432");
  const validated = await write(
    creator,
    `/api/invoices/${saved.id}/validate`,
  ).expect(200);
  assert.equal(validated.body.status, "FBR_VALIDATED");
});
test("failed FBR operations return the recorded FBR error message to the page", async () => {
  const inv = await invoice();
  behavior = "rejected";
  const response = await write(
    creator,
    `/api/invoices/${inv.id}/validate`,
  ).expect(200);
  behavior = "ok";
  assert.equal(response.body.status, "FBR_VALIDATION_FAILED");
  assert.equal(response.body.errorMessage, "HS code rejected");
});
test("invoice form options include populated provinces, UOM choices and complete editable seller defaults", async () => {
  const response = (
    await creator.agent.get("/api/invoices/form-options").expect(200)
  ).body;
  assert.ok(response.provinces.includes("Punjab"));
  assert.ok(response.uoms.includes("Numbers, pieces, units"));
  assert.deepEqual(response.seller, {
    name: "Test seller",
    ntn: "1234567",
    strn: "",
    province: "Punjab",
    address: "Test address",
  });
});
test("internal validation is optional and every edit returns a validated invoice to draft", async () => {
  const inv = await invoice();
  const calls = requests;
  await write(creator, `/api/invoices/${inv.id}/validate`).expect(200);
  assert.equal(requests, calls + 1);
  await write(
    creator,
    `/api/invoices/${inv.id}`,
    { ...draft(), version: 999 },
    "put",
  ).expect(409);
  const result = await write(
    creator,
    `/api/invoices/${inv.id}`,
    { ...draft(), version: 1 },
    "put",
  ).expect(200);
  assert.equal(result.body.status, "DRAFT");
  const internal = await write(
    creator,
    `/api/invoices/${inv.id}/validate-internal`,
  ).expect(200);
  assert.equal(internal.body.status, "INTERNALLY_VALIDATED");
  await write(creator, `/api/invoices/${inv.id}/validate`).expect(200);
  await write(creator, `/api/invoices/${inv.id}/submit`, { version: result.body.version }).expect(200);
  await write(creator, "/api/invoices", {
    ...draft(),
    items: [{ ...draft().items[0], quantity: -2 }],
  }).expect(400);
});
test("concurrent submit produces exactly one FBR call and accepted invoices cannot be changed", async () => {
  const inv = await invoice();
  await write(creator, `/api/invoices/${inv.id}/submit`, { version: inv.version }).expect(409);
  await write(creator, `/api/invoices/${inv.id}/validate`).expect(200);
  const before = requests;
  const results = await Promise.all([
    write(creator, `/api/invoices/${inv.id}/submit`, { version: inv.version }),
    write(creator, `/api/invoices/${inv.id}/submit`, { version: inv.version }),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  assert.equal(requests - before, 1);
  await write(
    creator,
    `/api/invoices/${inv.id}`,
    { ...draft(), version: 1 },
    "put",
  ).expect(409);
  await write(creator, `/api/invoices/${inv.id}/validate-internal`).expect(409);
  await write(creator, `/api/invoices/${inv.id}/validate`).expect(409);
  await write(creator, `/api/invoices/${inv.id}/submit`, { version: inv.version }).expect(409);
  await write(creator, `/api/invoices/${inv.id}`, {}, "delete").expect(409);
  const row = (await viewer.agent.get(`/api/invoices/${inv.id}`)).body;
  assert.equal(row.submissions, undefined);
  assert.equal(row.status, "FBR_ACCEPTED");
  assert.ok(row.fbr_invoice_number);
  const {
    rows: [stored],
  } = await pool.query(
    "SELECT count(*)::int AS count FROM fbr_submissions WHERE invoice_id=$1",
    [inv.id],
  );
  assert.equal(stored.count, 2);
  const {
    rows: [logged],
  } = await pool.query(
    "SELECT metadata FROM audit_logs WHERE entity_id=$1 AND action='FBR_SUBMISSION_SUCCESS' ORDER BY created_at DESC LIMIT 1",
    [inv.id],
  );
  assert.equal(logged.metadata.operation, "SUBMIT");
  assert.equal(
    logged.metadata.request_payload.sellerBusinessName,
    "Test seller",
  );
  assert.equal(
    logged.metadata.response_payload.validationResponse.statusCode,
    "00",
  );
  assert.ok(logged.metadata.response_payload.invoiceNumber);
});
test("unknown submit outcome is durable and cannot be retried or edited", async () => {
  const inv = await invoice();
  await write(creator, `/api/invoices/${inv.id}/validate`).expect(200);
  behavior = "timeout";
  const response = await write(
    creator,
    `/api/invoices/${inv.id}/submit`,
    { version: inv.version },
  ).expect(200);
  behavior = "ok";
  assert.equal(response.body.status, "SUBMISSION_UNKNOWN");
  assert.equal(response.body.errorMessage, "Connection timeout");
  await write(creator, `/api/invoices/${inv.id}/submit`, { version: inv.version }).expect(409);
  await write(creator, `/api/invoices/${inv.id}/validate`).expect(409);
  await write(
    creator,
    `/api/invoices/${inv.id}`,
    { ...draft(), version: 1 },
    "put",
  ).expect(409);
});
test("draft invoices can be deleted and the overview returns the five latest activities", async () => {
  const deleted = await invoice();
  await write(creator, `/api/invoices/${deleted.id}`, {}, "delete").expect(200);
  await viewer.agent.get(`/api/invoices/${deleted.id}`).expect(404);
  const ids = [];
  for (let index = 0; index < 6; index++) ids.push((await invoice()).id);
  await write(creator, `/api/invoices/${ids[0]}/validate-internal`).expect(200);
  const overview = (
    await viewer.agent.get("/api/invoices/overview").expect(200)
  ).body;
  assert.equal(overview.recent.length, 5);
  assert.equal(overview.recent[0].id, ids[0]);
  assert.ok(overview.summary.total_invoices >= 6);
  assert.ok(overview.summary.draft_invoices >= 5);
});
test("users can change their email with their password and all sessions are revoked", async () => {
  await write(viewer, "/api/auth/change-email", {
    newEmail: "admin@example.com",
    currentPassword: secret,
  }).expect(409);
  await write(viewer, "/api/auth/change-email", {
    newEmail: "updated-viewer@example.com",
    currentPassword: "wrong",
  }).expect(400);
  await write(viewer, "/api/auth/change-email", {
    newEmail: "updated-viewer@example.com",
    currentPassword: secret,
  }).expect(200);
  await viewer.agent.get("/api/auth/me").expect(401);
  const {
    rows: [saved],
  } = await pool.query(
    "SELECT email,session_version FROM users WHERE email='updated-viewer@example.com'",
  );
  assert.equal(saved.email, "updated-viewer@example.com");
  assert.ok(saved.session_version > 0);
});
test("one-time setup token is hashed, single-use, environment-specific and revokes sessions", async () => {
  const response = await write(admin, "/api/users", {
    name: "New employee",
    email: "NEW@EXAMPLE.COM",
    role: "VIEWER",
  }).expect(201);
  const id = response.body.id;
  assert.equal(response.body.temporaryPassword, undefined);
  const message = mail.find((m) => m.to === "new@example.com");
  assert.ok(message.url.startsWith(config.appUrl));
  const token = new URL(message.url).hash.slice(7);
  const {
    rows: [stored],
  } = await pool.query("SELECT * FROM password_reset_tokens WHERE user_id=$1", [
    id,
  ]);
  assert.equal(stored.token_hash, hashToken(token));
  assert.notEqual(stored.token_hash, token);
  const anonymous = request.agent(app),
    csrf = (await anonymous.get("/api/auth/csrf")).body.csrfToken;
  await anonymous
    .post("/api/auth/reset-password")
    .set("x-csrf-token", csrf)
    .send({ token, password: changed })
    .expect(200);
  const next = (await anonymous.get("/api/auth/csrf")).body.csrfToken;
  await anonymous
    .post("/api/auth/reset-password")
    .set("x-csrf-token", next)
    .send({ token, password: secret })
    .expect(400);
  const active = await login("new@example.com", changed);
  await sendToken(pool, config, mailer, id, "PASSWORD_RESET", {
    user: { id },
    ip: "127.0.0.1",
  });
  const resetToken = new URL(mail.at(-1).url).hash.slice(7);
  await anonymous
    .post("/api/auth/reset-password")
    .set("x-csrf-token", next)
    .send({ token: resetToken, password: secret })
    .expect(200);
  await active.agent.get("/api/auth/me").expect(401);
});
test("expired reset links fail and disabled users cannot use existing links", async () => {
  const id = await seed("expired@example.com", "VIEWER");
  await sendToken(pool, config, mailer, id, "PASSWORD_RESET", null);
  const token = new URL(mail.at(-1).url).hash.slice(7);
  await pool.query(
    "UPDATE password_reset_tokens SET expires_at=now()-interval '1 hour' WHERE user_id=$1",
    [id],
  );
  await write(admin, "/api/auth/reset-password", {
    token,
    password: changed,
  }).expect(400);
  await sendToken(pool, config, mailer, id, "PASSWORD_RESET", null);
  const fresh = new URL(mail.at(-1).url).hash.slice(7);
  await write(admin, `/api/users/${id}/disable`).expect(200);
  await write(admin, "/api/auth/reset-password", {
    token: fresh,
    password: changed,
  }).expect(400);
});
test("role changes, disabling users, and logout all revoke existing sessions", async () => {
  const id = await seed("lifecycle@example.com", "ACCOUNTANT");
  const first = await login("lifecycle@example.com");
  await write(admin, `/api/users/${id}`, { role: "VIEWER" }, "patch").expect(
    200,
  );
  await first.agent.get("/api/auth/me").expect(401);
  const second = await login("lifecycle@example.com");
  await write(second, "/api/invoices", draft()).expect(403);
  await write(admin, `/api/users/${id}/disable`).expect(200);
  await second.agent.get("/api/auth/me").expect(401);
  await write(admin, `/api/users/${id}/enable`).expect(200);
  const third = await login("lifecycle@example.com"),
    fourth = await login("lifecycle@example.com");
  await write(third, "/api/auth/logout-all").expect(200);
  await fourth.agent.get("/api/auth/me").expect(401);
});
test("last active admin is protected and audit log contains no password hashes or raw tokens", async () => {
  const {
    rows: [u],
  } = await pool.query("SELECT id FROM users WHERE email='admin@example.com'");
  await write(admin, `/api/users/${u.id}/disable`).expect(409);
  const { rows } = await pool.query("SELECT * FROM audit_logs");
  const serialized = JSON.stringify(rows);
  for (const action of [
    "INTERNAL_VALIDATION_SUCCESS",
    "FBR_SUBMISSION_SUCCESS",
    "INVOICE_DELETED",
    "USER_EMAIL_CHANGED",
    "USER_ROLE_CHANGED",
  ])
    assert.ok(rows.some((r) => r.action === action));
  assert.ok(!serialized.includes(secret));
  assert.ok(!serialized.includes("$2b$"));
  for (const m of mail)
    assert.ok(!serialized.includes(new URL(m.url).hash.slice(7)));
});
test("database binding prevents accidental reuse across deployments", async () => {
  await assert.rejects(() => bindEnvironment(pool, { appEnv: "production" }));
});
test("React deep links and built assets are served without exposing private API data", async () => {
  for (const path of [
    "/login",
    "/forgot-password",
    "/setup-password",
    "/overview",
    "/create-invoice",
    "/invoices",
    "/invoices/example-id/edit",
    "/users",
    "/audit",
    "/account",
  ]) {
    const response = await request(app)
      .get(path)
      .expect(200)
      .expect("Content-Type", /html/);
    assert.match(response.text, /<div id="root"><\/div>/);
    assert.ok(!response.text.includes("password_hash"));
    assert.ok(!response.text.includes("Test customer"));
    assert.match(
      response.headers["content-security-policy"],
      /script-src 'self'/,
    );
  }
  const page = await request(app).get("/invoices");
  const asset = page.text.match(/src="([^\"]+\.js)"/)[1];
  await request(app)
    .get(asset)
    .expect(200)
    .expect("Content-Type", /javascript/);
  await request(app).get("/api/invoices").expect(401);
  await request(app).get("/register").expect(404);
  await request(app).get("/customers").expect(404);
  await request(app).get("/products").expect(404);
});

test('submission requires a reviewed positive integer version before any FBR call', async () => {
  const inv=await invoice();await write(creator,`/api/invoices/${inv.id}/validate`).expect(200);
  const before=requests;
  for(const body of [{},{version:null},{version:'1'},{version:0},{version:1.5}])
    await write(creator,`/api/invoices/${inv.id}/submit`,body).expect(400);
  assert.equal(requests,before);
  const stored=(await creator.agent.get(`/api/invoices/${inv.id}`)).body;
  assert.equal(stored.status,'FBR_VALIDATED');
});
test('old confirmation cannot submit another users edited and revalidated invoice', async () => {
  const inv=await invoice();await write(creator,`/api/invoices/${inv.id}/validate`).expect(200);
  const reviewedVersion=inv.version;
  const changed=await write(admin,`/api/invoices/${inv.id}`,{...draft(),version:reviewedVersion},'put').expect(200);
  await write(admin,`/api/invoices/${inv.id}/validate`).expect(200);
  const before=requests;
  const stale=await write(creator,`/api/invoices/${inv.id}/submit`,{version:reviewedVersion}).expect(409);
  assert.match(stale.body.error,/Reload and review/);assert.equal(requests,before);
  const stored=(await creator.agent.get(`/api/invoices/${inv.id}`)).body;
  assert.equal(stored.status,'FBR_VALIDATED');assert.equal(stored.version,changed.body.version);
  assert.equal(stored.fbr_invoice_number,null);
  await write(creator,`/api/invoices/${inv.id}/submit`,{version:stored.version}).expect(200);
});
test('submission version is checked under the lock after an edit during rate lookup', async () => {
  const inv=await invoice();await write(creator,`/api/invoices/${inv.id}/validate`).expect(200);
  const originalReference=client.reference;
  let release,entered;const gate=new Promise(resolve=>{release=resolve});const started=new Promise(resolve=>{entered=resolve});let first=true;
  config.mock=false;
  client.reference=async()=>{if(first){first=false;entered();await gate;}return {rates:[{description:'18%',supported:true}]};};
  let pending;
  try {
    pending=write(creator,`/api/invoices/${inv.id}/submit`,{version:inv.version}).then(r=>r);
    await started;
    await write(admin,`/api/invoices/${inv.id}`,{...draft(),version:inv.version},'put').expect(200);
    await write(admin,`/api/invoices/${inv.id}/validate`).expect(200);
    const before=requests;release();const stale=await pending;
    assert.equal(stale.status,409);assert.match(stale.body.error,/Reload and review/);assert.equal(requests,before);
    assert.equal((await creator.agent.get(`/api/invoices/${inv.id}`)).body.status,'FBR_VALIDATED');
  } finally {release();if(pending)await pending;config.mock=true;client.reference=originalReference;}
});
test('saved tax agrees with preview rounding for 42.70 at 5 percent', async () => {
  const body=draft();body.scenarioId='SN016';Object.assign(body.items[0],{quantity:1,unitPrice:'42.70',rate:'5%',saleType:'Processing/Conversion of Goods'});
  const saved=(await write(creator,'/api/invoices',body).expect(201)).body;
  assert.equal(Number(saved.sales_tax),2.14);assert.equal(Number(saved.grand_total),44.84);
  assert.equal(saved.items[0].snapshot.salesTaxApplicable,2.14);
});
