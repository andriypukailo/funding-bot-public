// ═══════════════════════════════════════════════════════════════════
//  ГОЛОВНИЙ ФАЙЛ. Зазвичай чіпати не треба — усе керується з config.js
// ═══════════════════════════════════════════════════════════════════
import WebSocket from "ws";
import TelegramBot from "node-telegram-bot-api";
import express from "express";
import { CONFIG } from "./config.js";

// ── HTML живого дашборда (вантажиться у браузері, сам тягне /api/data) ──
const DASHBOARD_HTML = `<!doctype html>
<html lang="uk"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>FundingHunter</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#0a0e17;color:#cbd5e1;font-family:'Inter','Segoe UI',system-ui,sans-serif}
  header{padding:14px 22px;border-bottom:1px solid #16202e;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;position:sticky;top:0;background:#0a0e17ee;backdrop-filter:blur(8px);z-index:10}
  .brand{display:flex;align-items:center;gap:11px}
  .mark{width:34px;height:34px;border-radius:9px;background:radial-gradient(circle at 30% 30%,#fde047,#f59e0b 70%);display:flex;align-items:center;justify-content:center;font-size:18px;box-shadow:0 0 18px #f59e0b55}
  .bt{font-size:17px;font-weight:800;color:#f8fafc}
  .sub{font-size:11px;color:#475569}
  .wrap{padding:18px 22px 60px;max-width:1320px;margin:0 auto}
  .legend{margin-bottom:14px;padding:10px 14px;background:#0b1320;border:1px solid #16202e;border-radius:10px;font-size:12px;color:#94a3b8;line-height:1.6}
  .legend b{color:#cbd5e1}
  .stats{display:flex;gap:14px;flex-wrap:wrap;margin-bottom:16px}
  .stat{flex:1 1 130px;background:#0e1521;border:1px solid #16202e;border-radius:12px;padding:12px 14px}
  .stat .l{font-size:11px;color:#64748b;font-weight:600;margin-bottom:4px}
  .stat .v{font-size:21px;font-weight:800}
  .toolbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:14px;font-size:12px}
  .toolbar label{color:#64748b}
  .toolbar input{background:#070b12;border:1px solid #243042;border-radius:7px;color:#e2e8f0;padding:5px 9px;font-size:12px;width:90px}
  .toolbar button{background:#16202e;border:1px solid #243042;border-radius:7px;color:#cbd5e1;padding:5px 12px;font-size:12px;cursor:pointer}
  table{width:100%;border-collapse:collapse}
  th{padding:9px 11px;font-size:10.5px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:.05em;text-align:right;white-space:nowrap;border-bottom:1px solid #16202e}
  th.l,td.l{text-align:left}
  td{padding:8px 11px;font-size:12.5px;text-align:right;border-bottom:1px solid #111a26;font-variant-numeric:tabular-nums}
  tr.sig{background:#1c1605}
  .pill{font-size:10px;padding:1px 6px;border-radius:5px;background:#16202e;color:#94a3b8;margin-left:4px}
  .muted{color:#475569}
  .scroll{overflow-x:auto}
</style></head>
<body>
<header>
  <div class="brand"><div class="mark">◎</div>
    <div><div class="bt">FundingHunter</div><div class="sub" id="sub">завантаження…</div></div></div>
  <div style="display:flex;gap:12px;align-items:center">
    <span class="sub" id="upd"></span>
    <span id="sigcount" style="font-size:12px;font-weight:700;color:#475569">● 0 сигналів</span>
  </div>
</header>
<div class="wrap">
  <div class="legend">
    Фандінг є <b>лише на фʼючерсах</b>. Дельта-нейтрально: позиція на фʼючерсах + рівна протилежна на споті тієї ж біржі.
    <span style="color:#fb7185">Додатній → шорт фʼючерс + купити спот.</span>
    <span style="color:#4ade80">Відʼємний → лонг фʼючерс + шорт спот.</span>
    Жовте = сигнал (до виплати ≤ <span id="win">30</span> хв).
    <span class="pill" style="color:#fbbf24">🔀 крос</span> = спот на іншій біржі. Нетто = фандінг − комісії (БЕЗ крос-витрати); крос-витрата <span id="cc">0.1</span>% показана окремою колонкою.
  </div>
  <div class="stats" id="stats"></div>
  <div class="toolbar">
    <label>Чистий від %<input id="fMin" type="number" step="0.1" value="0.3"></label>
    <label>до %<input id="fMax" type="number" step="0.1" value="4"></label>
    <label>Макс. ціна 24г %<input id="fPrice" type="number" step="0.5" value="5"></label>
    <label><input id="fBoth" type="checkbox" checked style="width:auto"> є спот+фʼючерс (крос-біржово)</label>
    <button onclick="applyClient()">Застосувати</button>
    <button onclick="resetClient()">Скинути</button>
    <button id="allBtn" onclick="toggleAll()">Показати всі</button>
    <span class="muted" id="count"></span>
  </div>
  <div class="scroll">
    <table>
      <thead><tr>
        <th class="l">Актив</th><th class="l">Біржа</th><th>Ціна</th>
        <th>Фандінг</th><th style="color:#fbbf24">Нетто</th><th style="color:#94a3b8">Крос-витр.</th>
        <th class="l">Як торгувати</th><th>Інт.</th><th>До виплати</th>
        <th>Ціна 24г</th><th>Обсяг</th><th>OI</th>
      </tr></thead>
      <tbody id="tb"></tbody>
    </table>
  </div>
</div>
<script>
let CFG=null, RAW=[], SHOW_ALL=false;
const fmtUsd=n=>n==null?'—':n>=1e9?'$'+(n/1e9).toFixed(2)+'B':n>=1e6?'$'+(n/1e6).toFixed(1)+'M':n>=1e3?'$'+(n/1e3).toFixed(0)+'K':'$'+n.toFixed(0);
const fmtPct=n=>n==null?'—':(n>=0?'+':'')+n.toFixed(3)+'%';
const fmtPrice=n=>n==null?'—':n>=1000?'$'+n.toLocaleString('en-US',{maximumFractionDigits:1}):n>=1?'$'+n.toFixed(3):'$'+n.toFixed(6);
const fmtMins=m=>{if(m==null)return'—';m=Math.floor(m);return m<0?'—':m<60?m+'хв':Math.floor(m/60)+'г '+(m%60)+'хв';};
const fc=f=>f>=0?'#fb7185':'#4ade80';
function plan(r){
  const venues=(r.spotVenues||[]).filter(v=>v!==r.ex);
  const sameSpot=r.hasSpot;
  if(r.funding>=0){
    let s='📈 Купити спот';
    if(sameSpot){s+=' ('+r.ex+')';if(venues.length)s+=' / '+venues.join(', ');}
    else if(venues.length){s+=': '+venues.join(', ');}
    else{s+=' (немає)';}
    return{f:'📉 Шорт фʼючерс ('+r.ex+')',s};
  }
  let s='📉 Шорт спот';
  if(sameSpot){s+=' ('+r.ex+')';if(venues.length)s+=' / '+venues.join(', ');}
  else if(venues.length){s+=': '+venues.join(', ');}
  else{s+=' (немає)';}
  return{f:'📈 Лонг фʼючерс ('+r.ex+')',s};
}

async function load(){
  try{
    const d=await (await fetch('/api/data')).json();
    CFG=d.config; RAW=d.rows;
    document.getElementById('sub').textContent=RAW.length+' котирувань · '+new Set(RAW.map(r=>r.ex)).size+' бірж';
    document.getElementById('upd').textContent='оновлено '+new Date(d.updated).toLocaleTimeString('uk-UA');
    document.getElementById('win').textContent=CFG.window;
    if(CFG.crossCost!=null)document.getElementById('cc').textContent=CFG.crossCost;
    // ініціалізація фільтрів значеннями з бекенда (один раз)
    if(!window._init){window._init=1;
      document.getElementById('fMin').value=CFG.minNet;
      document.getElementById('fMax').value=CFG.maxNet;
      document.getElementById('fPrice').value=CFG.maxPrice;
      document.getElementById('fBoth').checked=CFG.requireBoth;
    }
    render();
  }catch(e){document.getElementById('sub').textContent='помилка завантаження даних';}
}
function getF(){return{
  min:parseFloat(document.getElementById('fMin').value),
  max:parseFloat(document.getElementById('fMax').value),
  price:parseFloat(document.getElementById('fPrice').value),
  both:document.getElementById('fBoth').checked,
};}
function applyClient(){render();}
function toggleAll(){
  SHOW_ALL=!SHOW_ALL;
  document.getElementById('allBtn').textContent=SHOW_ALL?'Лише за фільтром':'Показати всі';
  document.getElementById('allBtn').style.background=SHOW_ALL?'#f59e0b22':'#16202e';
  render();
}
function resetClient(){
  SHOW_ALL=false;
  document.getElementById('allBtn').textContent='Показати всі';
  document.getElementById('allBtn').style.background='#16202e';
  document.getElementById('fMin').value=CFG.minNet;
  document.getElementById('fMax').value=CFG.maxNet;
  document.getElementById('fPrice').value=CFG.maxPrice;
  document.getElementById('fBoth').checked=CFG.requireBoth;
  render();
}
function render(){
  const f=getF();
  let rows=RAW.filter(r=>{
    if(!SHOW_ALL){
      if(r.net<f.min||r.net>f.max)return false;
      if(r.priceChange24h!=null&&Math.abs(r.priceChange24h)>f.price)return false;
      if(r.volume24h!=null&&CFG.minVol&&r.volume24h<CFG.minVol)return false;
      if(r.oi!=null&&CFG.minOi&&r.oi<CFG.minOi)return false;
    }
    if(f.both){
      if(!r.hasFutures)return false;
      const spotAnywhere=(r.spotVenues||[]).length>0;
      if(CFG.cross){ if(!spotAnywhere)return false; }
      else { if(!r.hasSpot)return false; }
    }
    return true;
  });
  // ВАЖЛИВО: вікно часу тут НЕ фільтрує — лише підсвічує (жовтим).
  // Сигнал у Telegram (з умовою ≤ вікно хв) обробляється окремо на бекенді.
  const sig=r=>r.mins!=null&&r.mins>=0&&r.mins<=CFG.window;
  rows.sort((a,b)=>{const sa=sig(a),sb=sig(b);if(sa!==sb)return sa?-1:1;if(sa&&sb)return a.mins-b.mins;return b.net-a.net;});
  const sc=rows.filter(sig).length;
  document.getElementById('sigcount').textContent='● '+sc+' сигналів';
  document.getElementById('sigcount').style.color=sc?'#fde047':'#475569';
  document.getElementById('count').textContent=rows.length+' пар проходять фільтри';
  // статистика
  const all=RAW.map(r=>r.funding);
  const stats=[
    ['Котирувань',RAW.length,'#6366f1'],
    ['Проходять фільтр',rows.length,'#22d3ee'],
    ['Сигналів зараз',sc,'#fde047'],
    ['Макс. чистий',rows.length?fmtPct(Math.max(...rows.map(r=>r.net))):'—','#fbbf24'],
  ];
  document.getElementById('stats').innerHTML=stats.map(s=>
    '<div class="stat"><div class="l">'+s[0]+'</div><div class="v" style="color:'+s[2]+'">'+s[1]+'</div></div>').join('');
  // таблиця
  document.getElementById('tb').innerHTML=rows.slice(0,120).map(r=>{
    const p=plan(r),s=sig(r);
    return '<tr class="'+(s?'sig':'')+'">'+
      '<td class="l" style="font-weight:700;color:#f1f5f9">'+(s?'🎯 ':'')+r.sym+'</td>'+
      '<td class="l" style="font-weight:700;color:#e2e8f0">'+r.ex+
        (r.cross?'<span class="pill" style="color:#fbbf24">🔀 крос</span>':
         (r.hasSpot&&r.hasFutures?'<span class="pill">S+F</span>':''))+'</td>'+
      '<td style="color:#e2e8f0;font-weight:600">'+fmtPrice(r.price)+'</td>'+
      '<td style="font-weight:700;color:'+fc(r.funding)+'">'+fmtPct(r.funding)+'</td>'+
      '<td style="font-weight:800;color:'+(r.net>0?'#fbbf24':'#64748b')+'">'+fmtPct(r.net)+'</td>'+
      '<td style="color:'+(r.cross?'#fbbf24':'#475569')+'">'+(r.cross?'−'+CFG.crossCost+'%':'—')+'</td>'+
      '<td class="l" style="font-size:11px"><div style="color:'+fc(r.funding)+';font-weight:700">'+p.f+'</div><div class="muted">'+p.s+'</div></td>'+
      '<td class="muted">'+(r.interval?r.interval+'г':'—')+'</td>'+
      '<td style="color:'+(s?'#fde047':'#94a3b8')+';font-weight:'+(s?'700':'400')+'">'+fmtMins(r.mins)+'</td>'+
      '<td style="color:'+((r.priceChange24h??0)>=0?'#86efac':'#fca5a5')+'">'+fmtPct(r.priceChange24h)+'</td>'+
      '<td>'+fmtUsd(r.volume24h)+'</td>'+
      '<td>'+fmtUsd(r.oi)+'</td></tr>';
  }).join('')||'<tr><td colspan="12" style="text-align:center;padding:40px;color:#475569">Немає пар за фільтрами. Натисніть «Показати всі», щоб побачити геть усі котирування з бірж (екстремальний фандінг 1–4% буває нечасто).</td></tr>';
}
load(); setInterval(load,10000);
</script>
</body></html>`;

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
// Чи доведеться торгувати крос-біржово (спота немає на тій самій біржі, але є деінде)
function isCross(symbol, futuresEx) {
  if (spotSets[futuresEx].has(symbol)) return false; // спот тут — не крос
  return spotVenues(symbol).length > 0;              // спот лише на іншій біржі
}

