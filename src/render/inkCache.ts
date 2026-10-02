import { INK_DOTS, type InkSurface } from "./inkSurface";

/**
 * 墨の筆の形のキャッシュ（docs/ideas/ink-telegraph-impl.md 5 章）。筆 1 本が作業面へ置いたドットの列を、ワールドのドットで覚えて写し直す。
 * ばらつきはワールドのドットと筆の局所のハッシュだけなので、同じ形（ワールドの道と筆の設定が同じ）なら出力も同じ。
 * 予備動作で立ち止まった敵の線・輪は何フレームも同じ形なので、2 回続けて見えた形だけを記録し、3 回目から写す
 * （狙いを追っている間の線や薄れていく線は毎フレーム形が変わるので、記録の手間を掛けない）
 */

/** 記録の 1 本: 置いた順のドット（記録の左上からのずれを 16 ビットずつ詰める）と、印の値ごとの色・不透明度 */
export interface InkRecord {
  /** 記録の左上（ワールドのドット） */
  x0: number;
  y0: number;
  /** 右下（ワールドのドット。含む） */
  x1: number;
  y1: number;
  pos: Uint32Array;
  codes: Uint8Array;
  /** 印の値（層 × 8 + 段）→ 色（ABGR の RGB）と不透明度 */
  rgb: Uint32Array;
  alpha: Float32Array;
  /** 入りの朱の点（ワールドのドット。無ければ null）。印は記録せず、写すときに置き直す */
  shu: { x: number; y: number } | null;
}

/** 印の値の数（層 0..7 × 段 0..7） */
const CODE_COUNT = 64;
const LAYER_SHIFT = 8;
const LOW16 = 0xffff;
const INITIAL = 1024;

/** 記録中のドットの列（伸びる配列） */
export class InkRecorder {
  private xs = new Int32Array(INITIAL);
  private ys = new Int32Array(INITIAL);
  private cs = new Uint8Array(INITIAL);
  private n = 0;
  private readonly rgb = new Uint32Array(CODE_COUNT);
  private readonly alpha = new Float32Array(CODE_COUNT);
  shu: { x: number; y: number } | null = null;

  constructor(
    /** 作業面のドット → ワールドのドットのずれ */
    private readonly oxd: number,
    private readonly oyd: number,
  ) {}

  push(x: number, y: number, layer: number, level: number, rgb: number, alpha: number): void {
    if (this.n === this.xs.length) this.grow();
    const code = layer * LAYER_SHIFT + level;
    this.xs[this.n] = x - this.oxd;
    this.ys[this.n] = y - this.oyd;
    this.cs[this.n] = code;
    this.rgb[code] = rgb;
    this.alpha[code] = alpha;
    this.n++;
  }

  private grow(): void {
    const size = this.xs.length * 2;
    const xs = new Int32Array(size);
    const ys = new Int32Array(size);
    const cs = new Uint8Array(size);
    xs.set(this.xs);
    ys.set(this.ys);
    cs.set(this.cs);
    this.xs = xs;
    this.ys = ys;
    this.cs = cs;
  }

  /** 記録を閉じる。ずれが 16 ビットに収まらない（極端に大きい）形は null（覚えない） */
  finish(): InkRecord | null {
    let x0 = Number.POSITIVE_INFINITY;
    let y0 = Number.POSITIVE_INFINITY;
    let x1 = Number.NEGATIVE_INFINITY;
    let y1 = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < this.n; i++) {
      const x = this.xs[i] ?? 0;
      const y = this.ys[i] ?? 0;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
    if (this.n === 0) return { x0: 0, y0: 0, x1: -1, y1: -1, pos: new Uint32Array(0), codes: new Uint8Array(0), rgb: this.rgb, alpha: this.alpha, shu: this.shu };
    if (x1 - x0 > LOW16 || y1 - y0 > LOW16) return null;
    const pos = new Uint32Array(this.n);
    for (let i = 0; i < this.n; i++) pos[i] = ((((this.ys[i] ?? 0) - y0) << 16) | ((this.xs[i] ?? 0) - x0)) >>> 0;
    return { x0, y0, x1, y1, pos, codes: this.cs.slice(0, this.n), rgb: this.rgb, alpha: this.alpha, shu: this.shu };
  }
}

/** 記録を作業面へ写す（作業面の外のドットは put が捨てる） */
export function replayRecord(surf: InkSurface, rec: InkRecord): void {
  const oxd = surf.ox * INK_DOTS;
  const oyd = surf.oy * INK_DOTS;
  // 全体が画面の外なら何もしない
  if (rec.x1 + oxd < 0 || rec.y1 + oyd < 0 || rec.x0 + oxd >= surf.w || rec.y0 + oyd >= surf.h) return;
  const bx = rec.x0 + oxd;
  const by = rec.y0 + oyd;
  const n = rec.pos.length;
  for (let i = 0; i < n; i++) {
    const p = rec.pos[i] ?? 0;
    const code = rec.codes[i] ?? 0;
    surf.putDot(bx + (p & LOW16), by + (p >>> 16), code >> 3, code & 7, rec.rgb[code] ?? 0, rec.alpha[code] ?? 0);
  }
  // 汚れは記録の外接矩形でまとめて記録する
  for (let y = by; y <= rec.y1 + oyd; y++) surf.touch(y, bx, rec.x1 + oxd);
}

/** 覚えるドットの合計の上限（1 ドット 5 バイト。約 5MB）。超えたら古い物から捨てる */
const MAX_DOTS = 1_000_000;
/** 「1 度見た形」の覚えの上限（超えたら忘れる。2 度目が来なければ記録しない） */
const MAX_SEEN = 2048;

/** 形の鍵 → 記録（古い順に捨てる）と、1 度だけ見た鍵 */
export class InkShapeCache {
  private readonly records = new Map<string, InkRecord>();
  private readonly seen = new Set<string>();
  private dots = 0;

  get(key: string): InkRecord | undefined {
    const rec = this.records.get(key);
    if (!rec) return undefined;
    // 使った物を新しい側へ（古い順に捨てるので）
    this.records.delete(key);
    this.records.set(key, rec);
    return rec;
  }

  /** この形を前にも見たか（見たことを覚える）。2 度目に true */
  seenBefore(key: string): boolean {
    if (this.seen.has(key)) return true;
    if (this.seen.size >= MAX_SEEN) this.seen.clear();
    this.seen.add(key);
    return false;
  }

  store(key: string, rec: InkRecord): void {
    this.seen.delete(key);
    this.records.set(key, rec);
    this.dots += rec.pos.length;
    for (const [k, r] of this.records) {
      if (this.dots <= MAX_DOTS) break;
      this.records.delete(k);
      this.dots -= r.pos.length;
    }
  }

  get size(): number {
    return this.records.size;
  }

  clear(): void {
    this.records.clear();
    this.seen.clear();
    this.dots = 0;
  }
}
