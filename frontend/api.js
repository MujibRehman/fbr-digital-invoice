// Cookies stay HttpOnly; the CSRF token is held only in this module's memory.
let csrfToken = "";
export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}
export async function api(path, { method = "GET", body, signal } = {}) {
  const response = await fetch(`/api${path}`, {
    method,
    signal,
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(method !== "GET" ? { "x-csrf-token": csrfToken } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (
      response.status === 401 &&
      path !== "/auth/login" &&
      path !== "/auth/me"
    ) {
      window.dispatchEvent(new Event("fbr-digital-invoice:session-expired"));
    }
    throw new ApiError(
      data.error || "Unable to reach the workspace. Please try again.",
      response.status,
    );
  }
  if (data.csrfToken) csrfToken = data.csrfToken;
  return data;
}
export const post = (path, body = {}) => api(path, { method: "POST", body });
