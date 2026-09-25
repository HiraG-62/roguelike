import { kw } from "../core/keywords";
import { WAVE3_SKILL_TUNING as T } from "./tuning3";
import type { SkillDef, Wave3SkillKey } from "./types";
import { cooldownSkill, manaSkill } from "./resource";

/**
 * スキル第 3 弾: 左右クリックの動作そのものを差し替える変身 5 種（docs/ideas/skills-expansion.md 1-H #56〜#60）。
 * data.ts の SKILL_DEFS に展開する。変身そのものの状態遷移・左右クリックの差し替えは skills/forms.ts、数値は skills/tuning3.ts。
 *
 * 狼化・霊体化・鉄塊化・業火の化身は「自分を強める」変身なので buff を付ける（反響・遅延・当て方の刻印符が付かない）。
 * 砲身化は撃つ変身なので projectile（重撃・遠当てが付く）と、構えの維持を表す channel（溜め・段階溜めが付かない）を付ける
 */

export const WAVE3_SKILL_DEFS: Record<Wave3SkillKey, SkillDef> = {
  wolfForm: {
    key: "wolfForm",
    name: "狼化",
    icon: "狼",
    verb: "しばらく狼になる。攻撃 1 が噛みつき突進（出血）、攻撃 2 が遠吠え（周りの敵が恐怖）。変身中はほかのスキル石を使えない",
    tags: ["form", "buff"],
    keywords: kw(["bleed", "fear", "melee"], [], ["combo"]),
    damageKind: "none",
    axes: ["durationVsPotency", "cooldownVsPotency"],
    ...cooldownSkill(T.wolfForm),
  },
  wraithForm: {
    key: "wraithForm",
    name: "霊体化",
    icon: "幽",
    verb: "しばらく敵と敵弾をすり抜ける（与ダメ x0.3）。解けたとき、すり抜けた敵すべてに出血。変身中はほかのスキル石を使えない",
    tags: ["form", "buff", "defense"],
    keywords: kw(["bleed"], [], ["dash"]),
    damageKind: "none",
    axes: ["durationVsPotency", "cooldownVsPotency"],
    ...cooldownSkill(T.wraithForm),
  },
  siegeForm: {
    key: "siegeForm",
    name: "砲身化",
    icon: "筒",
    verb: "その場で構えて砲撃する（構えた瞬間に 1 発）。構え中は動けず、攻撃 2 が 1 発ごとに気力を払う重い砲撃になる。ダッシュで解ける",
    tags: ["form", "projectile", "channel"],
    keywords: kw(["ranged", "stagger", "still"], [], ["bullet"]),
    damageKind: "ranged",
    axes: ["cooldownVsDamage", "areaVsDamage"],
    ...manaSkill(T.siegeForm),
  },
  ironForm: {
    key: "ironForm",
    name: "鉄塊化",
    icon: "鉄",
    verb: "しばらく鉄の塊になる。被弾しても怯まず振りも止まらない。近接が 1 段の重い振り（大きく怯ませる）になり、少し遅くなる",
    tags: ["form", "buff"],
    keywords: kw(["stagger", "melee"], ["hurt"], ["wall"]),
    damageKind: "none",
    axes: ["durationVsPotency", "cooldownVsPotency"],
    ...cooldownSkill(T.ironForm),
  },
  pyreForm: {
    key: "pyreForm",
    name: "業火の化身",
    icon: "焔",
    verb: "維持している間、近接と射撃が燃焼を付ける（毎秒気力を払う）。気力が尽きると自分が燃えて解ける。もう一度撃つと解ける",
    tags: ["form", "buff", "fire"],
    keywords: kw(["burn"], ["mana"], ["melee", "ranged"]),
    damageKind: "none",
    axes: ["cooldownVsPotency"],
    ...manaSkill(T.pyreForm),
  },
};
