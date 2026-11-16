import { transaction } from "../config/database.js";
import { audit } from "../audit/audit.service.js";
import { fromInvoice } from "../fbr/fbr.mapper.js";
import { validatePayload } from "../fbr/fbr.validator.js";
import { fail } from "../middleware/validation.js";
import { getInvoice } from "./invoices.service.js";

export async function internallyValidateInvoice(pool, config, req, id) {
  try {
    return await transaction(pool, async (db) => {
      const {
        rows: [row],
      } = await db.query("SELECT status FROM invoices WHERE id=$1 FOR UPDATE", [
        id,
      ]);
      if (!row) fail(404, "Invoice not found");
      if (row.status !== "DRAFT")
        fail(409, "Only a saved draft can be internally validated");

      const invoice = await getInvoice(db, id);
      validatePayload(fromInvoice(invoice, config), config);
      await db.query(
        "UPDATE invoices SET status='INTERNALLY_VALIDATED',updated_at=now() WHERE id=$1",
        [id],
      );
      await audit(db, req, "INTERNAL_VALIDATION_SUCCESS", "invoice", id);
      return { status: "INTERNALLY_VALIDATED" };
    });
  } catch (error) {
    if (error.status === 400)
      await audit(pool, req, "INTERNAL_VALIDATION_FAILED", "invoice", id, {
        error: error.message,
      });
    throw error;
  }
}
