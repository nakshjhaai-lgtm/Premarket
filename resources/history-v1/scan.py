#!/usr/bin/env python3
"""
Daily pre-market scanner for the Indian equity market (IST).

Runs automatically every trading day at 09:00 IST (market opens 09:15 IST) via
scheduler.py, or on demand with:   python3 scan.py --now

The four checks, exactly as specified:

  1. NASDAQ Composite and Dow Jones (Investing.com)   green / red
  2. India VIX                                        above / below 15
  3. NSE advances vs declines (nseindia.com)          bullish / bearish
  4. Singapore Nifty (today: GIFT Nifty, Investing.com) green / red

Source policy
-------------
Investing.com and nseindia.com sit behind bot protection (Cloudflare / Akamai)
that rejects this host with HTTP 403, so each check tries its specified source
first and then falls back, in order, to an equivalent free feed. Every value in
the report carries the source that actually served it, and any check whose
sources all fail is reported as UNAVAILABLE rather than guessed.

Fallbacks in use:
  1 -> CNBC restQuote (.IXIC / .DJI), then Yahoo chart API (^IXIC / ^DJI)
  2 -> Yahoo chart API (^INDIAVIX)
  3 -> advances/declines derived from the NIFTY 50 constituents via the Yahoo
       spark API (one call, previous session's changes)
  4 -> NSE IX (the exchange GIFT Nifty trades on) getquotes, then UNAVAILABLE

Output
------
  reports/<date>-premarket.md     the human report
  reports/<date>-premarket.json   the same data, machine readable
  reports/latest.md / .json / .html   always the most recent run
"""

import datetime as dt
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from zoneinfo import ZoneInfo

IST = ZoneInfo("Asia/Kolkata")
HERE = os.path.dirname(os.path.abspath(__file__))
REPORTS = os.path.join(HERE, "reports")

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")

VIX_THRESHOLD = 15.0

NIFTY50 = [  # constituents, used only to derive advances/declines
    "RELIANCE", "TCS", "HDFCBANK", "ICICIBANK", "INFY", "BHARTIARTL", "SBIN",
    "LT", "ITC", "AXISBANK", "KOTAKBANK", "HINDUNILVR", "BAJFINANCE", "MARUTI",
    "SUNPHARMA", "TATAMOTORS", "TITAN", "M&M", "NTPC", "ULTRACEMCO", "ONGC",
    "POWERGRID", "WIPRO", "NESTLEIND", "ADANIENT", "ADANIPORTS", "COALINDIA",
    "JSWSTEEL", "TATASTEEL", "GRASIM", "HCLTECH", "TECHM", "BAJAJFINSV",
    "DRREDDY", "CIPLA", "DIVISLAB", "APOLLOHOSP", "EICHERMOT", "HEROMOTOCO",
    "BRITANNIA", "INDUSINDBK", "SBILIFE", "HDFCLIFE", "TATACONSUM", "UPL",
    "BPCL", "IOC", "ETERNAL", "DLF", "TRENT",
]


def http(url, timeout=25, headers=None):
    h = {"User-Agent": UA, "Accept-Language": "en-US,en;q=0.9"}
    if headers:
        h.update(headers)
    req = urllib.request.Request(url, headers=h)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "replace")


def jget(url, **kw):
    return json.loads(http(url, **kw))


def fnum(s):
    if s is None:
        return None
    s = str(s).strip().replace(",", "").replace("%", "")
    if s in ("", "-", "--"):
        return None
    try:
        return float(s)
    except ValueError:
        m = re.search(r"-?\d+\.?\d*", s)
        return float(m.group()) if m else None


