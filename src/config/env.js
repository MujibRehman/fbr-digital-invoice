import "dotenv/config";
export function readConfig(env = process.env) {
  const required = (key) => {
    if (!env[key]) throw new Error(`${key} is required`);
    return env[key];
  };
  const appEnv = required("APP_ENV");
  if (!["sandbox", "production"].includes(appEnv) || env.FBR_MODE !== appEnv)
    throw new Error("APP_ENV and FBR_MODE must match sandbox or production");
  const mock = env.FBR_MOCK === "true";
  if (!["true", "false"].includes(required("FBR_MOCK")))
    throw new Error("FBR_MOCK must be true or false");
  if (appEnv === "production" && mock)
    throw new Error("Mock FBR is forbidden in production");
  const url = new URL(required("APP_URL"));
  if (
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  )
    throw new Error("APP_URL must be an origin");
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    url.protocol !== "https:" &&
    !(appEnv === "sandbox" && local && url.protocol === "http:")
  )
    throw new Error("HTTPS is required outside local sandbox");
  const sessionSecret = required("SESSION_SECRET");
  if (
    sessionSecret.length < 32 ||
    /change.?me|replace|example/i.test(sessionSecret)
  )
    throw new Error(
      "SESSION_SECRET must be a unique random secret of at least 32 characters",
    );
  const databaseUrl = required("DATABASE_URL");
  if (!new URL(databaseUrl).pathname.endsWith(`fbr_digital_invoice_${appEnv}`))
    throw new Error(`Database must be named fbr_digital_invoice_${appEnv}`);
  if (!mock) {
    for (const key of ["FBR_GET_TOKEN", "FBR_POST_TOKEN"]) {
      if (/replace|example|your.token/i.test(required(key)))
        throw new Error(`${key} must contain the issued credential`);
    }
  }
  const seller = {
    name: required("SELLER_NAME"),
    ntn: required("SELLER_NTN"),
    strn: env.SELLER_STRN || "",
    province: required("SELLER_PROVINCE"),
    address: required("SELLER_ADDRESS"),
  };
  if (!/^([A-Za-z0-9]{7}|\d{13})$/.test(seller.ntn))
    throw new Error(
      "SELLER_NTN must contain a 7-character NTN or 13-digit CNIC",
    );
  return {
    appEnv,
    mock,
    appUrl: url.origin,
    secure: url.protocol === "https:",
    sessionSecret,
    databaseUrl,
    port: Number(env.PORT || 3000),
    host: env.HOST || "127.0.0.1",
    trustProxy: env.TRUST_PROXY === "1" ? 1 : false,
    getToken: env.FBR_GET_TOKEN,
    postToken: env.FBR_POST_TOKEN,
    seller,
    smtp: env.SMTP_HOST
      ? {
          host: env.SMTP_HOST,
          port: Number(env.SMTP_PORT || 587),
          secure: env.SMTP_SECURE === "true",
          requireTLS: env.SMTP_SECURE !== "true",
          ...(env.SMTP_USER
            ? { auth: { user: env.SMTP_USER, pass: required("SMTP_PASSWORD") } }
            : {}),
        }
      : null,
    mailFrom: env.MAIL_FROM || "fbr-digital-invoice <invoices@example.invalid>",
    cookieName: `${url.protocol === "https:" ? "__Host-" : ""}fbr-digital-invoice.${appEnv}`,
  };
}
