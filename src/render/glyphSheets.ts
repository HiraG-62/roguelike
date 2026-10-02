/**
 * 字の台紙（pixelText のグリフと色付きグリフの置き場）。1 字ごとに canvas を作ると、初めて出る字が多い画面
 * （祝福の 3 択・章の札）で 200 枚以上を一度に作って 60ms ほど止まり、DOM の canvas が数千枚に増えて GC も重くなる。
 * 大きめの canvas に行（棚）詰めで並べ、描くときは台紙の一部を切り出して blit する。
 */

/** 台紙の 1 区画（台紙の canvas の中の矩形） */
export interface SheetSlot {
  canvas: HTMLCanvasElement;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 区画どうしの隙間（px）。拡大して描くときに隣の字がにじまないように空ける */
const SLOT_PAD = 1;

/** 棚詰めの割り当て（純粋な計算）。行の高さは固定、左から詰めて溢れたら次の行、台紙が埋まったら次の台紙 */
export class ShelfPacker {
  private page = 0;
  private x = 0;
  private y = 0;

  constructor(
    private readonly size: number,
    private readonly rowH: number,
  ) {}

  /** 幅 w の区画を取る。台紙より広い字は null（呼び出し側は単独の canvas にする） */
  alloc(w: number): { page: number; x: number; y: number } | null {
    if (w > this.size || this.rowH > this.size) return null;
    if (this.x + w > this.size) {
      this.x = 0;
      this.y += this.rowH + SLOT_PAD;
    }
    if (this.y + this.rowH > this.size) {
      this.page++;
      this.x = 0;
      this.y = 0;
    }
    const at = { page: this.page, x: this.x, y: this.y };
    this.x += w + SLOT_PAD;
    return at;
  }
}

export type CreateCanvas = (width: number, height: number) => HTMLCanvasElement;

/** 台紙の束。区画を取ると、必要なら新しい台紙の canvas を作る */
export class GlyphSheet {
  private readonly packer: ShelfPacker;
  private readonly pages: HTMLCanvasElement[] = [];

  constructor(
    private readonly create: CreateCanvas,
    private readonly size: number,
    private readonly rowH: number,
  ) {
    this.packer = new ShelfPacker(size, rowH);
  }

  /** 台紙の枚数（テスト用） */
  get pageCount(): number {
    return this.pages.length;
  }

  /** 幅 w・高さ rowH の区画を取る。台紙より広い字はその字だけの canvas */
  alloc(w: number): SheetSlot {
    const at = this.packer.alloc(w);
    if (!at) return { canvas: this.create(w, this.rowH), x: 0, y: 0, w, h: this.rowH };
    let canvas = this.pages[at.page];
    if (!canvas) {
      canvas = this.create(this.size, this.size);
      this.pages[at.page] = canvas;
    }
    return { canvas, x: at.x, y: at.y, w, h: this.rowH };
  }
}