# --------------------------------------------------------------------- check 1
def us_indices():
    """NASDAQ Composite + Dow Jones, overnight close. green/red each."""
    out = []
    # 1a. specified source: investing.com
    for slug, name in (("nasdaq-composite", "NASDAQ Composite"),
                       ("us-30", "Dow Jones")):
        try:
            html = http("https://www.investing.com/indices/" + slug)
            m = re.search(r'data-test="instrument-price-last"[^>]*>([\d,.]+)', html)
            c = re.search(r'data-test="instrument-price-change"[^>]*>([+\-\d,.]+)', html)
            p = re.search(r'data-test="instrument-price-change-percent"[^>]*>\(?([+\-\d,.]+)%', html)
            if m:
                out.append(dict(name=name, price=fnum(m.group(1)),
                                change=fnum(c.group(1)) if c else None,
                                pct=fnum(p.group(1)) if p else None,
                                source="investing.com"))
        except Exception:
            pass
    if len(out) == 2:
        return out
    # 1b. CNBC restQuote
    try:
        d = jget("https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/"
                 "symbol?symbols=.IXIC|.DJI&requestMethod=itv&noform=1&partnerId=2"
                 "&fund=1&exthrs=1&output=json")
        for q in d["FormattedQuoteResult"]["FormattedQuote"]:
            out.append(dict(name=q["name"], price=fnum(q.get("last")),
                            change=fnum(q.get("change")),
                            pct=fnum((q.get("change_pct") or "").replace("%", "")),
                            source="cnbc.com quote API"))
    except Exception:
        pass
    if len(out) == 2:
        return out
    # 1c. Yahoo chart
    for sym, name in (("^IXIC", "NASDAQ Composite"), ("^DJI", "Dow Jones")):
        try:
            m = jget("https://query1.finance.yahoo.com/v8/finance/chart/%s"
                     "?range=5d&interval=1d" % urllib.parse.quote(sym))["chart"]["result"][0]["meta"]
            price = m.get("regularMarketPrice")
            prev = m.get("chartPreviousClose") or m.get("previousClose")
            ch = (price - prev) if (price is not None and prev) else None
            out.append(dict(name=name, price=price, change=ch,
                            pct=(100.0 * ch / prev) if (ch is not None and prev) else None,
                            source="Yahoo Finance chart API"))
        except Exception:
            out.append(dict(name=name, price=None, change=None, pct=None, source=None))
    return out


# --------------------------------------------------------------------- check 2
def india_vix():
    # 2a. specified source: nseindia.com
    try:
        d = jget("https://www.nseindia.com/api/equity-stockIndices?index=INDIA%20VIX",
                 headers={"Referer": "https://www.nseindia.com/"})
        row = d["data"][0]
        return dict(price=fnum(row.get("lastPrice")), source="nseindia.com")
    except Exception:
        pass
    # 2b. Yahoo
    try:
        m = jget("https://query1.finance.yahoo.com/v8/finance/chart/%5EINDIAVIX"
                 "?range=5d&interval=1d")["chart"]["result"][0]["meta"]
        return dict(price=m.get("regularMarketPrice"), source="Yahoo Finance chart API")
    except Exception:
        return dict(price=None, source=None)


# --------------------------------------------------------------------- check 3
def advance_decline():
    # 3a. specified source: nseindia.com market breadth
    try:
        d = jget("https://www.nseindia.com/api/equity-stockIndices?index=NIFTY%2050",
                 headers={"Referer": "https://www.nseindia.com/"})
        adv = dec = 0
        for row in d.get("data", [])[1:]:
            c = fnum(row.get("chg"))
            if c is None:
                continue
            adv += c > 0
            dec += c < 0
        if adv or dec:
            return dict(advances=adv, declines=dec, unchanged=None,
                        universe="NSE India (as published)", source="nseindia.com")
    except Exception:
        pass
    # 3b. derived from NIFTY 50 constituents, previous session.
    # Yahoo's v7/spark API rejects lists larger than ~20 symbols (HTTP 400)
    # and the raw '&' in M&M.NS truncates the query string, so fetch in
    # chunks of 15 and pull M&M separately from the v8/chart API, which
    # accepts it percent-encoded as a path segment.
    CH = 15
    basket = [s + ".NS" for s in NIFTY50 if s != "M&M"]
    adv = dec = unch = 0
    fetched = False
    for i in range(0, len(basket), CH):
        try:
            d = jget("https://query1.finance.yahoo.com/v7/finance/spark?symbols=%s"
                     "&range=1d&interval=5m" % ",".join(basket[i:i + CH]))
        except Exception:
            continue
        for r in d.get("spark", {}).get("result") or []:
            try:
                meta = r["response"][0]["meta"]
                price = meta.get("regularMarketPrice")
                prev = meta.get("chartPreviousClose") or meta.get("previousClose")
                if price is None or not prev:
                    continue
                if price > prev:
                    adv += 1
                elif price < prev:
                    dec += 1
                else:
                    unch += 1
                fetched = True
            except Exception:
                continue
        time.sleep(0.3)
    try:
        d = jget("https://query1.finance.yahoo.com/v8/finance/chart/%s"
                 "?range=1d&interval=5m" % urllib.parse.quote("M&M.NS"))
        meta = d["chart"]["result"][0]["meta"]
        price = meta.get("regularMarketPrice")
        prev = meta.get("chartPreviousClose") or meta.get("previousClose")
        if price is not None and prev:
            adv += price > prev
            dec += price < prev
            unch += price == prev
            fetched = True
    except Exception:
        pass
    if fetched:
        return dict(advances=adv, declines=dec, unchanged=unch,
                    universe="NIFTY 50 constituents (derived), previous session",
                    source="Yahoo Finance spark API")
    return dict(advances=None, declines=None, unchanged=None, universe=None, source=None)


