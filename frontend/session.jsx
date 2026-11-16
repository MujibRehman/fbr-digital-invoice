import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { api, post } from "./api.js";
const SessionContext = createContext(null);
export function SessionProvider({ children }) {
  const [session, setSession] = useState({
    user: null,
    environment: null,
    mock: false,
    emailEnabled: false,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState({ text: "", type: "success" });
  const timer = useRef();
  const notify = useCallback((text, type = "success") => {
    setNotice({ text, type });
    clearTimeout(timer.current);
    timer.current = setTimeout(
      () => setNotice({ text: "", type: "success" }),
      7000,
    );
  }, []);
  const refresh = useCallback(async () => {
    await api("/auth/csrf").then((boot) =>
      setSession((s) => ({ ...s, ...boot })),
    );
    try {
      const data = await api("/auth/me");
      setSession((s) => ({ ...s, ...data }));
      return data.user;
    } catch (err) {
      if (err.status !== 401) throw err;
      setSession((s) => ({ ...s, user: null }));
      return null;
    }
  }, []);
  const initialize = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [refresh]);
  useEffect(() => {
    initialize();
    const expired = () => {
      setSession((s) => ({ ...s, user: null }));
      notify("Your session ended. Please sign in again.", "error");
      api("/auth/csrf").catch(() => {});
    };
    window.addEventListener("fbr-digital-invoice:session-expired", expired);
    return () => {
      clearTimeout(timer.current);
      window.removeEventListener("fbr-digital-invoice:session-expired", expired);
    };
  }, [initialize, notify]);
  async function logout(all = false) {
    await post(all ? "/auth/logout-all" : "/auth/logout");
    setSession((s) => ({ ...s, user: null }));
    await api("/auth/csrf");
  }
  return (
    <SessionContext.Provider value={{ ...session, refresh, logout, notify }}>
      {session.environment === "sandbox" && (
        <div className="environment sandbox">
          SANDBOX{session.mock ? " · MOCK FBR RESPONSES" : ""}
        </div>
      )}
      {loading ? (
        <p className="loading">Opening fbr-digital-invoice…</p>
      ) : error ? (
        <main className="auth-form">
          <h1>Workspace unavailable</h1>
          <p role="alert">{error}</p>
          <button onClick={initialize}>Try again</button>
        </main>
      ) : (
        children
      )}
      <div
        id="notice"
        className={`${notice.text ? "visible " : ""}${notice.type}`}
        role={notice.type === "error" ? "alert" : "status"}
        aria-live="polite"
      >
        {notice.text}
      </div>
    </SessionContext.Provider>
  );
}
export const useSession = () => useContext(SessionContext);
