// ═══════════════════════════════════════════════════════════════════
//  ГОЛОВНИЙ ФАЙЛ. Зазвичай чіпати не треба — усе керується з config.js
// ═══════════════════════════════════════════════════════════════════
import WebSocket from "ws";
import TelegramBot from "node-telegram-bot-api";
import express from "express";
import { CONFIG } from "./config.js";

// ── Сховище даних у памʼяті ───────────────────────────────────────────
// markets[exchange][symbol] = { funding, price, priceChange24h, volume24h, oi, interval, nextFundingTs, hasSpot, hasFutures }
const markets = {};
for (const ex of CONFIG.EXCHANGES) markets[ex] = {};

// Множина спотових символів кожної біржі (заповнюється REST-запитом при старті)
const spotSets = {};
for (const ex of CONFIG.EXCHANGES) spotSets[ex] = new Set();

// Реальний інтервал фандінгу (години) для пари: fundingIntervals[ex][symbol]
const fundingIntervals = {};
for (const ex of CONFIG.EXCHANGES) fundingIntervals[ex] = {};

const lastSent = {}; // ключ -> timestamp останнього сигналу (анти-спам)

// Маленький помічник: REST-запит з таймаутом (fetch вбудований у Node 18+)
async function getJson(url, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(url, { ...opts, signal: ctrl.signal });
    return await r.json();
  } catch (e) {
    console.log(`   REST помилка ${url}: ${e.message}`);
    return null;
  } finally {
    clearTimeout(t);
  }
}

// ── Telegram ──────────────────────────────────────────────────────────
let bot = null;
if (CONFIG.TELEGRAM_TOKEN && CONFIG.TELEGRAM_CHAT_ID) {
  bot = new TelegramBot(CONFIG.TELEGRAM_TOKEN, { polling: false });
  console.log("✅ Telegram підключено");
} else {
  console.log("⚠️  Telegram токен не заданий — сигнали друкуватимуться лише в лог");
}

async function sendSignal(text) {
  console.log("🔔 СИГНАЛ:\n" + text + "\n");
  if (bot) {
    try {
      await bot.sendMessage(CONFIG.TELEGRAM_CHAT_ID, text, { parse_mode: "HTML" });
    } catch (e) {
      console.error("Помилка надсилання в Telegram:", e.message);
    }
  }
}

// ── Допоміжні ─────────────────────────────────────────────────────────
const netProfit = (funding) => Math.abs(funding) - CONFIG.FEE_PER_SIDE * 2;
const minsToFunding = (ts) => (ts - Date.now()) / 60000;
const fmtUsd = (n) => (n >= 1e9 ? "$" + (n / 1e9).toFixed(2) + "B"
  : n >= 1e6 ? "$" + (n / 1e6).toFixed(1) + "M"
  : "$" + (n / 1e3).toFixed(0) + "K");

function tradePlan(funding, exchange) {
  if (funding >= 0) {
    return `📉 Шорт фʼючерс (${exchange})\n📈 Купити спот (${exchange})`;
  }
  return `📈 Лонг фʼючерс (${exchange})\n📉 Шорт/продати спот (${exchange})`;
}

