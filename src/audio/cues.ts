/**
 * main.ts が state を読んで鳴らす効果音の「立ち上がり」検出（docs/ideas/meta-and-weapons.md 8-10 依頼の達成）。
 * ロジックは進行を数えるだけで音を知らないので、「達成したか」の真偽の変わり目をここで拾う。
 * 持ち主（ラン = GameState）が変わったら、その時点の値を基準にし直す（ラン開始時点で既に満たしていても鳴らさない）
 */
export class RisingEdge {
  private owner: object | null = null;
  private last = false;

  /** value が false → true に変わった瞬間だけ true。持ち主が変わった最初の呼び出しは基準にするだけ */
  update(owner: object, value: boolean): boolean {
    if (owner !== this.owner) {
      this.owner = owner;
      this.last = value;
      return false;
    }
    const rose = value && !this.last;
    this.last = value;
    return rose;
  }
}