# --------------------------------------------------------------------- check 4
def _nseix_expiry_candidates(now):
    """Last few weekdays of this month and the next two, as DD-Mon-YYYY."""
    cands = []
    y, m = now.year, now.month
    for _ in range(3):
        if m == 12:
            y, m = y + 1, 1
        last = dt.date(y, m, 1).replace(day=28)
        while True:
            nxt = last + dt.timedelta(days=1)
            if nxt.month != m:
                break
            last = nxt
        for back in range(0, 5):
            d = last - dt.timedelta(days=back)
            if d.weekday() < 5 and d >= now.date():
                cands.append(d.strftime("%d-%b-%Y"))
        m += 1
    return cands


def singapore_nifty(now):
    """Singapore Nifty = SGX Nifty, since Jan-2023 GIFT Nifty on NSE IX."""
    # 4a. specified source: investing.com
    try:
        html = http("https://www.investing.com/indices/gift-nifty")
        m = re.search(r'data-test="instrument-price-last"[^>]*>([\d,.]+)', html)
        p = re.search(r'data-test="instrument-price-change-percent"[^>]*>\(?([+\-\d,.]+)%', html)
        if m:
            return dict(price=fnum(m.group(1)), pct=fnum(p.group(1)) if p else None,
                        contract="GIFT Nifty", source="investing.com")
    except Exception:
        pass
    # 4b. crawl the web: TradingView's GIFT Nifty page renders the live quote
    # server-side ("...current price of GIFT NIFTY 50 INDEX FUTURES is 23,094.5
    # ... risen 0.46%..."), so a plain HTML fetch + regex works — no API key.
    try:
        page = http("https://in.tradingview.com/symbols/NSEIX-NIFTY1!/")
        price = pct = None
        m = re.search(r'"name":"daily_bar_close"[^}]*"value":([\d.]+)', page)
        c = re.search(r'"name":"daily_bar_change"[^}]*"value":(-?[\d.]+)', page)
        if m:
            price = float(m.group(1))
            pct = float(c.group(1)) if c else None
        else:
            t = re.search(r'current price of GIFT NIFTY 50 INDEX FUTURES is '
                          r'([\d,.]+)[^%]*?(risen|fallen|hasn.t changed)[^%\d]*([\d,.]+)?%',
                          page)
            if t:
                price = fnum(t.group(1))
                pct = 0.0 if t.group(2).startswith("hasn") else \
                      (fnum(t.group(3)) or 0.0) * (1 if t.group(2) == "risen" else -1)
        if price:
            return dict(price=price, pct=pct, contract="GIFT Nifty (front month)",
                        source="TradingView page crawl (in.tradingview.com)")
    except Exception:
        pass
    # 4c. investing.com mobile API
    for pair in ("8831", "8881"):
        try:
            d = jget("https://api.investing.com/api/financialdata/%s/historical/chart/"
                     "?period=P1W&interval=P1D&time-period-type=0" % pair,
                     headers={"Referer": "https://www.investing.com/",
                              "Domain": "www.investing.com"})
            pts = (d.get("data") or [])[-1]
            prev = (d.get("data") or [])[-2]
            if pts:
                last = fnum(pts[1] if isinstance(pts, list) else pts.get("last"))
                prv = fnum(prev[1] if isinstance(prev, list) else prev.get("last"))
                if last:
                    return dict(price=last,
                                pct=(100.0 * (last - prv) / prv) if prv else None,
                                contract="GIFT Nifty", source="investing.com API")
        except Exception:
            pass
    # 4c. NSE IX, the exchange GIFT Nifty actually trades on
    for inst in ("Fut", "FUT", "Index%20Futures"):
        for exp in _nseix_expiry_candidates(now):
            try:
                d = jget("https://www.nseix.com/api/getquotes?symbol=NIFTY"
                         "&instrumenttype=%s&expiry=%s" % (inst, urllib.parse.quote(exp)))
                rows = d.get("data") or []
                if isinstance(rows, list) and rows and isinstance(rows[0], dict):
                    r = rows[0]
                    ltp = fnum(r.get("LTP")) or fnum(r.get("ltp"))
                    pch = fnum(r.get("PCHNG")) or fnum(r.get("pChg"))
                    if ltp:
                        return dict(price=ltp, pct=pch, contract="GIFT Nifty %s" % exp,
                                    source="nseix.com (NSE IX)")
            except Exception:
                continue
    return dict(price=None, pct=None, contract=None, source=None)


