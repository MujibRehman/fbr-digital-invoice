-- Version 3 removes mandatory master-data dependencies and renames the creator role/statuses.
ALTER TABLE users DROP CONSTRAINT users_role_check;
UPDATE users SET role='ACCOUNTANT' WHERE role='INVOICE_CREATOR';
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK(role IN ('ADMIN','ACCOUNTANT','VIEWER'));

ALTER TABLE invoices ALTER COLUMN customer_id DROP NOT NULL;
ALTER TABLE invoice_items ALTER COLUMN product_id DROP NOT NULL;

ALTER TABLE invoices DROP CONSTRAINT invoices_status_check;
UPDATE invoices SET status='VALIDATING_FBR' WHERE status='VALIDATING';
UPDATE invoices i SET status=CASE
  WHEN EXISTS (
    SELECT 1 FROM fbr_submissions s
    WHERE s.invoice_id=i.id AND s.operation='SUBMIT'
  ) THEN 'FBR_SUBMISSION_FAILED'
  ELSE 'FBR_VALIDATION_FAILED'
END WHERE status='FBR_REJECTED';
ALTER TABLE invoices ADD CONSTRAINT invoices_status_check CHECK(status IN (
  'DRAFT','INTERNALLY_VALIDATED','VALIDATING_FBR','FBR_VALIDATION_FAILED',
  'FBR_VALIDATED','SUBMITTING','FBR_SUBMISSION_FAILED','SUBMISSION_UNKNOWN','FBR_ACCEPTED'
));
