import { useEffect, useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router";
import { post } from "../api.js";
import { useSession } from "../session.jsx";
import { Action, Field, Form, Heading } from "../components/ui.jsx";
export function AuthPage({ mode }) {
  const session = useSession(),
    navigate = useNavigate(),
    location = useLocation();
  const [token, setToken] = useState(() =>
    mode === "reset"
      ? new URLSearchParams(location.hash.slice(1)).get("token")
      : null,
  );
  useEffect(() => {
    if (mode === "reset" && location.hash)
      navigate("/setup-password", { replace: true });
  }, [mode, location.hash, navigate]);
  const reset = mode === "reset",
    forgot = mode === "forgot";
  const from = location.state?.from;
  const destination =
    typeof from === "string" && from.startsWith("/") && !from.startsWith("//")
      ? from
      : "/overview";
  if (mode === "login" && session.user)
    return (
      <Navigate
        to={session.user.must_change_password ? "/account" : destination}
        replace
      />
    );
  async function submit(data) {
    if (reset) {
      if (!token) throw new Error("Open a valid password setup or reset link.");
      if (data.password !== data.confirm)
        throw new Error("Passwords do not match");
      const result = await post("/auth/reset-password", {
        token,
        password: data.password,
      });
      setToken(null);
      await session.refresh();
      session.notify(result.message);
      navigate("/login", { replace: true });
    } else if (forgot) {
      const result = await post("/auth/forgot-password", { email: data.email });
      session.notify(result.message);
      navigate("/login", { replace: true });
    } else {
      await post("/auth/login", { email: data.email, password: data.password });
      const user = await session.refresh();
      navigate(user?.must_change_password ? "/account" : destination, {
        replace: true,
      });
    }
  }
  return (
    <main className="auth">
      <section className="auth-brand">
        <div className="wordmark">
          fbr-digital-invoice
        </div>
        <div className="eyebrow">Finance & operations</div>
        <h1>
          Every invoice.
          <br />A clear record.
        </h1>
        <p>
          Your company’s private workspace for customer invoices, FBR submission
          and a complete transaction history.
        </p>
      </section>
      <section className="auth-form">
        <h2>
          {reset
            ? "Set your password"
            : forgot
              ? "Recover your account"
              : "Welcome back"}
        </h2>
        <p>
          {reset
            ? "Choose a strong password for your employee account."
            : forgot
              ? "Enter your work email to request a password reset."
              : "Sign in to your invoicing workspace."}
        </p>
        {reset && !token ? (
          <p className="note warning">
            This page needs a valid setup or reset link. Open the full link from
            your email, or request a new one.
          </p>
        ) : (
          <Form key={mode} onSubmit={submit}>
            {reset ? (
              <>
                <Field
                  label="New password"
                  name="password"
                  type="password"
                  required
                  minLength={12}
                  maxLength={72}
                  autoComplete="new-password"
                />
                <Field
                  label="Confirm password"
                  name="confirm"
                  type="password"
                  required
                  autoComplete="new-password"
                />
              </>
            ) : (
              <>
                <Field
                  label="Work email"
                  name="email"
                  type="email"
                  required
                  autoComplete="username"
                />
                {!forgot && (
                  <Field
                    label="Password"
                    name="password"
                    type="password"
                    required
                    autoComplete="current-password"
                  />
                )}
              </>
            )}
            <button className="primary">
              {reset
                ? "Save password"
                : forgot
                  ? "Request reset link"
                  : "Sign in"}
            </button>
          </Form>
        )}
        <Link
          className="text-button"
          to={forgot || reset ? "/login" : "/forgot-password"}
        >
          {forgot || reset ? "Back to sign in" : "Forgot password?"}
        </Link>
        <p className="footnote">
          {reset
            ? "Use at least 12 characters, with uppercase, lowercase, a number and a symbol."
            : "Access is provided by your fbr-digital-invoice administrator."}
        </p>
      </section>
    </main>
  );
}
export function AccountPage() {
  const { user, refresh, notify, logout } = useSession(),
    navigate = useNavigate();
  const mandatory = user.must_change_password;
  async function change(data) {
    if (data.password !== data.confirm)
      throw new Error("Passwords do not match");
    const result = await post("/auth/change-password", {
      currentPassword: data.currentPassword,
      password: data.password,
    });
    await refresh();
    notify(result.message);
    navigate("/login", { replace: true });
  }
  async function changeEmail(data) {
    const result = await post("/auth/change-email", {
      newEmail: data.newEmail,
      currentPassword: data.currentPassword,
    });
    await refresh();
    notify(result.message);
    navigate("/login", { replace: true });
  }
  return (
    <>
      <Heading
        title={mandatory ? "Set your own password" : "My account"}
        subtitle={
          mandatory
            ? "Replace your temporary password to unlock the workspace."
            : "Manage your profile and account security."
        }
      />
      {!mandatory && (
        <section className="panel account-profile">
          <h2>Profile</h2>
          <dl>
            <div>
              <dt>Name</dt>
              <dd>{user.name}</dd>
            </div>
            <div>
              <dt>Current email</dt>
              <dd>{user.email}</dd>
            </div>
          </dl>
          <h3>Change email address</h3>
          <p className="muted">
            For security, changing your email signs out every active session.
          </p>
          <Form onSubmit={changeEmail}>
            <div className="grid">
              <Field
                label="New email address"
                name="newEmail"
                type="email"
                autoComplete="email"
                required
              />
              <Field
                label="Current password"
                name="currentPassword"
                type="password"
                autoComplete="current-password"
                required
              />
            </div>
            <button className="primary">Change email</button>
          </Form>
        </section>
      )}
      <section className="panel">
        <h2>Change password</h2>
        <p className="muted">
          Use at least 12 characters, with uppercase, lowercase, a number and a
          symbol. Changing your password signs out every session.
        </p>
        <Form onSubmit={change}>
          <div className="grid">
            <Field
              label="Current password"
              name="currentPassword"
              type="password"
              autoComplete="current-password"
              required
            />
            <Field
              label="New password"
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={12}
              maxLength={72}
              required
            />
            <Field
              label="Confirm new password"
              name="confirm"
              type="password"
              autoComplete="new-password"
              required
            />
          </div>
          <button className="primary">Change password</button>
        </Form>
      </section>
      {!mandatory && (
        <section className="panel">
          <h2>Session access</h2>
          <p>Sign out of this browser and every other device.</p>
          <Action
            onClick={async () => {
              await logout(true);
              navigate("/login", { replace: true });
            }}
          >
            Sign out everywhere
          </Action>
        </section>
      )}
    </>
  );
}
