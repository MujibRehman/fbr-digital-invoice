import { useState } from "react";
import { useSearchParams } from "react-router";
import { api, post } from "../api.js";
import { useResource } from "../hooks.js";
import { useSession } from "../session.jsx";
import {
  Action,
  Badge,
  date,
  Field,
  Form,
  Heading,
  LoadState,
  Modal,
  Pagination,
  pretty,
  Select,
} from "../components/ui.jsx";
export function UsersPage() {
  const resource = useResource("/users"),
    { emailEnabled, notify, refresh } = useSession();
  const [editing, setEditing] = useState(null),
    [secret, setSecret] = useState(null);
  async function complete(result) {
    setEditing(null);
    if (result.temporaryPassword) setSecret(result.temporaryPassword);
    else notify(result.warning || result.message || "Employee access saved");
    resource.reload();
    await refresh();
  }
  return (
    <>
      <Heading
        title="Team access"
        subtitle="Only administrators can create accounts and change access."
      >
        <button className="primary" onClick={() => setEditing({})}>
          + Add employee
        </button>
      </Heading>
      <LoadState resource={resource}>
        {(rows) => (
          <section className="panel table-panel">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Role</th>
                    <th>Status</th>
                    <th>Last sign-in</th>
                    <th>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((u) => (
                    <tr key={u.id}>
                      <td>
                        <strong>{u.name}</strong>
                        <br />
                        <span className="muted">{u.email}</span>
                      </td>
                      <td>{pretty(u.role)}</td>
                      <td>
                        <Badge value={u.status} />
                      </td>
                      <td>{date(u.last_login_at)}</td>
                      <td>
                        <button
                          aria-label={`Manage ${u.name}`}
                          onClick={() => setEditing(u)}
                        >
                          Manage
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </LoadState>
      {editing && (
        <Modal
          title={editing.id ? "Manage employee" : "Add employee"}
          onClose={() => setEditing(null)}
        >
          <Form
            onSubmit={async (data) =>
              complete(
                await api(`/users${editing.id ? `/${editing.id}` : ""}`, {
                  method: editing.id ? "PATCH" : "POST",
                  body: data,
                }),
              )
            }
          >
            <Field
              label="Full name"
              name="name"
              defaultValue={editing.name || ""}
              required
              maxLength={150}
            />
            {editing.id ? (
              <p className="muted">{editing.email}</p>
            ) : (
              <Field label="Work email" name="email" type="email" required />
            )}
            <Select
              label="Role"
              name="role"
              options={["ACCOUNTANT", "VIEWER", "ADMIN"]}
              defaultValue={editing.role || "ACCOUNTANT"}
            />
            <Select
              label="Status"
              name="status"
              options={["ACTIVE", "DISABLED"]}
              defaultValue={editing.status || "ACTIVE"}
            />
            <p className="note">
              {emailEnabled
                ? "Active employees receive a one-time password setup link."
                : "A random temporary password will be shown once. Share it privately with the employee; they must replace it when signing in."}
            </p>
            <div className="actions">
              <button className="primary">
                {editing.id ? "Save access" : "Create employee"}
              </button>
              <button type="button" onClick={() => setEditing(null)}>
                Cancel
              </button>
            </div>
          </Form>
          {editing.id && editing.status === "ACTIVE" && (
            <div className="reset-action">
              <Action
                onClick={async () =>
                  complete(
                    await post(`/users/${editing.id}/send-password-reset`),
                  )
                }
              >
                {emailEnabled
                  ? "Send password reset"
                  : "Generate temporary password"}
              </Action>
            </div>
          )}
        </Modal>
      )}
      {secret && (
        <Modal title="Temporary password" onClose={() => setSecret(null)}>
          <p>
            Share this password privately with the employee. It is shown only
            here and must be replaced at first sign-in.
          </p>
          <p className="password-secret">{secret}</p>
          <button onClick={() => setSecret(null)}>Done</button>
        </Modal>
      )}
    </>
  );
}
export function AuditPage() {
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get("page")) || 1),
    resource = useResource(`/audit?page=${page}`);
  return (
    <>
      <Heading
        title="Audit trail"
        subtitle="A record of account changes and invoice activity."
      />
      <LoadState resource={resource}>
        {(rows) => (
          <>
            <section className="panel table-panel">
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Employee</th>
                      <th>Activity</th>
                      <th>Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id}>
                        <td>
                          {new Date(r.created_at).toLocaleString("en-GB", {
                            timeZone: "Asia/Karachi",
                          })}
                        </td>
                        <td>{r.user_name || "System / anonymous"}</td>
                        <td>{pretty(r.action)}</td>
                        <td>
                          <details>
                            <summary>View</summary>
                            <pre className="response">
                              {JSON.stringify(
                                {
                                  entity: r.entity_type,
                                  id: r.entity_id,
                                  ...r.metadata,
                                },
                                null,
                                2,
                              )}
                            </pre>
                          </details>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
            <Pagination
              page={page}
              hasMore={rows.length === 50}
              onPage={(next) => setParams({ page: String(next) })}
            />
          </>
        )}
      </LoadState>
    </>
  );
}
