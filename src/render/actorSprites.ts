/**
 * プレイヤーの体と手に持つ武器のスプライト（docs/ideas/player-sprites.md）。生成器 scripts/actor/ が焼いた
 * public/assets/actor/<アトラス>.png を読み、シートの 1 フレームを切り出して描く。色は絵のまま（エフェクトのような配色はしない）。
 * 今のジョブの体と今の武器種のアトラスだけを持つ
 */
import { ACTOR_ATLASES, ACTOR_SHEETS, type ActorAtlasKey, type ActorSheetDef } from "../data/actorSheets.gen";

/** 絵の 1 ドット = 論理 1 / ACTOR_ART_SCALE px（エフェクトと同じ密度） */
export const ACTOR_ART_SCALE = 2;

export interface ActorCell {
  readonly img: HTMLImageElement;
  /** アトラスの中の矩形 */
  readonly sx: number;
  readonly sy: number;
  readonly w: number;
  readonly h: number;
  /** 矩形の左上から原点までのずれ（絵のドット） */
  readonly ox: number;
  readonly oy: number;
}

export function isActorAtlas(key: string): key is ActorAtlasKey {
  return key in ACTOR_ATLASES;
}

export function actorSheet(key: string): ActorSheetDef | undefined {
  return ACTOR_SHEETS[key];
}

/** 方向の番号（角を最寄りの方向に丸める。0 = 右、時計回り） */
export function actorDir(angle: number, dirs: number): number {
  if (dirs <= 1) return 0;
  const step = (Math.PI * 2) / dirs;
  return ((Math.round(angle / step) % dirs) + dirs) % dirs;
}

/** シートのフレームの位置の印（原点からのずれ、絵のドット）。無ければ undefined */
export function actorAnchor(key: string, dir: number, frame: number, name: string): { x: number; y: number } | undefined {
  const sheet = ACTOR_SHEETS[key];
  const a = sheet?.anchors?.[dir * sheet.frames + frame]?.[name];
  if (!a || a.length < 2) return undefined;
  return { x: a[0] ?? 0, y: a[1] ?? 0 };
}

/** 作られたすべての bank（本編・装束の人影・武器掛けのアイコンがそれぞれ持つ） */
const actorBanks = new Set<ActorSpriteBank>();

/** どこかの bank が読み込み中か（main.ts はこの間ゲームを止める。UI は代わりの絵を出さない） */
export function actorArtLoading(): boolean {
  for (const bank of actorBanks) if (bank.isLoading()) return true;
  return false;
}

export class ActorSpriteBank {
  private readonly images = new Map<string, HTMLImageElement>();
  private readonly requested = new Set<string>();
  /** 読み込み中のアトラス（読めたか失敗したら外す） */
  private readonly loading = new Set<string>();
  private current = "";
  private focused = new Set<string>();

  constructor(private readonly baseUrl = "") {
    actorBanks.add(this);
  }

  /** 今のジョブの体・武器種のアトラスを読み始め、それ以外を捨てる */
  focus(atlases: readonly (string | undefined)[]): void {
    const keep = atlases.filter((a): a is string => a !== undefined && isActorAtlas(a));
    const id = keep.join("|");
    if (id === this.current) return;
    this.current = id;
    this.focused = new Set(keep);
    for (const key of [...this.images.keys()]) if (!this.focused.has(key)) this.images.delete(key);
    for (const key of [...this.requested]) if (!this.focused.has(key)) this.requested.delete(key);
    for (const key of [...this.loading]) if (!this.focused.has(key)) this.loading.delete(key);
    for (const atlas of keep) this.request(atlas);
  }

  /** focus したアトラスに読み込み中のものがあるか（main.ts はこの間ゲームを止め、24x24 の体を見せない） */
  isLoading(): boolean {
    return this.loading.size > 0;
  }

  /** アトラスが読めているか（読めていなければ読み始める） */
  ready(atlas: string): boolean {
    if (this.images.has(atlas)) return true;
    if (this.focused.has(atlas)) this.request(atlas);
    return false;
  }

  private request(atlas: string): void {
    if (this.requested.has(atlas) || !isActorAtlas(atlas)) return;
    this.requested.add(atlas);
    this.loading.add(atlas);
    const img = new Image();
    img.src = `${this.baseUrl}${ACTOR_ATLASES[atlas].url}`;
    img
      .decode()
      .then(() => {
        if (this.requested.has(atlas)) this.images.set(atlas, img);
      })
      .catch(() => {
        // 読めなければ今までの 24x24 の体のまま
      })
      .finally(() => this.loading.delete(atlas));
  }

