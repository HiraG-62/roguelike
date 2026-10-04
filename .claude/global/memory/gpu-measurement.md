---
name: gpu-measurement
description: 描画の重さの計測は GPU で行う（headless の既定は SwiftShader の CPU 描画で実機と違う）
metadata:
  node_type: memory
  type: feedback
  originSessionId: eab2b14c-eadb-409d-89aa-bf12d36b16da
  modified: 2026-10-02T13:02:50.018Z
---

描画の ms・固まりの計測は GPU を使って測る（2026-10-02 ユーザーの指示）。Playwright の headless は既定で SwiftShader（CPU 描画）になるので、`--enable-gpu --use-angle=d3d11 --ignore-gpu-blocklist` を付けて起動する。この PC は RTX 4070 SUPER（D3D11）で、付ければ headless のままウィンドウ無しで GPU が使える（確認済み）。

**Why:** CPU 描画の値（例: 予告の描き込み 4.5ms）は実機と違い、重さの判断を誤る。

**How to apply:** `scripts/hitch-probe.mjs` と `scripts/map-shot.mjs` は `GPU_ARGS` で起動する（map-shot はブランチ `feat/ink-reading` で追加）。新しく Playwright で測る道具やエージェントへの指示でも同じ起動オプションを使い、報告には GPU で測ったかを書く。WebGL の `UNMASKED_RENDERER_WEBGL` で確かめられる。
