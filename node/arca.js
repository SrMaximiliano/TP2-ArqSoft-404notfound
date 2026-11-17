import axios from "axios";
import config from "./config.js";
import metrics from "./metrics.js";

const ARCA_TIMEOUT_MS = 5000;

// ARCA fails ~25% of requests at random, independently of the DNI. Those failures are worth retrying.
// Timeouts and connection errors (ECONNABORTED, ECONNREFUSED, ECONNRESET...) are NOT retried:
// they are the symptoms of a saturated or down ARCA, and retrying would only add load to it.
const ARCA_MAX_ATTEMPTS = 3;

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

// Only ARCA's own 5xx answers are retried
const isRetryable = (e) => e.response != null && e.response.status >= 500;

const errorType = (e) => (e.response ? `status_${e.response.status}` : e.code ?? "unknown");

// Asks ARCA whether the DNI has fiscal restrictions to buy/sell foreign currency.
// Retries ARCA's random 5xx failures, within a total budget of ARCA_TIMEOUT_MS.
// Never throws. Returns:
//   { ok: true,  codigoAutorizacion: "<uuid>", error: null,  attempts }  -> approved
//   { ok: false, codigoAutorizacion: null,     error: null,  attempts }  -> rejected by ARCA
//   { ok: false, codigoAutorizacion: null,     error: "...", attempts }  -> ARCA failed / unreachable
//
// Metrics (measured from our side: ARCA is a black box we can't instrument):
//   arvault.arca.latency  histogram, tags result, attempts -> ms of the whole validation (retries included)
//   arvault.arca.result   count,     tags result, attempts -> final outcome: approved | rejected | error
//   arvault.arca.error    count,     tag type   -> EVERY failed attempt, retried or not: ARCA's raw failure rate
//                                                  (status_500, ECONNABORTED = timeout, ECONNREFUSED...)
//   arvault.arca.retry    count,     tag type   -> attempts that were retried
export async function validarDni(dni) {
  const start = Date.now();
  let attempts = 0;

  while (true) {
    attempts++;
    const remaining = ARCA_TIMEOUT_MS - (Date.now() - start);

    try {
      const response = await axios.post(
        `${config.arcaUri}/validar`,
        { dni },
        { timeout: remaining }
      );

      const { ok, codigoAutorizacion } = response.data ?? {};
      const result = {
        ok: ok === true,
        codigoAutorizacion: ok === true ? codigoAutorizacion ?? null : null,
        error: null,
        attempts,
      };

      const outcome = result.ok ? "approved" : "rejected";
      const tags = { result: outcome, attempts: String(attempts) };
      metrics.histogram("arvault.arca.latency", Date.now() - start, tags);
      metrics.increment("arvault.arca.result", 1, tags);

      if (result.ok) {
        console.log(`ARCA validation APPROVED dni=${dni} codigoAutorizacion=${result.codigoAutorizacion} attempts=${attempts}`);
      } else {
        console.log(`ARCA validation REJECTED dni=${dni} attempts=${attempts}`);
      }
      return result;
    } catch (e) {
      const type = errorType(e);
      metrics.increment("arvault.arca.error", 1, { type });

      const timeLeft = ARCA_TIMEOUT_MS - (Date.now() - start);

      if (isRetryable(e) && attempts < ARCA_MAX_ATTEMPTS && timeLeft > 0) {
        metrics.increment("arvault.arca.retry", 1, { type });
        console.warn(`ARCA validation RETRY dni=${dni} attempt=${attempts} ${type}`);
        continue;
      }

      const error = e.response
        ? `ARCA responded with status ${e.response.status}`
        : `ARCA request failed: ${e.code ?? e.message}`;
      const tags = { result: "error", attempts: String(attempts) };
      metrics.histogram("arvault.arca.latency", Date.now() - start, tags);
      metrics.increment("arvault.arca.result", 1, tags);
      console.error(`ARCA validation ERROR dni=${dni} attempts=${attempts} ${error}`);
      return { ok: false, codigoAutorizacion: null, error, attempts };
    }
  }
}
