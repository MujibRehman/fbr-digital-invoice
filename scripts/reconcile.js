import { parseArgs } from "node:util";
import { readConfig } from "../src/config/env.js";
import {
  createPool,
  transaction,
  bindEnvironment,
} from "../src/config/database.js";
import { uuid, fail } from "../src/middleware/validation.js";
import { audit } from "../src/audit/audit.service.js";
const { values } = parseArgs({
  options: {
    invoice: { type: "string" },
    actor: { type: "string" },
    outcome: { type: "string" },
    evidence: { type: "string" },
    "fbr-number": { type: "string" },
  },
});
const config = readConfig(),
  pool = createPool(config);
try {
  const id = uuid(values.invoice),
    outcome = values.outcome;
  if (
    !["accepted", "rejected", "validation-retry"].includes(outcome) ||
    !values.evidence ||
    values.evidence.length < 20
  )
    fail(
      400,
      "Provide an outcome and independently confirmed FBR reconciliation evidence (at least 20 characters).",
    );
  if (
    outcome === "accepted" &&
    (!values["fbr-number"] || values["fbr-number"].length > 255)
  )
    fail(400, "Provide the confirmed FBR invoice number");
  await bindEnvironment(pool, config);
  await transaction(pool, async (db) => {
    const {
      rows: [actor],
    } = await db.query(
      "SELECT id FROM users WHERE email=$1 AND role='ADMIN' AND status='ACTIVE'",
      [
        String(values.actor || "")
          .trim()
          .toLowerCase(),
      ],
    );
    if (!actor) fail(400, "An active administrator email is required");
    const {
      rows: [invoice],
    } = await db.query(
      "SELECT *,updated_at < now()-interval '2 minutes' AS stale FROM invoices WHERE id=$1 FOR UPDATE",
      [id],
    );
    if (!invoice?.stale)
      fail(409, "Invoice not found or a recent operation is still in progress");
    const allowed =
      outcome === "validation-retry"
        ? ["VALIDATING_FBR"]
        : ["SUBMITTING", "SUBMISSION_UNKNOWN"];
    if (!allowed.includes(invoice.status))
      fail(409, "This invoice cannot be reconciled with that outcome");
    const status =
      outcome === "accepted"
        ? "FBR_ACCEPTED"
        : outcome === "rejected"
          ? "FBR_SUBMISSION_FAILED"
          : "DRAFT";
    await db.query(
      "UPDATE invoices SET status=$1,fbr_invoice_number=$2,submitted_at=CASE WHEN $3 THEN now() ELSE submitted_at END,updated_by=$4,updated_at=now() WHERE id=$5",
      [
        status,
        values["fbr-number"] || null,
        outcome === "accepted",
        actor.id,
        id,
      ],
    );
    await audit(
      db,
      { user: actor, ip: "server-cli" },
      "FBR_MANUALLY_RECONCILED",
      "invoice",
      id,
      {
        previous_status: invoice.status,
        status,
        evidence: values.evidence,
        fbrInvoiceNumber: values["fbr-number"] || null,
      },
    );
  });
  console.log(
    "Reconciliation recorded. The original FBR attempts remain unchanged.",
  );
} catch (error) {
  console.error(
    error.status
      ? error.message
      : "Reconciliation failed. Check configuration and database state.",
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
