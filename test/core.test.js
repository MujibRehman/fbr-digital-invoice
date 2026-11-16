import { test } from "node:test";
import assert from "node:assert/strict";
import { readConfig } from "../src/config/env.js";
import { interpretResponse } from "../src/fbr/fbr.validator.js";
import { parseFbrResponse } from "../src/fbr/fbr.client.js";
import { page } from "../src/middleware/validation.js";
const env = {
  APP_ENV: "sandbox",
  FBR_MODE: "sandbox",
  FBR_MOCK: "true",
  APP_URL: "http://localhost:3000",
  SESSION_SECRET: "random-test-only-secret-with-at-least-32-characters",
  DATABASE_URL: "postgres://local:local@localhost/fbr_digital_invoice_sandbox",
  SELLER_NAME: "Test seller",
  SELLER_NTN: "1234567",
  SELLER_PROVINCE: "Punjab",
  SELLER_ADDRESS: "Test address",
};
test("configuration rejects mixed environments, production mocks, weak secrets and insecure remote URLs", () => {
  assert.equal(readConfig(env).appEnv, "sandbox");
  assert.equal(
    readConfig({ ...env, SELLER_NTN: "A123456" }).seller.ntn,
    "A123456",
  );
  for (const patch of [
    { FBR_MODE: "production" },
    { APP_ENV: "production", FBR_MODE: "production" },
    { DATABASE_URL: "postgres://x:x@localhost/fbr_digital_invoice_production" },
    { APP_URL: "http://public.example.com" },
    { SESSION_SECRET: "short" },
  ])
    assert.throws(() => readConfig({ ...env, ...patch }));
});
test("FBR success requires valid overall status, every item, and a number for submission", () => {
  const good = {
    validationResponse: {
      statusCode: "00",
      status: "Valid",
      invoiceStatuses: [{ statusCode: "00", status: "Valid" }],
    },
  };
  assert.equal(interpretResponse(good, "VALIDATE", 200).valid, true);
  assert.equal(interpretResponse(good, "SUBMIT", 200).valid, false);
  assert.equal(
    interpretResponse({ ...good, invoiceNumber: "FBR-123" }, "SUBMIT", 200)
      .valid,
    true,
  );
  assert.equal(
    interpretResponse({ ...good, invoiceNumber: "FBR-123" }, "SUBMIT", 500)
      .valid,
    false,
  );
  const partial = {
    validationResponse: {
      statusCode: "00",
      status: "Valid",
      invoiceStatuses: [
        { statusCode: "00", status: "Valid", invoiceNo: "accepted-line" },
        { statusCode: "01", status: "Invalid" },
      ],
    },
  };
  assert.equal(interpretResponse(partial, "SUBMIT", 200).valid, false);
  assert.equal(interpretResponse(partial, "SUBMIT", 200).rejected, false);
  assert.equal(
    interpretResponse(
      {
        validationResponse: {
          statusCode: "01",
          status: "Invalid",
          error: "Invalid HS code",
        },
      },
      "SUBMIT",
      200,
    ).rejected,
    true,
  );
});
test("FBR response parser recovers trailing commas without changing text inside JSON strings", () => {
  const raw =
    '{"validationResponse":{"statusCode":"01","status":"Invalid","invoiceStatuses":[{"itemSNo":"1","errorCode":"0300","error":"Invalid value,}"}],},"sourceInvoiceNo":"",}';
  const parsed = parseFbrResponse(raw);
  assert.equal(
    parsed.validationResponse.invoiceStatuses[0].error,
    "Invalid value,}",
  );
  const interpreted = interpretResponse(parsed, "VALIDATE", 200);
  assert.equal(interpreted.errorCode, "0300");
  assert.equal(interpreted.error, "Item 1 [0300]: Invalid value,}");
  assert.deepEqual(parseFbrResponse("<html>Gateway error</html>"), {
    error: "FBR returned an unreadable response.",
  });
});
test("invoice pagination returns fixed groups of 50", () => {
  assert.deepEqual(page({}), { limit: 50, offset: 0 });
  assert.deepEqual(page({ page: "2" }), { limit: 50, offset: 50 });
  assert.deepEqual(page({ page: "3" }), { limit: 50, offset: 100 });
});