// Чистий прибуток (нетто) = |фандінг| − комісія×2. Крос-витрату НЕ віднімаємо тут.
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

// Усі біржі, де ця монета є на споті (для крос-біржового хеджу)
function spotVenues(symbol) {
  const out = [];
  for (const ex of CONFIG.EXCHANGES) if (spotSets[ex].has(symbol)) out.push(ex);
  return out;
}

// Крос-біржовий план: фʼючерс на біржі сигналу, спот — на будь-якій зі spotVenues
function crossPlan(funding, futuresEx, symbol) {
  const venues = spotVenues(symbol).filter((v) => v !== futuresEx);
  const sameHasSpot = spotSets[futuresEx].has(symbol);
  const side = funding >= 0
    ? { fut: `📉 Шорт фʼючерс (${futuresEx})`, spot: "📈 Купити спот" }
    : { fut: `📈 Лонг фʼючерс (${futuresEx})`, spot: "📉 Шорт спот" };
  let spotLine;
  if (sameHasSpot) {
    spotLine = `${side.spot} (${futuresEx} — та сама біржа, найпростіше)`;
    if (venues.length) spotLine += `\n   або дешевше на: ${venues.join(", ")}`;
  } else if (venues.length) {
    spotLine = `${side.spot} на: ${venues.join(", ")} (крос-біржово)`;
  } else {
    spotLine = `${side.spot} (спот не знайдено — лише напрям фʼючерса)`;
  }
  return `${side.fut}\n${spotLine}`;
}