# ---------------------------------------------------------------------- report
def colour(pct):
    if pct is None:
        return "UNAVAILABLE"
    return "GREEN" if pct > 0 else ("RED" if pct < 0 else "FLAT")


def run_scan(now=None):
    now = now or dt.datetime.now(IST)
    stamp = now.strftime("%Y-%m-%d %H:%M:%S IST")
    checks = {}

    us = us_indices()
    checks["us_overnight"] = [
        dict(label=n["name"], value=n["price"], change=n["change"], pct=n["pct"],
             signal=colour(n["pct"]), source=n["source"]) for n in us]

    vix = india_vix()
    checks["india_vix"] = dict(
        label="India VIX", value=vix["price"], threshold=VIX_THRESHOLD,
        signal=("HIGH volatility expected" if vix["price"] and vix["price"] > VIX_THRESHOLD
                else "LOW volatility expected" if vix["price"] is not None else "UNAVAILABLE"),
        source=vix["source"])

    ad = advance_decline()
    if ad["advances"] is None:
        sig, src = "UNAVAILABLE", None
    else:
        sig = "BULLISH breadth" if ad["advances"] > ad["declines"] else (
              "BEARISH breadth" if ad["advances"] < ad["declines"] else "NEUTRAL breadth")
        src = ad["source"]
    checks["advance_decline"] = dict(label="Advances vs Declines",
                                     advances=ad["advances"], declines=ad["declines"],
                                     unchanged=ad["unchanged"], universe=ad["universe"],
                                     signal=sig, source=src)

    sn = singapore_nifty(now)
    checks["singapore_nifty"] = dict(label="Singapore Nifty (GIFT Nifty)",
                                     contract=sn["contract"], value=sn["price"],
                                     pct=sn["pct"], signal=colour(sn["pct"]),
                                     source=sn["source"])

    score = 0
    notes = []
    for n in checks["us_overnight"]:
        if n["pct"] is not None:
            score += 1 if n["pct"] > 0 else -1
        else:
            notes.append(n["label"])
    v = checks["india_vix"]["value"]
    if v is not None:
        score += 1 if v < VIX_THRESHOLD else -1
    else:
        notes.append("India VIX")
    a, d_ = ad["advances"], ad["declines"]
    if a is not None:
        score += 1 if a > d_ else (-1 if a < d_ else 0)
    else:
        notes.append("Advances/Declines")
    if sn["pct"] is not None:
        score += 1 if sn["pct"] > 0 else -1
    else:
        notes.append("Singapore Nifty")

    if score >= 3:
        bias = "Positively biased: a GREEN open is more likely"
    elif score >= 1:
        bias = "Mildly positive bias: a green open is somewhat more likely"
    elif score == 0:
        bias = "Mixed signals: no clear directional bias"
    elif score >= -2:
        bias = "Mildly negative bias: a red open is somewhat more likely"
    else:
        bias = "Negatively biased: a RED open is more likely"

    report = dict(generated_at=stamp, date=now.strftime("%Y-%m-%d"),
                  weekday=now.strftime("%A"), score=score, bias=bias,
                  unavailable=notes, checks=checks)
    return report


