/**
 * 全アクションはイベントとして発行する。
 * ログ・実績・リプレイはこのイベント列を購読して実装する。
 */
export type GameEvent =
  | { type: "welcome" }
  | { type: "descend"; depth: number }
  | { type: "attack"; attackerName: string; defenderName: string; damage: number }
  | { type: "death"; name: string; isPlayer: boolean }
  | { type: "gainXp"; amount: number }
  | { type: "levelUp"; level: number };

export interface LogMessage {
  text: string;
  color: string;
  turn: number;
}

export const LOG_COLOR = {
  info: "#c0c0c0",
  good: "#8fd18f",
  bad: "#e07070",
  highlight: "#ffd75f",
} as const;

/** イベントからログ文を作る。ログに出さないイベントは null */
export function describeEvent(ev: GameEvent): Omit<LogMessage, "turn"> | null {
  switch (ev.type) {
    case "welcome":
      return { text: "Welcome to the dungeon. Find the stairs (>) and descend.", color: LOG_COLOR.highlight };
    case "descend":
      return { text: `You descend to depth ${ev.depth}.`, color: LOG_COLOR.highlight };
    case "attack":
      return ev.damage > 0
        ? { text: `${cap(ev.attackerName)} hits ${ev.defenderName} for ${ev.damage}.`, color: LOG_COLOR.info }
        : { text: `${cap(ev.attackerName)} misses ${ev.defenderName}.`, color: LOG_COLOR.info };
    case "death":
      return ev.isPlayer
        ? { text: "You die...", color: LOG_COLOR.bad }
        : { text: `${cap(ev.name)} dies.`, color: LOG_COLOR.good };
    case "gainXp":
      return { text: `You gain ${ev.amount} XP.`, color: LOG_COLOR.info };
    case "levelUp":
      return { text: `Welcome to level ${ev.level}!`, color: LOG_COLOR.good };
  }
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
