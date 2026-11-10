// Local test of the news cycle with an in-memory store (real fetches).
import { runNewsCycle } from "../lib/news-engine.mjs";
import { STOCKS } from "../lib/stocks-engine.mjs";

const store = { m: new Map(), get: async (k) => (store.m.has(k) ? store.m.get(k) : null), set: async (k, v) => store.m.set(k, v) };
const v = await runNewsCycle(store, STOCKS);
console.log("as_of:", v.as_of, "| market:", v.market.length, "| india:", v.india.length, "| symbol feeds ok:", v.sources.symbols.n_ok + "/" + STOCKS.length, "| earnings:", v.earnings_upcoming.length);
console.log("sample market headline:", JSON.stringify(v.market[0]));
console.log("sample tags market:", v.market.slice(0, 5).map((x) => x.tags.join(",")).join(" | "));
const aapl = v.per_symbol.AAPL;
console.log("AAPL:", JSON.stringify({ n: aapl.n, tags: aapl.tags, heavy: aapl.heavy, earnings: aapl.earnings, first: aapl.items[0]?.t?.slice(0, 70) }));
const heavy = STOCKS.filter((s) => v.per_symbol[s]?.heavy);
console.log("heavy news stocks:", heavy.slice(0, 8));
console.log("earnings upcoming:", JSON.stringify(v.earnings_upcoming.slice(0, 5)));
const withNews = STOCKS.filter((s) => (v.per_symbol[s]?.n || 0) > 0).length;
console.log("stocks with headlines:", withNews);
console.log(v.market.length > 3 && v.sources.symbols.n_ok > 30 ? "NEWS_ENGINE_OK" : "NEWS_ENGINE_WEAK");
