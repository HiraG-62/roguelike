/**
 * 技（skills/arts/）の key。依存を持たない（skills/types.ts の SKILL_KEYS がここを取り込むため）。
 * 武器技の key は `<武器種の key><名前>`（skills/arts/arts.test.ts が武器種ごとに 10 種以上・接頭辞を検査する）。
 * 足すときは配列の末尾へ（既存の順は抽選の並びに効く）。一覧と狙いは docs/ideas/weapon-skills.md
 */

/** 共通技（どの武器種でも撃てる） */
export const COMMON_ART_KEYS = [
  "commonShockwave",
  "commonBackstep",
  "commonBlink",
  "commonWarCry",
  "commonFirstAid",
  "commonMeditate",
  "commonFireball",
  "commonIceLance",
  "commonThunderclap",
  "commonPoisonMist",
  "commonShadowBolt",
  "commonHolyNova",
  "commonChainSpark",
  "commonMagnet",
  "commonSmokeBomb",
  "commonKnifeFan",
  "commonMeteor",
  "commonQuickstep",
  "commonIronSkin",
  "commonExecution",
  "commonBarrage",
  "commonGroundSpike",
  "commonFrostNova",
  "commonBloodSurge",
] as const;

/** 武器技（武器種ごと。その武器種を装備しているときだけ撃てる） */
export const WEAPON_ART_KEYS = {
  sword: [
    "swordCrossCut",
    "swordRisingSlash",
    "swordFlashStep",
    "swordWhirlwind",
    "swordSonicEdge",
    "swordRiposte",
    "swordTripleThrust",
    "swordHeavenSplit",
    "swordBladeStorm",
    "swordValor",
    "swordFinisher",
  ],
  // @art-keys:greatsword
  // @art-keys:twinBlades
  // @art-keys:spear
  // @art-keys:scythe
  // @art-keys:fists
  // @art-keys:whip
  // @art-keys:cleaver
  // @art-keys:staff
  // @art-keys:wand
  // @art-keys:katana
  // @art-keys:axe
  // @art-keys:shield
  // @art-keys:chainSickle
  // @art-keys:hammer
  // @art-keys:gunner
  // @art-keys:sidearm
  // @art-keys:longarm
  // @art-keys:cannon
  // @art-keys:thrown
  // @art-keys:grenade
  // @art-keys:trapper
  // @art-keys:warRing
  // @art-keys:claws
  // @art-keys:flail
  // @art-keys:ringBlades
  // @art-keys:fan
} as const;

type WeaponArtTable = typeof WEAPON_ART_KEYS;
export type WeaponArtMoveset = keyof WeaponArtTable;
export type WeaponArtKey = WeaponArtTable[WeaponArtMoveset][number];
export type CommonArtKey = (typeof COMMON_ART_KEYS)[number];

/** 武器技の武器種の並び（MOVESET_KEYS と同じ順。arts.test.ts が一致を検査する） */
export const WEAPON_ART_MOVESETS = Object.keys(WEAPON_ART_KEYS) as WeaponArtMoveset[];

export const ART_SKILL_KEYS = [...COMMON_ART_KEYS, ...WEAPON_ART_MOVESETS.flatMap((m) => WEAPON_ART_KEYS[m])] as readonly (CommonArtKey | WeaponArtKey)[];
export type ArtSkillKey = CommonArtKey | WeaponArtKey;
