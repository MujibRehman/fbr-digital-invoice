# fbr-digital-invoice

A web application for preparing, validating and submitting FBR digital invoices. It includes a React interface, an Express API, PostgreSQL storage, employee access controls and an audit trail.

## Features

- Enter seller, buyer and item details directly when creating an invoice.
- Calculate invoice totals with shared decimal arithmetic and display amounts in words, including paisa.
- Save drafts, run optional internal checks, validate with FBR and submit validated invoices.
- Print eligible invoices and show the FBR invoice number and QR code after acceptance.
- Manage employee access with administrator, accountant and viewer roles.
- Review invoice activity and administrative actions through an audit trail.
- Run separately configured Sandbox and Production environments.

## Requirements

- Node.js 22.12 or later and npm.
- A supported system for the bundled local PostgreSQL package, or access to an existing PostgreSQL service.

Run the commands below from the project root as a regular user.

## Quick start

Install the locked dependencies and start the local environment:

```sh
npm ci
npm run local
```

Open **http://localhost:3100**.

On first startup, the application creates a private `.env` file with random database and session credentials, initializes PostgreSQL under `.local/`, and applies the schema migrations. Local startup uses mocked FBR responses and does not submit invoices to FBR. Database records persist between runs.

Keep that process running. In a second terminal, create the first administrator:

```sh
npm run create-admin
```

Enter a name, email address and strong initial password at the prompts. Sign in and replace the initial password when asked. Additional users are created through **Team access**. There is no public registration or preconfigured administrator account.

Stop the local application with **Ctrl+C**. Start it again with `npm run local` to reuse the local database. The `.env` and `.local/` files contain private configuration and data and are excluded from Git.

## Use an existing PostgreSQL service

For a fresh configuration, copy the local configuration template:

```sh
cp .env.example .env
```

Create a database named `fbr_digital_invoice_sandbox` in your PostgreSQL service. Update `DATABASE_URL` in `.env` to use its host, port and database account. The account needs permission to create the application schema.

Set a random `SESSION_SECRET` of at least 32 characters. You can generate a value with:

```sh
node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
```

Keep `APP_ENV=sandbox`, `FBR_MODE=sandbox` and `FBR_MOCK=true` for local mock use. Replace the sample seller details with the values you want to use locally, then run:

```sh
npm run migrate
npm run create-admin
npm run build
npm start
```

The application opens at the origin configured in `APP_URL`. Its listener uses `HOST` and `PORT`.

## Configuration

The application reads `.env` in its working directory and accepts environment variables supplied to the process. Keep the committed example templates as placeholders and store actual configuration privately.

| Variable | Purpose |
| --- | --- |
| `APP_ENV`, `FBR_MODE` | Both must be `sandbox` or both must be `production`. |
| `FBR_MOCK` | `true` for local mock responses; `false` for live FBR requests. Production rejects mock mode. |
| `APP_URL` | The application origin, without a path, query or fragment. HTTPS is required outside the local sandbox. |
| `HOST`, `PORT` | The address and port used by the application listener. |
| `TRUST_PROXY` | `1` when running behind one trusted reverse proxy; `0` for direct local access. |
| `DATABASE_URL` | PostgreSQL connection URL. The database name must be `fbr_digital_invoice_sandbox` or `fbr_digital_invoice_production`, matching the environment. |
| `SESSION_SECRET` | A unique random secret of at least 32 characters. |
| `SELLER_NAME`, `SELLER_NTN`, `SELLER_PROVINCE`, `SELLER_ADDRESS` | Seller identity used as the default for new invoices. Live invoices require your registered business details. |
| `SELLER_STRN` | Optional seller sales tax registration number. |
| `FBR_GET_TOKEN`, `FBR_POST_TOKEN` | Issued credentials for live reference lookups and invoice operations. Keep them on the server. |

Optional email delivery uses `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD` and `MAIL_FROM`. Setting `SMTP_HOST` enables email transport. Without email transport, an administrator receives a temporary password once when creating a user and can deliver it privately.

### Separate Sandbox and Production environments

Use `.env.sandbox.example` and `.env.production.example` as starting points for private `.env.sandbox` and `.env.production` files. Replace the example hostnames, URLs, seller details and credential placeholders with settings for your own environment.

