# C5iSR Signal Lab

An open, **paper-trading-only** research lab for testing trading ideas with discipline, built by C5iSR LLC and shared free as a Saturday resource.

> **Not financial advice. No live-money trading code lives in this repo, and none ever will.** Use it to learn and to test ideas on paper.

## The Three Laws (every idea passes these first)
1. **Don't get scammed.** Read the code you run. No "cracked Premium" downloads, ever. They are a known malware lure that steals passwords and crypto wallets.
2. **Don't get liquidated.** Hard risk caps: no more than 2% of the account at risk on any one position, 6% total.
3. **Don't run out of money.** Paper first. Prove an idea against plain buy-and-hold before it earns anything more.

## What works today
- **Free market data, no login, no API key.** TradingView's public scanner returns quotes, % change, RSI and TradingView's technical rating for up to 100 symbols at a time.

```bash
git clone https://github.com/adamljohns/c5isr-signal-lab-public.git
cd c5isr-signal-lab-public
node src/smoke-scan.mjs      # Node 22+; no npm install, zero dependencies
```

Edit the `symbols` list in `src/smoke-scan.mjs` (exchange-qualified, e.g. `NASDAQ:AAPL`, `AMEX:SPY`).

## On the roadmap
- Our own backtester on official market data, with TradingView's Strategy Tester as a cross-check (results that disagree get flagged).
- An AI strategy writer that also argues against its own idea: out-of-sample tests, fees and slippage, overfitting.
- The Three Laws risk gate in code, ahead of any paper ticket.
- A journal that grades every signal against simply holding the S&P 500.

## Credit
The market-data and safety modules in `vendor/tradingview-unified-mcp/` come from [TradingView Unified MCP](https://github.com/daviddme/TradingView-Unified-MCP) (MIT). We read the code line by line before using it: it talks only to TradingView and your own machine, and has no dependencies. Not affiliated with or endorsed by TradingView. It uses TradingView's public, undocumented endpoints, which may change.

> "Be diligent to know the state of your flocks, and attend to your herds; for riches are not forever."
> — Proverbs 27:23–24 (NKJV)
