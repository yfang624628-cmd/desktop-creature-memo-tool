#!/usr/bin/env python3
"""把 data/*.json 打包成 js/data.js，让页面可以用 file:// 直接打开（fetch 在 file:// 下会被 CORS 拦截）。

data/*.json 是唯一事实来源。改完 JSON 后运行：
    python3 build-data.py
"""
import json, pathlib

root = pathlib.Path(__file__).parent
src = root / "data"
out = root / "js" / "data.js"
out.parent.mkdir(exist_ok=True)

names = ["rules", "prototypes", "jobs", "tasks", "events", "combos", "copy", "assessment", "notes", "notemap", "classify", "gacha", "dayplan", "riff"]
bundle = {}
for n in names:
    with open(src / f"{n}.json", encoding="utf-8") as f:
        bundle[n] = json.load(f)

body = json.dumps(bundle, ensure_ascii=False, separators=(",", ":"))
out.write_text(
    "// 由 build-data.py 从 data/*.json 自动生成，请勿手改。\n"
    "// 改数据请改 data/*.json，然后运行：python3 build-data.py\n"
    f"window.GAME_DATA = {body};\n",
    encoding="utf-8",
)

counts = {
    "原型": len(bundle["prototypes"]["prototypes"]),
    "职位": len(bundle["jobs"]["jobs"]),
    "任务": len(bundle["tasks"]["tasks"]),
    "事件": len(bundle["events"]["events"]),
    "组合": len(bundle["combos"]["combos"]),
}
print(f"✓ 已生成 {out.relative_to(root)}  ({out.stat().st_size/1024:.1f} KB)")
print("  " + "  ".join(f"{k}{v}" for k, v in counts.items()))
