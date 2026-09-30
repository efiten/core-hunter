# The server keeps the node registry in memory itself (#591)

**Date:** 2026-09-30
**Status:** the expected behaviour is #591's (Kasper, 2026-09-06), of which this is the server half; decisions 2 to 4 are proposed with the PR. The web half landed with #691
**Related:** #377 (the proxy), #398 (an empty registry), #418 (the CoreScope shape), #604 (the reach through an outage)

## What changed

`/api/nodes/positions` served a registry it fetched on a member's request: whenever the cache was cold, and behind the request once it was older than ten minutes. The server now fetches on a loop of its own (`NodesAPI.Run`, started in `main.go`): once at boot, then every ten minutes. A request reads what the loop stored and never reaches an upstream.

## Why

A cold cache is the state after every restart. The first member request then carried the whole fetch, 1.7 MB from the nameresolver plus CoreScope's pages, with 30 s of client timeout per page. A reverse proxy with less patience answers 504 for that, and the layer read it as an unreachable registry. While the upstreams failed the cache stayed cold, so every request re-ran the fetch and failed the same way. The fetch error itself was dropped, so afterwards the log could not say that a fetch had failed, nor for which URL.

## The decisions

1. **A request never fetches.** Before the first fetch has landed the answer is `503 registry_unavailable`, at once. The web layer shows that for 3 s (#691).
2. **`stale` means the last refresh gave no registry.** It used to be true as well while a refresh was running, which with a timer would mark every answer stale for a moment every ten minutes. A refresh in flight now serves the registry in memory unmarked.
3. **A refresh that gives no registry is retried after 30 s** (`defaultNodeRetry`), not after the full interval. When the fetch at boot fails there is nothing in memory, and the layer would be without positions for ten minutes after an upstream that was down for a moment. That holds for an empty answer too: `registry_empty` stays the answer until an upstream returns nodes.
4. **Every failed page is one log line with its URL and the error**, the HTTP status included: `node registry: <url>: status 404`. Also a later page of a paged upstream, where the registry is kept and is short. An upstream that keeps failing while another answers logs once per refresh, 144 lines a day, which is the signal to fix the config. With every upstream down it is one line per upstream every 30 s.

## What it costs

The registry is fetched whether or not anyone has the layer on: about 3 MB per refresh before compression over the two upstreams measured in #591, 144 times a day. Before, an idle server fetched nothing.

## Left out

- The deployed `nodePositionUpstreams`: #591 measured a 404 on an SF8 positions route. With this change the log names it on the first refresh. The config itself is on the deploy host.
