-- Add a mandatory internal review gate before an invoice may be sent to FBR validation.
ALTER TABLE invoices DROP CONSTRAINT invoices_status_check;
ALTER TABLE invoices ADD CONSTRAINT invoices_status_check CHECK(status IN ('DRAFT','INTERNALLY_VALIDATED','VALIDATING','FBR_VALIDATED','SUBMITTING','FBR_ACCEPTED','FBR_REJECTED','SUBMISSION_UNKNOWN'));