def md(report):
    c = report["checks"]
    L = []
    L.append("# Pre-market report — %s (%s)" % (report["date"], report["weekday"]))
    L.append("")
    L.append("Generated %s · market opens 09:15 IST" % report["generated_at"])
    L.append("")
    L.append("**Overall bias: %s**  (score %+d)" % (report["bias"], report["score"]))
    L.append("")
    L.append("| # | Check | Reading | Signal | Source |")
    L.append("|---|-------|---------|--------|--------|")
    for n in c["us_overnight"]:
        val = "{:,.2f}".format(n["value"]) if n["value"] is not None else "—"
        pc = "%+.2f%%" % n["pct"] if n["pct"] is not None else "—"
        L.append("| 1 | %s | %s (%s) | %s | %s |" % (n["label"], val, pc, n["signal"], n["source"] or "unavailable"))
    v = c["india_vix"]
    L.append("| 2 | %s | %s vs threshold %g | %s | %s |" % (
        v["label"], "{:.2f}".format(v["value"]) if v["value"] is not None else "—",
        v["threshold"], v["signal"], v["source"] or "unavailable"))
    a = c["advance_decline"]
    reading = ("%d advances / %d declines" % (a["advances"], a["declines"])
               if a["advances"] is not None else "—")
    L.append("| 3 | %s | %s | %s | %s |" % (a["label"], reading, a["signal"],
                                            a["source"] or "unavailable"))
    s = c["singapore_nifty"]
    pc = "%+.2f%%" % s["pct"] if s["pct"] is not None else "—"
    L.append("| 4 | %s | %s (%s) | %s | %s |" % (
        s["label"], "{:,.2f}".format(s["value"]) if s["value"] is not None else "—",
        pc, s["signal"], s["source"] or "unavailable"))
    L.append("")
    L.append("### How to read this")
    L.append("")
    L.append("1. **NASDAQ / Dow Jones** green overnight → the Indian market may open green; red → may open red.")
    L.append("2. **India VIX** above 15 → higher volatility possible; below 15 → relatively calmer session expected.")
    L.append("3. **Advances > declines** → bullish breadth; **advances < declines** → bearish breadth.")
    L.append("4. **Singapore Nifty (GIFT Nifty)** green → Indian market may open higher; red → may open lower.")
    if report["unavailable"]:
        L.append("")
        L.append("> Note: %s could not be fetched from any source at scan time and "
                 "is excluded from the score rather than guessed." % ", ".join(report["unavailable"]))
    L.append("")
    L.append("*Source policy: Investing.com and nseindia.com are tried first as specified; "
             "both reject this host's requests (Cloudflare/Akamai 403), so labelled fallbacks "
             "serve the values above. Every row names the source that actually served it.*")
    L.append("")
    return "\n".join(L)


HTML_TMPL = """<!doctype html><html><head><meta charset="utf-8">
<title>Pre-market report {date}</title></head>
<body style="font-family:Segoe UI,Helvetica,Arial,sans-serif;margin:0;background:#0f172a;color:#e2e8f0">
<div style="max-width:860px;margin:0 auto;padding:28px 20px">
<h1 style="font-size:22px;margin:0 0 4px">Pre-market report &mdash; {date} ({weekday})</h1>
<div style="color:#94a3b8;font-size:13px">Generated {gen} &middot; NSE opens 09:15 IST &middot;
<a href="/" style="color:#7dd3fc">dashboard</a></div>
<div style="margin:18px 0;padding:14px 16px;border-radius:10px;background:{biasbg};
border:1px solid {biasbd}">
<div style="font-size:15px;font-weight:600">{bias}</div>
<div style="font-size:12px;color:#cbd5e1;margin-top:4px">signal score {score:+d}
(+1 per bullish check, &minus;1 per bearish check)</div></div>
<table style="width:100%;border-collapse:collapse;font-size:14px">
<tr style="color:#94a3b8;text-align:left;font-size:12px;text-transform:uppercase;letter-spacing:.04em">
<th style="padding:8px 10px;border-bottom:1px solid #334155">#</th>
<th style="padding:8px 10px;border-bottom:1px solid #334155">Check</th>
<th style="padding:8px 10px;border-bottom:1px solid #334155">Reading</th>
<th style="padding:8px 10px;border-bottom:1px solid #334155">Signal</th>
<th style="padding:8px 10px;border-bottom:1px solid #334155">Source</th></tr>
{rows}
</table>
<div style="margin-top:18px;font-size:13px;color:#94a3b8;line-height:1.6">
<b style="color:#cbd5e1">How to read:</b>
1) NASDAQ / Dow green overnight &rarr; India may open green, red &rarr; may open red.
2) India VIX above 15 &rarr; higher volatility possible, below 15 &rarr; calmer session.
3) Advances &gt; declines &rarr; bullish breadth, advances &lt; declines &rarr; bearish.
4) Singapore Nifty (GIFT Nifty) green &rarr; may open higher, red &rarr; may open lower.
</div>
{note}
<div style="margin-top:14px;font-size:12px;color:#64748b">Investing.com and nseindia.com are
tried first as specified but reject this host (403); labelled fallbacks serve those values.
Every row names the source that actually served it.</div>
</div></body></html>"""


