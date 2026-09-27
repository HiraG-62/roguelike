// prompt.mjs の型（src/tools から読むため）
export type ViewKey = "side" | "3/4" | "front" | "top" | "none";
export const VIEW_TEMPLATES: Readonly<Record<ViewKey, string>>;
export function assemblePrompt(view: string, subject: string, extra?: string): string;
