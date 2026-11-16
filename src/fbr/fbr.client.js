import { fail } from "../middleware/validation.js";
import { referenceDate, rateRows } from "./fbr.rates.js";
import { randomUUID } from "node:crypto";
const BASE = "https://gw.fbr.gov.pk/di_data/v1/di/";

function removeTrailingJsonCommas(raw) {
  let repaired = "",
    inString = false,
    escaped = false;
  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index];
    if (inString) {
      repaired += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      repaired += character;
      continue;
    }
    if (character === ",") {
      let next = index + 1;
      while (/\s/.test(raw[next] ?? "")) next += 1;
      if (raw[next] === "}" || raw[next] === "]") continue;
    }
    repaired += character;
  }
  return repaired;
}

export function parseFbrResponse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    try {
      return JSON.parse(removeTrailingJsonCommas(raw));
    } catch {
      return { error: "FBR returned an unreadable response." };
    }
  }
}

export function fbrClient(config) {
  const redact = (value) => {
    let text = JSON.stringify(value);
    for (const secret of [config.getToken, config.postToken])
      if (secret) text = text.split(secret).join("[REDACTED]");
    return JSON.parse(text);
  };
  const cache = new Map();
  let client;
  return (client = {
    async request(operation, payload) {
      if (config.mock)
        return {
          httpStatus: 200,
          response: {
            mock: true,
            ...(operation === "SUBMIT"
              ? { invoiceNumber: `MOCK-${randomUUID()}` }
              : {}),
            validationResponse: {
              statusCode: "00",
              status: "Valid",
              error: "",
              invoiceStatuses: [],
            },
          },
        };
      const suffix = config.appEnv === "sandbox" ? "_sb" : "";
      const endpoint = `${BASE}${operation === "SUBMIT" ? "postinvoicedata" : "validateinvoicedata"}${suffix}`;
      try {
        const result = await fetch(endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.postToken}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(30000),
          redirect: "error",
        });
        const raw = await result.text();
        const response = parseFbrResponse(raw);
        return { httpStatus: result.status, response: redact(response) };
      } catch {
        return {
          httpStatus: null,
          response: {
            error: "FBR connection interrupted. The outcome may be unknown.",
          },
        };
      }
    },
    async reference(kind, context = {}) {
      if (kind === "rates") {
        const { invoiceDate, sellerProvince, saleType } = context;
        const date = referenceDate(String(invoiceDate || ""));
        if (!sellerProvince || !saleType)
          fail(
            400,
            "Select the seller province and sale type before checking rates",
          );
        const key = JSON.stringify([
          invoiceDate,
          sellerProvince.toUpperCase().trim(),
          saleType.toUpperCase().trim(),
        ]);
        const cached = cache.get(key);
        if (cached && cached.expires > Date.now()) return cached.data;
        const [provinces, types] = await Promise.all([
          client.reference("provinces"),
          client.reference("saleTypes"),
        ]);
        const rows = (data) =>
          Array.isArray(data)
            ? data
            : Array.isArray(data?.data)
              ? data.data
              : [];
        const province = rows(provinces).find(
          (p) =>
            p.stateProvinceDesc?.trim().toUpperCase() ===
            sellerProvince.trim().toUpperCase(),
        );
        const type = rows(types).find(
          (t) =>
            t.transactioN_DESC?.trim().toUpperCase() ===
            saleType.trim().toUpperCase(),
        );
        if (!province || !type)
          fail(
            400,
            "FBR could not match the seller province or sale type. Select a reference value.",
          );
        const query = new URLSearchParams({
          date,
          transTypeId: type.transactioN_TYPE_ID,
          originationSupplier: province.stateProvinceCode,
        });
        const response = await fetch(
          `https://gw.fbr.gov.pk/pdi/v2/SaleTypeToRate?${query}`,
          {
            headers: {
              Authorization: `Bearer ${config.getToken}`,
              Accept: "application/json",
            },
            signal: AbortSignal.timeout(15000),
            redirect: "error",
          },
        );
        if (!response.ok)
          fail(502, "FBR rate reference is unavailable. Try again shortly.");
        const data = {
          invoiceDate,
          sellerProvince,
          saleType,
          rates: rateRows(redact(await response.json())),
        };
        if (cache.size >= 200) cache.clear();
        cache.set(key, { data, expires: Date.now() + 300000 });
        return data;
      }

      const paths = {
        provinces: "provinces",
        uom: "uom",
        saleTypes: "transtypecode",
      };
      if (!paths[kind]) throw new Error("Unsupported reference");
      if (config.mock)
        return {
          mock: true,
          data:
            kind === "provinces"
              ? [
                  { stateProvinceDesc: "Punjab" },
                  { stateProvinceDesc: "Sindh" },
                  { stateProvinceDesc: "Khyber Pakhtunkhwa" },
                  { stateProvinceDesc: "Balochistan" },
                  { stateProvinceDesc: "Islamabad Capital Territory" },
                ]
              : [],
        };
      const result = await fetch(
        `https://gw.fbr.gov.pk/pdi/v1/${paths[kind]}`,
        {
          headers: {
            Authorization: `Bearer ${config.getToken}`,
            Accept: "application/json",
          },
          signal: AbortSignal.timeout(15000),
          redirect: "error",
        },
      );
      if (!result.ok) throw new Error("Reference data unavailable");
      return redact(await result.json());
    },
  });
}
