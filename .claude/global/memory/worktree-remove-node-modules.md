---
name: worktree-remove-node-modules
description: .claude/worktrees のエージェント worktree を git worktree remove -f で消すと本体の node_modules が空になった（2026-10-03）
metadata:
  node_type: memory
  type: project
  originSessionId: c586e47c-368a-4c57-bbc0-f9eb1c8c07bf
  modified: 2026-10-02T18:08:48.281Z
---

2026-10-03、`.claude/worktrees/agent-*` を `git worktree remove -f -f` で 16 個消した直後に、本体 `E:\dev\roguelike\node_modules` が空になった。worktree 側の node_modules が本体へのジャンクションで、削除がリンク先まで辿った可能性が高い（未検証）。`npm ci` で復旧。

**Why:** 気付かないと次の `npm run check` が tsc の段で「Cannot find module typescript」で落ちる。
**How to apply:** worktree を消す前に中の node_modules がジャンクションか確かめ、ジャンクションなら先に外す（`cmd /c rmdir`）。消した後は `ls node_modules | wc -l` で中身があるか確かめる。
