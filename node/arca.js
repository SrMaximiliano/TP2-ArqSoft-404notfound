import axios from "axios";
import config from "./config.js";
import metrics from "./metrics.js";

const ARCA_TIMEOUT_MS = 5000;

export const MIN_DNI = 1000000;
export const MAX_DNI = 99999999;

// dni must be a string of digits within the valid range
export function isValidDni(dni) {
  if (typeof dni !== "string" || !/^\d+$/.test(dni)) {
    return false;
  }
  const n = Number(dni);
  return n >= MIN_DNI && n <= MAX_DNI;
}

// Asks ARCA whether the DNI has fiscal restrictions to buy/sell foreign currency.
// Never throws. Returns:
//   { ok: true,  codigoAutorizacion: "<uuid>", error: null }  -> approved
//   { ok: false, codigoAutorizacion: null,     error: null }  -> rejected by ARCA
//   { ok: false, codigoAutorizacion: null,     error: "..." } -> ARCA failed / unreachable
//
// Metrics (measured from our side: ARCA is a black box we can't instrument):
//   arvault.arca.latency  histogram, tag result -> ms of the ARCA call as seen by arVault
//   arvault.arca.result   count,     tag result -> approved | rejected | error
//   arvault.arca.error    count,     tag type   -> status_500, ECONNABORTED (timeout), ECONNREFUSED...
export async function validarDni(dni) {
  const start = Date.now();
  try {
    const response = await axios.post(
      `${config.arcaUri}/validar`,
      { dni },
      { timeout: ARCA_TIMEOUT_MS }
    );

    const { ok, codigoAutorizacion } = response.data ?? {};
    const result = {
      ok: ok === true,
      codigoAutorizacion: ok === true ? codigoAutorizacion ?? null : null,
      error: null,
    };

    const outcome = result.ok ? "approved" : "rejected";
    metrics.histogram("arvault.arca.latency", Date.now() - start, { result: outcome });
    metrics.increment("arvault.arca.result", 1, { result: outcome });

    if (result.ok) {
      console.log(`ARCA validation APPROVED dni=${dni} codigoAutorizacion=${result.codigoAutorizacion}`);
    } else {
      console.log(`ARCA validation REJECTED dni=${dni}`);
    }
    return result;
  } catch (e) {
    const error = e.response
      ? `ARCA responded with status ${e.response.status}`
      : `ARCA request failed: ${e.code ?? e.message}`;
    metrics.histogram("arvault.arca.latency", Date.now() - start, { result: "error" });
    metrics.increment("arvault.arca.result", 1, { result: "error" });
    metrics.increment("arvault.arca.error", 1, {
      type: e.response ? `status_${e.response.status}` : e.code ?? "unknown",
    });
    console.error(`ARCA validation ERROR dni=${dni} ${error}`);
    return { ok: false, codigoAutorizacion: null, error };
  }
}
