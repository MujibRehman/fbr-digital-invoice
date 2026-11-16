import { Link } from "react-router";
import { Badge, date, Heading, LoadState, money } from "../components/ui.jsx";
import { useResource } from "../hooks.js";
import { useSession } from "../session.jsx";

const cards = [
  ["total_invoices", "Total invoices", "▤", "blue"],
  ["draft_invoices", "Draft invoices", "◷", "amber"],
  ["fbr_validated_invoices", "Validated with FBR", "✓", "violet"],
  ["fbr_accepted_invoices", "FBR submitted", "↥", "green"],
];

export function OverviewPage() {
  const { user } = useSession(),
    resource = useResource("/invoices/overview");
  return (
    <>
      <Heading
        title="Overview"
        subtitle="Your FBR compliance activity at a glance."
      >
        {user.role !== "VIEWER" && (
          <Link className="button primary" to="/create-invoice">
            + New invoice
          </Link>
        )}
      </Heading>
      <LoadState resource={resource}>
        {(data) => (
          <>
            <section className="overview-cards" aria-label="Invoice summary">
              {cards.map(([key, label, icon, tone]) => (
                <article className="overview-card" key={key}>
                  <div>
                    <p>{label}</p>
                    <strong>{data.summary[key]}</strong>
                  </div>
                  <span className={`overview-icon ${tone}`} aria-hidden="true">
                    {icon}
                  </span>
                </article>
              ))}
            </section>
            <section className="panel recent-panel">
              <div className="section-head">
                <div>
                  <h2>Recently worked invoices</h2>
                  <p className="muted">
                    The five invoices with the latest activity.
                  </p>
                </div>
                <Link to="/invoices">View all invoices</Link>
              </div>
              {data.recent.length ? (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Invoice number</th>
                        <th>Invoice date</th>
                        <th>Buyer</th>
                        <th>Status</th>
                        <th>Total · PKR</th>
                        <th>Last updated</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.recent.map((invoice) => (
                        <tr key={invoice.id}>
                          <td>
                            <Link
                              className="table-link"
                              to={`/invoices/${invoice.id}`}
                            >
                              {invoice.invoice_number}
                            </Link>
                          </td>
                          <td>{date(invoice.invoice_date)}</td>
                          <td>{invoice.customer_name}</td>
                          <td>
                            <Badge value={invoice.status} />
                          </td>
                          <td>{money(invoice.grand_total)}</td>
                          <td>
                            {new Date(invoice.updated_at).toLocaleString(
                              "en-GB",
                              { timeZone: "Asia/Karachi" },
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="empty">
                  <h2>No invoices yet</h2>
                  <p>Create the first invoice to see activity here.</p>
                  {user.role !== "VIEWER" && (
                    <Link className="button primary" to="/create-invoice">
                      Create invoice
                    </Link>
                  )}
                </div>
              )}
            </section>
          </>
        )}
      </LoadState>
    </>
  );
}
