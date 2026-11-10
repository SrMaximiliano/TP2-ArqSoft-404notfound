import express from "express";
import { isValidDni, MIN_DNI, MAX_DNI } from "./arca.js";
import metrics from "./metrics.js";

import {
  init as exchangeInit,
  getAccounts,
  setAccountBalance,
  getRates,
  setRate,
  getLogPage,
  exchange,
} from "./exchange.js";

await exchangeInit();

const app = express();
const port = 3000;

app.use(express.json());

const isPositiveNumber = (n) => typeof n === "number" && isFinite(n) && n > 0;
const isNonNegativeNumber = (n) => typeof n === "number" && isFinite(n) && n >= 0;
const hasAccount = async (currency) =>
  (await getAccounts()).some((a) => a.currency === currency);
const hasRate = async (base, counter) =>
  typeof (await getRates())?.[base]?.[counter] === "number";

const badRequest = (res, message) => res.status(400).json({ error: message });


const safe = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);

// Health / baseline latency endpoint (doesn't touch Redis nor ARCA)
app.get("/", (req, res) => {
  res.status(200).send("Server is up.");
});

// ACCOUNT endpoints

app.get("/accounts", async (req, res) => {
  res.json(await getAccounts());
});

app.put("/accounts/:id/balance", safe(async (req, res) => {
  const accountId = req.params.id;
  const { balance } = req.body;

  if (!accountId || !isNonNegativeNumber(balance)) {
    return badRequest(res, "Malformed request");
  }

  await setAccountBalance(accountId, balance);

  res.json(await getAccounts());
}));

// RATE endpoints

app.get("/rates", async (req, res) => {
  res.json(await getRates());
});

app.put("/rates", safe(async (req, res) => {
  const { baseCurrency, counterCurrency, rate } = req.body;

  if (
    !baseCurrency ||
    !counterCurrency ||
    baseCurrency === counterCurrency ||
    !(await hasAccount(baseCurrency)) ||
    !(await hasAccount(counterCurrency)) ||
    !isPositiveNumber(rate)
  ) {
    return badRequest(res, "Malformed request");
  }

  const newRateRequest = { ...req.body };
  await setRate(newRateRequest);

  res.json(await getRates());
}));

// LOG endpoint

app.get("/log", async (req, res) => {
  let page = parseInt(req.query.page);
  let limit = parseInt(req.query.limit);
  
  if (isNaN(page)){
    page = 1;
  }
  
  if (isNaN(limit)){
    limit = 100;
  }
  
  page = Math.max(page, 1)
  limit = Math.min(limit, 100)
  let logs = await getLogPage(page, limit);
  res.status(200).json({
    page,
    limit,
    count: logs.length,
    data:logs
  });
});

// EXCHANGE endpoint

// Server-side view of every /exchange response, per node (the agent adds the host tag):
//   arvault.exchange.response  count,     tag status -> 200, 400, 403, 503, 500...
//   arvault.exchange.duration  histogram, tag status -> ms inside arVault (ARCA + Redis + transfers)
// Registered on "finish" so it also covers 400s and unexpected errors.
const exchangeMetrics = (req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const tags = { status: String(res.statusCode) };
    metrics.increment("arvault.exchange.response", 1, tags);
    metrics.histogram("arvault.exchange.duration", Date.now() - start, tags);
  });
  next();
};

app.post(
  "/exchange",
  exchangeMetrics,
  safe(async (req, res) => {
    const {
      baseCurrency,
      counterCurrency,
      baseAccountId,
      counterAccountId,
      baseAmount,
      dni,
    } = req.body;

    if (!isValidDni(dni)) {
      return badRequest(res, `Malformed request: dni must be a string with a number between ${MIN_DNI} and ${MAX_DNI}`);
    }

    if (
      !baseCurrency ||
      !counterCurrency ||
      !baseAccountId ||
      !counterAccountId ||
      !(await hasAccount(baseCurrency)) ||
      !(await hasAccount(counterCurrency)) ||
      !(await hasRate(baseCurrency, counterCurrency)) ||
      !isPositiveNumber(baseAmount)
    ) {
      return badRequest(res, "Malformed request");
    }

    const exchangeRequest = { ...req.body };
    const exchangeResult = await exchange(exchangeRequest);

    if (exchangeResult.ok) {
      res.status(200).json(exchangeResult);
    } else if (exchangeResult.arca.error) {
      //ARCA (a dependency) is failing: service temporarily unavailable
      res.status(503).json(exchangeResult);
    } else if (!exchangeResult.arca.ok) {
      //ARCA rejected the client: operation forbidden
      res.status(403).json(exchangeResult);
    } else {
      res.status(500).json(exchangeResult);
    }
  })
);

app.listen(port, () => {
  console.log(`Exchange API listening on port ${port}`);
});

export default app;
