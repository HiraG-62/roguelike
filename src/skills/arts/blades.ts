import { attack } from "../../core/element";
import type { ArtSpec } from "./types";

/**
 * 刃の武器技（剣・大剣・双剣・刀・鉈・爪）。数値は data/balance/skills/ART/<武器種>.json。
 * 武器種の手触り（docs/ideas/weapon-skills.md の各節）を伸ばす方向で作る
 */

const MELEE = attack("melee", "physical");
const RANGED = attack("ranged", "physical");
const AREA = attack("area", "physical");

// ---- 剣: 素直な斬撃・受け流し・十字断ち。何でも一通りこなす ----
const SWORD: readonly ArtSpec[] = [
  {
    key: "swordCrossCut",
    moveset: "sword",
    name: "十字斬り",
    icon: "十",
    verb: "前方を横、続けて縦に斬る",
    tags: ["melee"],
    attack: MELEE,
    acts: [
      { kind: "arc", n: "side" },
      { kind: "line", n: "down" },
    ],
  },
  {
    key: "swordRisingSlash",
    moveset: "sword",
    name: "昇り斬り",
    icon: "昇",
    verb: "下から斬り上げて大きく怯ませ、壁に叩きつける",
    tags: ["melee"],
    attack: MELEE,
    acts: [{ kind: "arc", n: "rise" }],
  },
  {
    key: "swordFlashStep",
    moveset: "sword",
    name: "一閃",
    icon: "閃",
    verb: "照準の方向へ駆け抜け、通り道の敵を斬る。駆ける間は攻撃を受けない",
    tags: ["melee", "movement"],
    attack: MELEE,
    acts: [{ kind: "dash", n: "flash" }],
  },
  {
    key: "swordWhirlwind",
    moveset: "sword",
    name: "円舞斬",
    icon: "円",
    verb: "その場で回って周りの敵を 3 度斬る",
    tags: ["melee", "area"],
    attack: MELEE,
    acts: [{ kind: "ring", n: "spin" }],
  },
  {
    key: "swordSonicEdge",
    moveset: "sword",
    name: "飛燕剣",
    icon: "燕",
    verb: "剣を振って斬撃を飛ばし、並んだ敵を貫く",
    tags: ["projectile"],
    attack: RANGED,
    acts: [{ kind: "shot", n: "wave" }],
  },
  {
    key: "swordRiposte",
    moveset: "sword",
    name: "返し構え",
    icon: "返",
    verb: "一瞬だけ攻撃を受けない構えを取り、すぐに前方を斬り返す",
    tags: ["melee", "defense"],
    attack: MELEE,
    acts: [
      { kind: "buff", n: "guard" },
      { kind: "arc", n: "counter" },
    ],
  },
  {
    key: "swordTripleThrust",
    moveset: "sword",
    name: "三段突き",
    icon: "突",
    verb: "照準の方向へ素早く 3 度突く（突く間も向きを変えられる）",
    tags: ["melee"],
    attack: MELEE,
    acts: [
      { kind: "line", n: "t1" },
      { kind: "line", n: "t2" },
      { kind: "line", n: "t3" },
    ],
  },
  {
    key: "swordHeavenSplit",
    moveset: "sword",
    name: "天割り",
    icon: "天",
    verb: "長く重い振り下ろし。怯んでいる敵には大きく効く",
    tags: ["melee"],
    attack: MELEE,
    acts: [{ kind: "line", n: "split", vs: "stagger" }],
    minDepth: 2,
  },
  {
    key: "swordBladeStorm",
    moveset: "sword",
    name: "剣嵐",
    icon: "嵐",
    verb: "カーソル地点に剣の嵐を起こし、しばらく斬り続ける",
    tags: ["area"],
    attack: AREA,
    acts: [
      { kind: "ring", n: "s1", anchor: "target" },
      { kind: "ring", n: "s2", anchor: "target" },
      { kind: "ring", n: "s3", anchor: "target" },
      { kind: "ring", n: "s4", anchor: "target" },
    ],
    minDepth: 2,
  },
  {
    key: "swordValor",
    moveset: "sword",
    name: "勇心",
    icon: "勇",
    verb: "心を奮わせ、しばらく与ダメが上がり、受けるダメージが減る",
    tags: ["buff"],
    attack: null,
    acts: [{ kind: "buff", n: "valor" }],
  },
  {
    key: "swordFinisher",
    moveset: "sword",
    name: "止め斬り",
    icon: "止",
    verb: "前方を斬り、弱った敵（ボスを除く）を仕留める",
    tags: ["melee"],
    attack: MELEE,
    acts: [{ kind: "arc", n: "end" }],
  },
];

// @art-specs:greatsword
// @art-specs:twinBlades
// @art-specs:katana
// @art-specs:cleaver
// @art-specs:claws

export const BLADE_ART_SPECS: readonly ArtSpec[] = [
  ...SWORD,
  // @art-specs-list:blades
];