// ── Перевірка умов і розсилка ─────────────────────────────────────────
function checkSignals() {
  const now = Date.now();
  for (const ex of CONFIG.EXCHANGES) {
    for (const [symbol, m] of Object.entries(markets[ex])) {
      if (!m || m.funding == null || m.price == null) continue;

      // фільтр: фʼючерс мусить бути; спот — або тут, або (крос-режим) на будь-якій біржі
      if (CONFIG.REQUIRE_SPOT_AND_FUTURES) {
        if (!m.hasFutures) continue;
        const spotHere = m.hasSpot;
        const spotAnywhere = spotVenues(symbol).length > 0;
        if (CONFIG.ALLOW_CROSS_EXCHANGE) { if (!spotAnywhere) continue; }
        else { if (!spotHere) continue; }
      }

      const cross = isCross(symbol, ex);
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
        `🎯 <b>${symbol}</b> на <b>${ex.toUpperCase()}</b>${cross ? " 🔀 крос-біржово" : ""}\n` +
        `💰 Нетто (фандінг − комісії): <b>${net >= 0 ? "+" : ""}${net.toFixed(3)}%</b>\n` +
        (cross ? `🔀 Крос-витрата (окремо): ~${CONFIG.CROSS_EXCHANGE_COST}% · орієнтовно після неї: ${(net - CONFIG.CROSS_EXCHANGE_COST).toFixed(3)}%\n` : "") +
        `📊 Фандінг: ${m.funding >= 0 ? "+" : ""}${m.funding.toFixed(3)}% (кожні ${m.interval}г)\n` +
        `💵 Ціна: $${m.price}\n` +
        `📈 Зміна 24г: ${(m.priceChange24h ?? 0).toFixed(2)}%\n` +
        `🔊 Обсяг: ${fmtUsd(m.volume24h)} · OI: ${fmtUsd(m.oi)}\n` +
        `⏱ Виплата через ~${Math.round(mins)} хв\n\n` +
        `<b>Як торгувати:</b>\n${crossPlan(m.funding, ex, symbol)}`;

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

// ── Веб: JSON-дані + гарний живий дашборд ─────────────────────────────
const app = express();

// API: віддає всі котирування у JSON (сторінка сама їх малює й оновлює)
app.get("/api/data", (_req, res) => {
  const now = Date.now();
  const rows = [];
  for (const ex of CONFIG.EXCHANGES) {
    for (const [sym, m] of Object.entries(markets[ex])) {
      if (m.funding == null || m.price == null) continue;
      const cross = isCross(sym, ex);
      const net = netProfit(m.funding);
      const mins = m.nextFundingTs ? (m.nextFundingTs - now) / 60000 : null;
      rows.push({
        ex, sym,
        funding: m.funding,
        net,
        cross,
        price: m.price,
        priceChange24h: m.priceChange24h ?? null,
        volume24h: m.volume24h ?? null,
        oi: m.oi ?? null,
        interval: m.interval ?? null,
        mins,
        hasSpot: !!m.hasSpot,
        hasFutures: !!m.hasFutures,
        spotVenues: spotVenues(sym),
      });
    }
  }
  res.json({
    ok: true,
    updated: now,
    config: {
      minNet: CONFIG.MIN_NET_PROFIT, maxNet: CONFIG.MAX_NET_PROFIT,
      maxPrice: CONFIG.MAX_PRICE_CHANGE_24H, minVol: CONFIG.MIN_VOLUME_24H,
      minOi: CONFIG.MIN_OI, window: CONFIG.SIGNAL_WINDOW_MIN,
      requireBoth: CONFIG.REQUIRE_SPOT_AND_FUTURES,
      cross: CONFIG.ALLOW_CROSS_EXCHANGE,
      crossCost: CONFIG.CROSS_EXCHANGE_COST,
      feePerSide: CONFIG.FEE_PER_SIDE,
    },
    rows,
  });
});

app.get("/", (_req, res) => res.send(DASHBOARD_HTML));
app.listen(CONFIG.PORT, () => console.log(`🌐 Дашборд на порту ${CONFIG.PORT}`));

// Привітальне повідомлення при старті
if (bot) sendSignal("🚀 FundingHunter запущено! Шукаю можливості фандінгу...");

