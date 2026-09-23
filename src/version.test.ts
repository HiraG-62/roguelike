import { describe, expect, it } from "vitest";
import packageJsonText from "../package.json?raw";
import { APP_VERSION, APP_VERSION_SEMVER, RELEASE_PHASE } from "./version";

/** α 版の表示用サフィックス（scripts/bump.mjs と揃える） */
const ALPHA_SUFFIX = "α";

function packageVersion(): unknown {
  const parsed: unknown = JSON.parse(packageJsonText);
  if (typeof parsed !== "object" || parsed === null || !("version" in parsed)) return undefined;
  return parsed.version;
}

describe("バージョン", () => {
  it("package.json の version と APP_VERSION_SEMVER が一致する", () => {
    expect(packageVersion(), "package.json と src/version.ts がずれている。scripts/bump.mjs で更新すること").toBe(APP_VERSION_SEMVER);
  });

  it("semver はメジャー.マイナー.パッチの数字 3 つ", () => {
    expect(APP_VERSION_SEMVER).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("表示用は semver に段階のサフィックスを付けたもの", () => {
    const suffix = RELEASE_PHASE === "alpha" ? ALPHA_SUFFIX : "";
    expect(APP_VERSION).toBe(`${APP_VERSION_SEMVER}${suffix}`);
  });

  it("α 期間はメジャーとマイナーが 0 のまま", () => {
    if (RELEASE_PHASE !== "alpha") return;
    expect(APP_VERSION_SEMVER.startsWith("0.0."), "α 期間は 0.0.xx で進める").toBe(true);
  });
});
