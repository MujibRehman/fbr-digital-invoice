CREATE TABLE app_identity(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), environment text NOT NULL CHECK(environment IN ('sandbox','production')));
CREATE TABLE users (
 id uuid PRIMARY KEY, name varchar(150) NOT NULL, email varchar(255) UNIQUE NOT NULL CHECK(email=lower(email)), password_hash text NOT NULL,
 role text NOT NULL CHECK(role IN ('ADMIN','INVOICE_CREATOR','VIEWER')), status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','DISABLED')),
 must_change_password boolean NOT NULL DEFAULT true, session_version integer NOT NULL DEFAULT 0,
 last_login_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sessions(sid varchar PRIMARY KEY, sess json NOT NULL, expire timestamp(6) NOT NULL);
CREATE INDEX sessions_expire_idx ON sessions(expire);
CREATE TABLE password_reset_tokens(id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), token_hash text UNIQUE NOT NULL, purpose text NOT NULL CHECK(purpose IN ('ACCOUNT_SETUP','PASSWORD_RESET')), expires_at timestamptz NOT NULL, used_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX tokens_user_idx ON password_reset_tokens(user_id);
CREATE TABLE customers(id uuid PRIMARY KEY, business_name varchar(255) NOT NULL, ntn_cnic varchar(30) NOT NULL DEFAULT '', strn varchar(50) NOT NULL DEFAULT '', registration_type text NOT NULL CHECK(registration_type IN ('Registered','Unregistered')), province varchar(100) NOT NULL, address text NOT NULL, payment_terms varchar(100) NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE products(id uuid PRIMARY KEY, sku varchar(100) NOT NULL DEFAULT '', name varchar(255) NOT NULL, hs_code varchar(20) NOT NULL, uom varchar(100) NOT NULL, default_tax_rate varchar(50) NOT NULL, default_sale_type varchar(255) NOT NULL, active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE SEQUENCE invoice_sequence;
CREATE TABLE invoices(
 id uuid PRIMARY KEY, invoice_number varchar(100) UNIQUE NOT NULL, invoice_date date NOT NULL, customer_id uuid NOT NULL REFERENCES customers(id),
 customer_snapshot jsonb NOT NULL, seller_snapshot jsonb NOT NULL, po_number varchar(100) NOT NULL DEFAULT '', delivery_challan_number varchar(100) NOT NULL DEFAULT '', payment_terms varchar(100) NOT NULL DEFAULT '',
 invoice_type text NOT NULL, invoice_ref_no varchar(255) NOT NULL DEFAULT '', scenario_id varchar(10) NOT NULL DEFAULT '',
 status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','VALIDATING','FBR_VALIDATED','SUBMITTING','FBR_ACCEPTED','FBR_REJECTED','SUBMISSION_UNKNOWN')),
 version integer NOT NULL DEFAULT 1, subtotal numeric(18,2) NOT NULL, sales_tax numeric(18,2) NOT NULL, grand_total numeric(18,2) NOT NULL,
 created_by uuid NOT NULL REFERENCES users(id), updated_by uuid NOT NULL REFERENCES users(id), fbr_invoice_number varchar(255) UNIQUE,
 fbr_status text, fbr_validation_status text, submitted_by uuid REFERENCES users(id), submitted_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE invoice_items(id uuid PRIMARY KEY, invoice_id uuid NOT NULL REFERENCES invoices(id), position integer NOT NULL, product_id uuid REFERENCES products(id), snapshot jsonb NOT NULL, UNIQUE(invoice_id, position));
CREATE TABLE fbr_submissions(id uuid PRIMARY KEY, invoice_id uuid NOT NULL REFERENCES invoices(id), environment text NOT NULL, operation text NOT NULL CHECK(operation IN ('VALIDATE','SUBMIT')), request_payload jsonb NOT NULL, response_payload jsonb, http_status integer, fbr_status_code text, fbr_error_code text, fbr_error_message text, requested_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz);
CREATE INDEX submissions_invoice_idx ON fbr_submissions(invoice_id, created_at DESC);
CREATE TABLE audit_logs(id uuid PRIMARY KEY, user_id uuid REFERENCES users(id), action varchar(100) NOT NULL, entity_type varchar(100), entity_id uuid, ip_address varchar(100), metadata jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX audit_time_idx ON audit_logs(created_at DESC);
CREATE INDEX invoices_time_idx ON invoices(created_at DESC);
-- Persistent account-based throttling complements per-IP Express limits across restarts/replicas.
CREATE TABLE login_attempts(email_hash text PRIMARY KEY, failures integer NOT NULL DEFAULT 0, window_start timestamptz NOT NULL DEFAULT now());
