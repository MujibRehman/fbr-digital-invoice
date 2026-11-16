import { useEffect } from "react";
import {
  Link,
  Navigate,
  NavLink,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router";
import { useSession } from "./session.jsx";
import { Action, pretty } from "./components/ui.jsx";
import { AuthPage, AccountPage } from "./pages/Auth.jsx";
import {
  InvoicesPage,
  InvoiceDetailPage,
  InvoiceEditorPage,
} from "./pages/Invoices.jsx";
import { OverviewPage } from "./pages/Overview.jsx";
import { UsersPage, AuditPage } from "./pages/Team.jsx";
export function Protected({ roles, children }) {
  const { user } = useSession(),
    location = useLocation();
  if (!user)
    return (
      <Navigate
        to="/login"
        state={{ from: location.pathname + location.search }}
        replace
      />
    );
  if (user.must_change_password && location.pathname !== "/account")
    return <Navigate to="/account" replace />;
  if (roles && !roles.includes(user.role))
    return (
      <section className="panel">
        <h1>Access restricted</h1>
        <p>Your role does not have access to this page.</p>
        <Link to="/overview">Back to overview</Link>
      </section>
    );
  return children || <Outlet />;
}
function Shell() {
  const { user, logout } = useSession(),
    navigate = useNavigate(),
    location = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);
  const links = user.must_change_password
    ? [["account", "My account"]]
    : [
        ["overview", "Overview"],
        ...(user.role !== "VIEWER"
          ? [["create-invoice", "Create invoice"]]
          : []),
        ["invoices", "Invoices"],
        ...(user.role === "ADMIN"
          ? [
              ["users", "Team access"],
              ["audit", "Audit trail"],
            ]
          : []),
        ["account", "My account"],
      ];
  return (
    <div className="shell">
      <aside className="no-print">
        <div className="wordmark">
          fbr-digital-invoice
        </div>
        <nav className="nav" aria-label="Main navigation">
          {links.map(([path, label]) => (
            <NavLink
              key={path}
              to={`/${path}`}
              className={({ isActive }) => (isActive ? "active" : "")}
            >
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="account">
          <strong>{user.name}</strong>
          <span>{pretty(user.role)}</span>
          <br />
          <Action
            className="text-button"
            onClick={async () => {
              await logout();
              navigate("/login", { replace: true });
            }}
          >
            Sign out ↗
          </Action>
        </div>
      </aside>
      <main className="workspace">
        <Outlet />
      </main>
    </div>
  );
}
const writerRoles = ["ADMIN", "ACCOUNTANT"];
export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<AuthPage key="login" mode="login" />} />
      <Route
        path="/forgot-password"
        element={<AuthPage key="forgot" mode="forgot" />}
      />
      <Route
        path="/setup-password"
        element={<AuthPage key="reset" mode="reset" />}
      />
      <Route element={<Protected />}>
        <Route element={<Shell />}>
          <Route index element={<Navigate to="/overview" replace />} />
          <Route path="overview" element={<OverviewPage />} />
          <Route
            path="create-invoice"
            element={
              <Protected roles={writerRoles}>
                <InvoiceEditorPage />
              </Protected>
            }
          />
          <Route path="invoices" element={<InvoicesPage />} />
          <Route
            path="invoices/new"
            element={<Navigate to="/create-invoice" replace />}
          />
          <Route path="invoices/:id" element={<InvoiceDetailPage />} />
          <Route
            path="invoices/:id/edit"
            element={
              <Protected roles={writerRoles}>
                <InvoiceEditorPage />
              </Protected>
            }
          />
          <Route
            path="users"
            element={
              <Protected roles={["ADMIN"]}>
                <UsersPage />
              </Protected>
            }
          />
          <Route
            path="audit"
            element={
              <Protected roles={["ADMIN"]}>
                <AuditPage />
              </Protected>
            }
          />
          <Route path="account" element={<AccountPage />} />
        </Route>
      </Route>
      <Route
        path="*"
        element={
          <main className="auth-form">
            <h1>Page not found</h1>
            <Link to="/">Back to workspace</Link>
          </main>
        }
      />
    </Routes>
  );
}
