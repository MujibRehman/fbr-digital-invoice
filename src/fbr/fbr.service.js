import { z } from "zod";
import { parse } from "../middleware/validation.js";
import { checkInvoiceRates } from "./fbr.rates.js";
import { randomUUID } from "node:crypto";
import { transaction } from "../config/database.js";
import { getInvoice } from "../invoices/invoices.service.js";
import { fromInvoice } from "./fbr.mapper.js";
import { validatePayload, interpretResponse } from "./fbr.validator.js";
import { audit } from "../audit/audit.service.js";
import { fail } from "../middleware/validation.js";
export async function operate(pool, config, client, req, id, operation) {
  const submissionId = randomUUID(),
    submit = operation === "SUBMIT";
  // A submission must match the invoice shown when the user opened confirmation.
  const expectedVersion = submit
    ? parse(z.object({ version: z.number().int().positive() }), req.body)
        .version
    : null;
  const staleMessage =
    "Invoice changed. Reload and review it before submitting.";
  const preview = await getInvoice(pool, id);
  if (submit && preview.version !== expectedVersion) fail(409, staleMessage);
  await checkInvoiceRates(preview, config, client);
  const payload = await transaction(pool, async (db) => {
    const {
      rows: [row],
    } = await db.query(
      "SELECT status,version FROM invoices WHERE id=$1 FOR UPDATE",
      [id],
    );
    if (!row) fail(404, "Invoice not found");
    // Check again under the lock: an edit may have completed during rate lookup.
    if (submit && row.version !== expectedVersion) fail(409, staleMessage);
    if (row.version !== preview.version)
      fail(
        409,
        "Invoice changed while checking FBR rates. Reload and try again.",
      );
    const allowed = submit
      ? ["FBR_VALIDATED", "FBR_SUBMISSION_FAILED"]
      : ["DRAFT", "INTERNALLY_VALIDATED", "FBR_VALIDATION_FAILED"];
    if (!allowed.includes(row.status))
      fail(
        409,
        submit
          ? "Invoice must be validated by FBR and have no pending or previous successful submission"
          : "This invoice cannot be validated with FBR in its current state",
      );
    const invoice = await getInvoice(db, id),
      mapped = fromInvoice(invoice, config);
    validatePayload(mapped, config);
    await db.query(
      "UPDATE invoices SET status=$1,updated_at=now() WHERE id=$2",
      [submit ? "SUBMITTING" : "VALIDATING_FBR", id],
    );
    await db.query(
      "INSERT INTO fbr_submissions(id,invoice_id,environment,operation,request_payload,requested_by) VALUES($1,$2,$3,$4,$5,$6)",
      [
        submissionId,
        id,
        config.appEnv,
        operation,
        JSON.stringify(mapped),
        req.user.id,
      ],
    );
    await audit(
      db,
      req,
      submit ? "FBR_SUBMISSION_REQUESTED" : "FBR_VALIDATION_REQUESTED",
      "invoice",
      id,
      { submissionId, operation, request_payload: mapped },
    );
    return mapped;
  });
  // No transaction is held across a network request. A crash leaves the durable lock in place.
  let result;
  try {
    result = await client.request(operation, payload);
  } catch {
    result = {
      httpStatus: null,
      response: { error: "FBR request interrupted; outcome unknown" },
    };
  }
  const interpreted = interpretResponse(
    result.response,
    operation,
    result.httpStatus,
  );
  const status = interpreted.valid
    ? submit
      ? "FBR_ACCEPTED"
      : "FBR_VALIDATED"
    : submit
      ? interpreted.rejected
        ? "FBR_SUBMISSION_FAILED"
        : "SUBMISSION_UNKNOWN"
      : "FBR_VALIDATION_FAILED";
  const errorMessage =
    interpreted.error ||
    result.response?.error ||
    (interpreted.errorCode ? `FBR error ${interpreted.errorCode}` : null) ||
    (!interpreted.valid && interpreted.statusCode
      ? `FBR status code ${interpreted.statusCode}`
      : null) ||
    (!interpreted.valid && result.httpStatus
      ? `FBR returned HTTP ${result.httpStatus}`
      : null);
  await transaction(pool, async (db) => {
    await db.query(
      "UPDATE fbr_submissions SET response_payload=$1,http_status=$2,fbr_status_code=$3,fbr_error_code=$4,fbr_error_message=$5,completed_at=now() WHERE id=$6",
      [
        JSON.stringify(result.response),
        result.httpStatus,
        interpreted.statusCode,
        interpreted.errorCode,
        interpreted.error || result.response?.error || null,
        submissionId,
      ],
    );
    if (submit)
      await db.query(
        "UPDATE invoices SET status=$1,fbr_status=$2,fbr_invoice_number=$3,submitted_by=$4,submitted_at=CASE WHEN $5 THEN now() ELSE submitted_at END,updated_at=now() WHERE id=$6",
        [
          status,
          interpreted.statusCode,
          interpreted.invoiceNumber,
          req.user.id,
          interpreted.valid,
          id,
        ],
      );
    else
      await db.query(
        "UPDATE invoices SET status=$1,fbr_validation_status=$2,updated_at=now() WHERE id=$3",
        [status, interpreted.valid ? "VALID" : "INVALID", id],
      );
    await audit(
      db,
      req,
      submit
        ? interpreted.valid
          ? "FBR_SUBMISSION_SUCCESS"
          : status === "SUBMISSION_UNKNOWN"
            ? "FBR_SUBMISSION_UNKNOWN"
            : "FBR_SUBMISSION_FAILED"
        : interpreted.valid
          ? "FBR_VALIDATION_SUCCESS"
          : "FBR_VALIDATION_FAILED",
      "invoice",
      id,
      {
        submissionId,
        operation,
        status,
        http_status: result.httpStatus,
        fbr_status_code: interpreted.statusCode,
        fbr_error_code: interpreted.errorCode,
        request_payload: payload,
        response_payload: result.response,
      },
    );
  });
  return { status, submissionId, ...(errorMessage ? { errorMessage } : {}) };
}