// ── Перевірка умов і розсилка ─────────────────────────────────────────
function checkSignals() {
  const now = Date.now();
  for (const ex of CONFIG.EXCHANGES) {
    for (const [symbol, m] of Object.entries(markets[ex])) {
      if (!m || m.funding == null || m.price == null) continue;

      // фільтр: спот + фʼючерс
      if (CONFIG.REQUIRE_SPOT_AND_FUTURES && (!m.hasSpot || !m.hasFutures)) continue;

      const net = netProfit(m.funding);
      if (net < CONFIG.MIN_NET_PROFIT || net > CONFIG.MAX_NET_PROFIT) continue;
      if (Math.abs(m.priceChange24h ?? 0) > CONFIG.MAX_PRICE_CHANGE_24H) continue;
      if ((m.volume24h ?? 0) < CONFIG.MIN_VOLUME_24H) continue;
      if ((m.oi ?? 0) < CONFIG.MIN_OI) continue;

      const mins = minsToFunding(m.nextFundingTs);
      if (mins < 0 || mins > CONFIG.SIGNAL_WINDOW_MIN) continue;

      // анти-спам
      const key = `${ex}-${symbol}`;
      const last = lastSent[key] || 0;
      if (now - last < CONFIG.RESEND_COOLDOWN_MIN * 60000) continue;
      lastSent[key] = now;

      const msg =
        `🎯 <b>${symbol}</b> на <b>${ex.toUpperCase()}</b>\n` +
        `💰 Чистий прибуток: <b>${net >= 0 ? "+" : ""}${net.toFixed(3)}%</b>\n` +
        `📊 Фандінг: ${m.funding >= 0 ? "+" : ""}${m.funding.toFixed(3)}% (кожні ${m.interval}г)\n` +
        `💵 Ціна: $${m.price}\n` +
        `📈 Зміна 24г: ${(m.priceChange24h ?? 0).toFixed(2)}%\n` +
        `🔊 Обсяг: ${fmtUsd(m.volume24h)} · OI: ${fmtUsd(m.oi)}\n` +
        `⏱ Виплата через ~${Math.round(mins)} хв\n\n` +
        `<b>Як торгувати:</b>\n${tradePlan(m.funding, ex)}`;

      sendSignal(msg);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
//  ПІДКЛЮЧЕННЯ ДО БІРЖ (WebSocket). Кожна біржа — окрема функція.
//  Якщо звʼязок обірветься — автоматично перепідключається.
// ═══════════════════════════════════════════════════════════════════
function connect(name, url, onOpen, onMessage) {
  let ws;
  const open = () => {
    ws = new WebSocket(url);
    ws.on("open", () => { console.log(`🔌 ${name}: підключено`); onOpen(ws); });
    ws.on("message", (data) => { try { onMessage(JSON.parse(data.toString())); } catch {} });
    ws.on("close", () => { console.log(`🔁 ${name}: розрив, перепідключення за 5с`); setTimeout(open, 5000); });
    ws.on("error", (e) => { console.log(`❌ ${name}: помилка ${e.message}`); ws.close(); });
  };
  open();
  return () => ws;
}

const setM = (ex, symbol, patch) => {
  markets[ex][symbol] = { ...(markets[ex][symbol] || {}), ...patch };
};

// ── BINANCE ───────────────────────────────────────────────────────────
// !markPrice@arr дає фандінг + nextFundingTime по всіх перпах одразу
function startBinance() {
  connect("Binance", "wss://fstream.binance.com/ws/!markPrice@arr",
    () => {},
    (arr) => {
      if (!Array.isArray(arr)) return;
      for (const t of arr) {
        const symbol = t.s.replace("USDT", "");
        if (!t.s.endsWith("USDT")) continue;
        setM("binance", symbol, {
          funding: parseFloat(t.r) * 100,        // r = funding rate
          price: parseFloat(t.p),                // mark price
          nextFundingTs: t.T,                    // next funding time (ms)
          interval: 8,                           // більшість перпів Binance = 8г
          hasFutures: true,
        });
      }
    }
  );
  // тикер 24г (обсяг + зміна ціни)
  connect("Binance-24h", "wss://fstream.binance.com/ws/!ticker@arr",
    () => {},
    (arr) => {
      if (!Array.isArray(arr)) return;
      for (const t of arr) {
        if (!t.s?.endsWith("USDT")) continue;
        const symbol = t.s.replace("USDT", "");
        setM("binance", symbol, {
          priceChange24h: parseFloat(t.P),       // % зміни
          volume24h: parseFloat(t.q),            // обсяг у $ (quote)
        });
      }
    }
  );
}

// ── BYBIT ─────────────────────────────────────────────────────────────
function startBybit() {
  // Bybit вимагає підписки на конкретні тикери; беремо найпопулярніші
  connect("Bybit", "wss://stream.bybit.com/v5/public/linear",
    (ws) => {
      // підписка на всі тикери неможлива одним рядком — підписуємось по символах
      // тут спрощено: топові пари. Розширюй список за потреби.
      const syms = BYBIT_SYMBOLS.map((s) => `tickers.${s}USDT`);
      ws.send(JSON.stringify({ op: "subscribe", args: syms }));
      // пінг кожні 20с щоб не відключило
      setInterval(() => { try { ws.send(JSON.stringify({ op: "ping" })); } catch {} }, 20000);
    },
    (msg) => {
      if (msg.topic?.startsWith("tickers.") && msg.data) {
        const d = msg.data;
        const symbol = d.symbol.replace("USDT", "");
        const patch = { hasFutures: true, interval: 8 };
        if (d.fundingRate != null) patch.funding = parseFloat(d.fundingRate) * 100;
        if (d.markPrice != null) patch.price = parseFloat(d.markPrice);
        if (d.nextFundingTime != null) patch.nextFundingTs = parseInt(d.nextFundingTime);
        if (d.price24hPcnt != null) patch.priceChange24h = parseFloat(d.price24hPcnt) * 100;
        if (d.turnover24h != null) patch.volume24h = parseFloat(d.turnover24h);
        if (d.openInterestValue != null) patch.oi = parseFloat(d.openInterestValue);
        setM("bybit", symbol, patch);
      }
    }
  );
}

// ── OKX ───────────────────────────────────────────────────────────────
function startOKX() {
  connect("OKX", "wss://ws.okx.com:8443/ws/v5/public",
    (ws) => {
      const args = OKX_SYMBOLS.flatMap((s) => ([
        { channel: "funding-rate", instId: `${s}-USDT-SWAP` },
        { channel: "tickers", instId: `${s}-USDT-SWAP` },
      ]));
      ws.send(JSON.stringify({ op: "subscribe", args }));
      setInterval(() => { try { ws.send("ping"); } catch {} }, 20000);
    },
    (msg) => {
      if (!msg.arg || !msg.data) return;
      const inst = msg.arg.instId || "";
      const symbol = inst.replace("-USDT-SWAP", "");
      if (msg.arg.channel === "funding-rate") {
        const d = msg.data[0];
        const next = parseInt(d.nextFundingTime);
        // OKX дає поточний і наступний час виплати → інтервал = різниця
        let interval = fundingIntervals.okx[symbol];
        if (!interval && d.fundingTime && d.nextFundingTime) {
          interval = msToHours(parseInt(d.nextFundingTime) - parseInt(d.fundingTime));
          fundingIntervals.okx[symbol] = interval;
        }
        setM("okx", symbol, {
          funding: parseFloat(d.fundingRate) * 100,
          nextFundingTs: next,
          interval: interval || 8, hasFutures: true,
        });
      } else if (msg.arg.channel === "tickers") {
        const d = msg.data[0];
        const open = parseFloat(d.open24h), last = parseFloat(d.last);
        setM("okx", symbol, {
          price: last,
          priceChange24h: open ? ((last - open) / open) * 100 : 0,
          volume24h: parseFloat(d.volCcy24h) * last,
          hasFutures: true,
        });
      }
    }
  );
}

// ── BITGET ────────────────────────────────────────────────────────────
function startBitget() {
  connect("Bitget", "wss://ws.bitget.com/v2/ws/public",
    (ws) => {
      const args = BITGET_SYMBOLS.map((s) => ({ instType: "USDT-FUTURES", channel: "ticker", instId: `${s}USDT` }));
      ws.send(JSON.stringify({ op: "subscribe", args }));
      setInterval(() => { try { ws.send("ping"); } catch {} }, 20000);
    },
    (msg) => {
      if (msg.arg?.channel === "ticker" && msg.data) {
        const d = msg.data[0];
        const symbol = d.instId.replace("USDT", "");
        setM("bitget", symbol, {
          funding: parseFloat(d.fundingRate) * 100,
          price: parseFloat(d.lastPr),
          priceChange24h: parseFloat(d.change24h) * 100,
          volume24h: parseFloat(d.quoteVolume),
          oi: parseFloat(d.holdingAmount) * parseFloat(d.lastPr),
          interval: 8, hasFutures: true,
        });
      }
    }
  );
}

// ── GATE.IO ───────────────────────────────────────────────────────────
function startGate() {
  connect("Gate", "wss://fx-ws.gateio.ws/v4/ws/usdt",
    (ws) => {
      const t = Math.floor(Date.now() / 1000);
      ws.send(JSON.stringify({ time: t, channel: "futures.tickers", event: "subscribe", payload: GATE_SYMBOLS.map((s) => `${s}_USDT`) }));
      setInterval(() => { try { ws.send(JSON.stringify({ time: Math.floor(Date.now()/1000), channel: "futures.ping" })); } catch {} }, 20000);
    },
    (msg) => {
      if (msg.channel === "futures.tickers" && msg.result) {
        for (const d of msg.result) {
          const symbol = d.contract.replace("_USDT", "");
          setM("gateio", symbol, {
            funding: parseFloat(d.funding_rate) * 100,
            price: parseFloat(d.last),
            priceChange24h: parseFloat(d.change_percentage),
            volume24h: parseFloat(d.volume_24h_settle || d.volume_24h_quote || 0),
            interval: 8, hasFutures: true,
          });
        }
      }
    }
  );
}

// ── СПИСКИ СИМВОЛІВ для бірж, що потребують підписки ───────────────────
// (Binance шле все одразу; решта — лише на що підписались)
const COMMON = ["BTC","ETH","SOL","BNB","XRP","DOGE","AVAX","LINK","ADA","TRX","DOT","LTC","BCH","NEAR",
  "APT","ARB","OP","SUI","INJ","TIA","SEI","FIL","ATOM","UNI","AAVE","ORDI","WIF","PEPE","ENA","ONDO",
  "TON","NOT","WLD","TAO","FET","JUP","PYTH","STRK","SHIB","FLOKI","BONK","GALA","SAND","MANA"];
const BYBIT_SYMBOLS = COMMON;
const OKX_SYMBOLS = COMMON;
const BITGET_SYMBOLS = COMMON;
const GATE_SYMBOLS = COMMON;

// ═══════════════════════════════════════════════════════════════════
//  REST-ЗАПИТИ ПРИ СТАРТІ (виконуються один раз):
//  1) які пари є на СПОТІ кожної біржі  → точна перевірка hasSpot
//  2) реальний ІНТЕРВАЛ фандінгу (1–8 год) для кожної пари
// ═══════════════════════════════════════════════════════════════════

// Перетворення «мілісекунди між виплатами» -> години
const msToHours = (ms) => Math.max(1, Math.round(ms / 3600000));

async function loadBinanceMeta() {
  // Спот: усі символи зі spot exchangeInfo
  const spot = await getJson("https://api.binance.com/api/v3/exchangeInfo");
  if (spot?.symbols) for (const s of spot.symbols)
    if (s.quoteAsset === "USDT" && s.status === "TRADING") spotSets.binance.add(s.baseAsset);
  // Інтервали фандінгу: fundingInfo (де є кастомний інтервал; решта = 8г)
  const info = await getJson("https://fapi.binance.com/fapi/v1/fundingInfo");
  if (Array.isArray(info)) for (const it of info) {
    const sym = it.symbol?.replace("USDT", "");
    if (sym && it.fundingIntervalHours) fundingIntervals.binance[sym] = parseInt(it.fundingIntervalHours);
  }
  console.log(`   Binance: спот ${spotSets.binance.size} пар`);
}

async function loadBybitMeta() {
  const spot = await getJson("https://api.bybit.com/v5/market/instruments-info?category=spot");
  if (spot?.result?.list) for (const s of spot.result.list)
    if (s.quoteCoin === "USDT") spotSets.bybit.add(s.baseCoin);
  // Інтервал фандінгу — у instruments-info linear (fundingInterval у хвилинах)
  const lin = await getJson("https://api.bybit.com/v5/market/instruments-info?category=linear");
  if (lin?.result?.list) for (const s of lin.result.list) {
    const sym = s.symbol?.replace("USDT", "");
    if (sym && s.fundingInterval) fundingIntervals.bybit[sym] = msToHours(parseInt(s.fundingInterval) * 60000);
  }
  console.log(`   Bybit: спот ${spotSets.bybit.size} пар`);
}

async function loadOKXMeta() {
  const spot = await getJson("https://www.okx.com/api/v5/public/instruments?instType=SPOT");
  if (spot?.data) for (const s of spot.data)
    if (s.quoteCcy === "USDT") spotSets.okx.add(s.baseCcy);
  console.log(`   OKX: спот ${spotSets.okx.size} пар`);
  // OKX інтервал приходить у самому WS (fundingTime/nextFundingTime) — порахуємо динамічно
}

async function loadBitgetMeta() {
  const spot = await getJson("https://api.bitget.com/api/v2/spot/public/symbols");
  if (spot?.data) for (const s of spot.data)
    if (s.quoteCoin === "USDT") spotSets.bitget.add(s.baseCoin);
  // Інтервал: contracts (fundInterval у годинах)
  const c = await getJson("https://api.bitget.com/api/v2/mix/market/contracts?productType=USDT-FUTURES");
  if (c?.data) for (const s of c.data) {
    const sym = s.symbol?.replace("USDT", "");
    if (sym && s.fundInterval) fundingIntervals.bitget[sym] = parseInt(s.fundInterval);
  }
  console.log(`   Bitget: спот ${spotSets.bitget.size} пар`);
}

async function loadGateMeta() {
  const spot = await getJson("https://api.gateio.ws/api/v4/spot/currency_pairs");
  if (Array.isArray(spot)) for (const s of spot)
    if (s.quote === "USDT" && s.trade_status === "tradable") spotSets.gateio.add(s.base);
  // Інтервал: futures contracts (funding_interval у секундах)
  const c = await getJson("https://api.gateio.ws/api/v4/futures/usdt/contracts");
  if (Array.isArray(c)) for (const s of c) {
    const sym = s.name?.replace("_USDT", "");
    if (sym && s.funding_interval) fundingIntervals.gateio[sym] = msToHours(parseInt(s.funding_interval) * 1000);
  }
  console.log(`   Gate: спот ${spotSets.gateio.size} пар`);
}

const metaLoaders = {
  binance: loadBinanceMeta, bybit: loadBybitMeta, okx: loadOKXMeta,
  bitget: loadBitgetMeta, gateio: loadGateMeta,
};

async function loadAllMeta() {
  console.log("📥 Завантажую списки спота та інтервали фандінгу (один раз)...");
  await Promise.all(CONFIG.EXCHANGES.map((ex) => metaLoaders[ex]?.().catch((e) => console.log(`   ${ex} meta помилка: ${e.message}`))));
  console.log("✅ Метадані завантажено");
}

// Проставляємо hasSpot за реальними списками + застосовуємо реальний інтервал
function applyMeta() {
  for (const ex of CONFIG.EXCHANGES) {
    for (const [sym, m] of Object.entries(markets[ex])) {
      m.hasSpot = spotSets[ex].has(sym);
      // якщо REST дав точний інтервал — беремо його; інакше рахуємо з nextFundingTs у WS (OKX)
      if (fundingIntervals[ex][sym]) m.interval = fundingIntervals[ex][sym];
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
//  СТАРТ
// ═══════════════════════════════════════════════════════════════════
console.log("🚀 Запуск FundingHunter Bot...");
console.log("Біржі:", CONFIG.EXCHANGES.join(", "));

const starters = { binance: startBinance, bybit: startBybit, okx: startOKX, bitget: startBitget, gateio: startGate };

// Спочатку REST (списки спота + інтервали), потім WebSocket-стріми
await loadAllMeta();
for (const ex of CONFIG.EXCHANGES) starters[ex]?.();

setInterval(() => { applyMeta(); checkSignals(); }, CONFIG.CHECK_INTERVAL_MS);

// Раз на 12 годин освіжаємо метадані (нові лістинги, зміни інтервалів)
setInterval(() => { loadAllMeta(); }, 12 * 3600 * 1000);

// Маленька веб-сторінка щоб бачити що бот живий + останні дані
const app = express();
app.get("/", (_req, res) => {
  const rows = [];
  for (const ex of CONFIG.EXCHANGES)
    for (const [sym, m] of Object.entries(markets[ex]))
      if (m.funding != null) rows.push({ ex, sym, ...m, net: netProfit(m.funding).toFixed(3) });
  rows.sort((a, b) => Math.abs(b.funding) - Math.abs(a.funding));
  res.send(`<h2>✅ FundingHunter Bot працює</h2>
    <p>Активних котирувань: ${rows.length}</p>
    <table border=1 cellpadding=4><tr><th>Біржа</th><th>Актив</th><th>Фандінг%</th><th>Чистий%</th><th>Ціна</th><th>Зміна24г%</th></tr>
    ${rows.slice(0, 50).map((r) => `<tr><td>${r.ex}</td><td>${r.sym}</td><td>${r.funding?.toFixed(3)}</td><td>${r.net}</td><td>${r.price}</td><td>${(r.priceChange24h ?? 0).toFixed(2)}</td></tr>`).join("")}
    </table>`);
});
app.listen(CONFIG.PORT, () => console.log(`🌐 Статус-сторінка на порту ${CONFIG.PORT}`));

// Привітальне повідомлення при старті
if (bot) sendSignal("🚀 FundingHunter запущено! Шукаю можливості фандінгу...");