Use separate databases, application origins, session secrets and FBR credentials. Set `FBR_MOCK=false` for live FBR requests. Configure HTTPS and the correct proxy setting for each application process.

With both private files completed, check their consistency:

```sh
npm run check:deploy
```

This command checks configuration and separation of credentials; it does not verify live FBR acceptance. Application startup reads `.env` or process environment variables. It does not automatically select either named environment file, so supply the appropriate configuration to each process before running migrations, creating its administrator and starting the application.

## Invoice workflow

1. An administrator creates users through **Team access**. When email is configured, a new user receives a single-use setup link; otherwise, the administrator receives a temporary password.
2. Create an invoice and enter its internal invoice number, buyer, seller and item details. In Sandbox, select a supported scenario to set its sale type.
3. Save the invoice as a Draft. Internal validation is optional; FBR validation can start directly from Draft.
4. After successful FBR validation, print the invoice or submit it. Editing a pre-submission invoice returns it to Draft and clears previous validation.
5. An FBR-accepted invoice becomes immutable and displays its FBR invoice number and QR code. Failed or uncertain submission outcomes remain recorded for review.

**Overview** shows invoice totals and the five most recently worked invoices. **My account** supports password and email changes. Administrators can manage the team and inspect the audit trail.

| Role | Invoice access | Team and audit access |
| --- | --- | --- |
| `ADMIN` | Create, edit eligible invoices, delete drafts, validate, submit, view and print eligible invoices. | Manage users and view the audit trail. |
| `ACCOUNTANT` | Create, edit eligible invoices, delete drafts, validate, submit, view and print eligible invoices. | None. |
| `VIEWER` | View and print eligible invoices. | None. |

## Development

With the bundled local database running through `npm run local`, use a second terminal to rebuild frontend changes:

```sh
npm run build:watch
```

Refresh the browser after a rebuild. Restart the local application after backend changes.

With a separately managed PostgreSQL service and a completed `.env`, use:

```sh
npm run dev
```

This watches backend code and rebuilds frontend assets. The browser and API share the same application origin. A production frontend build is written to `dist/client/`, which is generated locally and excluded from Git.

## Testing

Run the complete suite:

```sh
npm run test:all
```

The suite runs JavaScript syntax checks, builds the frontend, tests the backend against an isolated temporary PostgreSQL database, and runs frontend workflow tests. FBR transport is mocked; the tests do not submit real invoices or reuse the local application database. The test process needs permission to start local database processes and listeners.

| Command | Purpose |
| --- | --- |
| `npm run check` | Check JavaScript syntax. |
| `npm test` | Build frontend assets and run backend tests. |
| `npm run test:frontend` | Run frontend workflow tests. |
| `npm run build` | Build frontend assets. |
| `npm run migrate` | Apply schema migrations to the configured database. |
| `npm run create-admin` | Create the first administrator interactively. |
| `npm run check:deploy` | Check the two private environment configurations. |
| `npm run reconcile` | Record an independently confirmed FBR outcome for an eligible uncertain submission. |

The reconciliation command requires `--invoice`, `--actor`, `--outcome` and `--evidence` arguments; an accepted outcome also requires `--fbr-number`. Confirm the outcome independently with FBR before using it, and keep the evidence private. Reconciliation writes an audit record and preserves the original submission attempts.

## Project structure

```text
frontend/          React pages, components, styles and UI tests
src/               API, authentication, invoicing, FBR integration and audit services
shared/            Shared invoice calculations
migrations/        Versioned PostgreSQL schema migrations
scripts/           Local startup, migrations, administrator setup and maintenance
test/             Backend and monetary calculation tests
package.json       Application commands and dependency declarations
package-lock.json  Locked dependency versions
vite.config.js     Frontend build and test configuration
```

## Security and public source

The application uses server-managed sessions, CSRF protection, password hashing, role checks and session revocation. Credentials stay on the server. Invoice submission uses durable locks, and accepted invoices cannot be edited or submitted again. Only administrators can view full FBR request and response records through the audit trail.

Commit application code, schema migrations, tests, package files and placeholder configuration templates. Keep actual environment files, business and customer records, banking details, staff identities, server inventory, API tokens, passwords, private keys, database exports and logs outside the public source tree.

Live FBR acceptance depends on issued credentials, authorized registration details, assigned scenarios and the applicable tax treatment. Mock responses and synthetic test values do not establish that a live invoice will be accepted.
