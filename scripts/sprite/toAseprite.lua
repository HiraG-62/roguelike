-- 横一列の PNG をフレームに分けて .aseprite にする（scripts/sprite/aseprite.mjs から --script-param 付きで呼ぶ）
-- params: src（PNG）/ w, h（1 フレームの寸法）/ pal（.gpl）/ out（.aseprite）
local p = app.params
local w = tonumber(p.w)
local h = tonumber(p.h)
local spr = app.open(p.src)
if not spr then error("開けない: " .. tostring(p.src)) end

if spr.width > w then
  app.command.ImportSpriteSheet{
    ui = false,
    type = SpriteSheetType.HORIZONTAL,
    frameBounds = Rectangle(0, 0, w, h),
    padding = Rectangle(0, 0, 0, 0),
    partialTiles = false,
  }
end

spr.layers[1].name = "art"
spr:setPalette(Palette{ fromFile = p.pal })
spr:saveAs(p.out)
print("OK " .. p.out .. " frames=" .. #spr.frames)