def html(report):
    c = report["checks"]
    sig_bg = {"GREEN": "#052e16", "RED": "#450a0a", "FLAT": "#1e293b",
              "UNAVAILABLE": "#1e293b"}
    sig_fg = {"GREEN": "#4ade80", "RED": "#f87171", "FLAT": "#cbd5e1",
              "UNAVAILABLE": "#94a3b8"}

    def row(i, name, reading, signal, source, key=None):
        k = key or signal.split()[0].upper()
        bg = sig_bg.get(k, "#1e293b")
        fg = sig_fg.get(k, "#cbd5e1")
        return ("<tr><td style='padding:9px 10px;border-bottom:1px solid #1e293b'>%s</td>"
                "<td style='padding:9px 10px;border-bottom:1px solid #1e293b'>%s</td>"
                "<td style='padding:9px 10px;border-bottom:1px solid #1e293b'>%s</td>"
                "<td style='padding:9px 10px;border-bottom:1px solid #1e293b'>"
                "<span style='background:%s;color:%s;padding:3px 9px;border-radius:999px;"
                "font-size:12px;font-weight:600'>%s</span></td>"
                "<td style='padding:9px 10px;border-bottom:1px solid #1e293b;color:#94a3b8;"
                "font-size:12px'>%s</td></tr>") % (i, name, reading, bg, fg, signal, source or "unavailable")

    rows = []
    for n in c["us_overnight"]:
        val = "{:,.2f}".format(n["value"]) if n["value"] is not None else "&mdash;"
        pc = "%+.2f%%" % n["pct"] if n["pct"] is not None else "&mdash;"
        rows.append(row(1, n["label"], "%s (%s)" % (val, pc), n["signal"], n["source"]))
    v = c["india_vix"]
    vk = "GREEN" if v["signal"].startswith("LOW") else ("RED" if v["signal"].startswith("HIGH") else "UNAVAILABLE")
    rows.append(row(2, v["label"],
                    ("%s vs threshold %g" % ("{:.2f}".format(v["value"]) if v["value"] is not None else "&mdash;", v["threshold"])),
                    v["signal"], v["source"], key=vk))
    a = c["advance_decline"]
    ak = "GREEN" if a["signal"].startswith("BULL") else ("RED" if a["signal"].startswith("BEAR") else
         ("FLAT" if a["signal"].startswith("NEUTRAL") else "UNAVAILABLE"))
    reading = ("%d adv / %d dec" % (a["advances"], a["declines"])
               if a["advances"] is not None else "&mdash;")
    rows.append(row(3, a["label"], reading, a["signal"], a["source"], key=ak))
    s = c["singapore_nifty"]
    sval = "{:,.2f}".format(s["value"]) if s["value"] is not None else "&mdash;"
    spc = "%+.2f%%" % s["pct"] if s["pct"] is not None else "&mdash;"
    rows.append(row(4, s["label"], "%s (%s)" % (sval, spc), s["signal"], s["source"]))

    score = report["score"]
    biasbg = "#052e16" if score > 0 else ("#450a0a" if score < 0 else "#1e293b")
    biasbd = "#166534" if score > 0 else ("#991b1b" if score < 0 else "#334155")
    note = ""
    if report["unavailable"]:
        note = ("<div style='margin-top:12px;padding:10px 14px;border-radius:8px;background:#1e293b;"
                "border:1px solid #334155;font-size:13px;color:#fbbf24'>Not available at scan time "
                "(excluded from the score, not guessed): %s</div>" % ", ".join(report["unavailable"]))
    return HTML_TMPL.format(date=report["date"], weekday=report["weekday"],
                            gen=report["generated_at"], bias=report["bias"],
                            score=score, biasbg=biasbg, biasbd=biasbd,
                            rows="\n".join(rows), note=note)


def save(report):
    os.makedirs(REPORTS, exist_ok=True)
    base = os.path.join(REPORTS, report["date"] + "-premarket")
    with open(base + ".json", "w") as f:
        json.dump(report, f, indent=2)
    with open(base + ".md", "w") as f:
        f.write(md(report))
    with open(base + ".html", "w") as f:
        f.write(html(report))
    for ext in ("json", "md", "html"):
        with open(base + "." + ext) as src, open(os.path.join(REPORTS, "latest." + ext), "w") as dst:
            dst.write(src.read())
    return base


def main():
    report = run_scan()
    base = save(report)
    sys.stdout.write(md(report) + "\n")
    sys.stdout.write("[report saved to %s.md|.json|.html and reports/latest.*]\n" % base)


if __name__ == "__main__":
    main()