  /** シートの 1 フレーム。読めていない・無いフレームは undefined */
  cell(key: string, dir: number, frame: number): ActorCell | undefined {
    const sheet = ACTOR_SHEETS[key];
    if (!sheet) return undefined;
    const img = this.images.get(sheet.atlas);
    if (!img) return undefined;
    const i = (dir * sheet.frames + frame) * 6;
    const r = sheet.rects;
    const w = r[i + 2] ?? 0;
    const h = r[i + 3] ?? 0;
    if (w <= 0 || h <= 0) return undefined;
    return { img, sx: r[i] ?? 0, sy: r[i + 1] ?? 0, w, h, ox: r[i + 4] ?? 0, oy: r[i + 5] ?? 0 };
  }
}

function capital(key: string): string {
  return `${key.charAt(0).toUpperCase()}${key.slice(1)}`;
}

/** 見習い（ジョブなし）の体。専用の体がまだ無いジョブもこれで描く */
export const DEFAULT_BODY_ATLAS = "bodyNone";

/** ジョブの体のアトラス（body<ジョブ>。無ければ見習いの体） */
export function bodyAtlas(job: string): string {
  const own = job === "none" ? DEFAULT_BODY_ATLAS : `body${capital(job)}`;
  return isActorAtlas(own) ? own : DEFAULT_BODY_ATLAS;
}

/** 武器種の手に持つ絵のアトラス（wpn<武器種>）。まだ無い武器種は undefined（今までの 24x24 の描画） */
export function weaponAtlas(moveset: string): string | undefined {
  const key = `wpn${capital(moveset)}`;
  return isActorAtlas(key) ? key : undefined;
}

/** アトラスの付帯情報のうち、腕の色（体）と添え手の位置（武器） */
export interface ArmColors {
  readonly sleeve: readonly string[];
  readonly hand: readonly string[];
}

export function armColors(body: string): ArmColors | undefined {
  if (!isActorAtlas(body)) return undefined;
  const meta = ACTOR_ATLASES[body].meta as { arm?: ArmColors } | null;
  return meta?.arm;
}

/** 武器の絵の付帯情報の構え（形の検査は playerRig.ts の stanceFromMeta） */
export function weaponStanceMeta(weapon: string): unknown {
  if (!isActorAtlas(weapon)) return undefined;
  const meta = ACTOR_ATLASES[weapon].meta as { stance?: unknown } | null;
  return meta?.stance;
}

/** 鞭の縄（武器の絵の meta.rope: 革の 3 段の色・先の房の色と、握りから縄の出る所までのドット）。持たない武器は null */
export function weaponRope(weapon: string): { colors: readonly string[]; tip: string; from: number } | null {
  if (!isActorAtlas(weapon)) return null;
  const meta = ACTOR_ATLASES[weapon].meta as { rope?: { colors?: unknown; tip?: unknown; from?: unknown } } | null;
  const colors = meta?.rope?.colors;
  const tip = meta?.rope?.tip;
  const from = meta?.rope?.from;
  if (!Array.isArray(colors) || colors.length < 3 || !colors.every((c) => typeof c === "string") || typeof from !== "number") return null;
  return { colors, tip: typeof tip === "string" ? tip : (colors[1] ?? ""), from };
}

export function weaponOffGrip(weapon: string): number | null {
  if (!isActorAtlas(weapon)) return null;
  const meta = ACTOR_ATLASES[weapon].meta as { offGrip?: number | null } | null;
  return meta?.offGrip ?? null;
}

/** 段ごとの持ち替えの絵（武器のアトラスの meta.stepArt）: 使うシートの key（`<アトラス>.<sheet>`）と、どの手に持つか */
export interface StepArt {
  readonly key: string;
  /** main = 前の手で今の武器の代わりに持つ / off = 後ろの手に持ち、前の手は今の武器のまま */
  readonly hand: "main" | "off";
}

/** 武器の絵の段 key（右レーンの段の key）に持ち替えの絵があれば返す。形が崩れている・シートが無ければ undefined */
export function weaponStepArt(weapon: string, stepKey: string | undefined): StepArt | undefined {
  if (stepKey === undefined || !isActorAtlas(weapon)) return undefined;
  const meta = ACTOR_ATLASES[weapon].meta as { stepArt?: Record<string, { sheet?: unknown; hand?: unknown }> } | null;
  const art = meta?.stepArt?.[stepKey];
  if (!art || typeof art.sheet !== "string" || (art.hand !== "main" && art.hand !== "off")) return undefined;
  const key = `${weapon}.${art.sheet}`;
  return key in ACTOR_SHEETS ? { key, hand: art.hand } : undefined;
}
