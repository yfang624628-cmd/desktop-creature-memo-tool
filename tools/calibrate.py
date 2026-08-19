#!/usr/bin/env python3
"""解出 assessment.json > calibration —— 让 20 只原型被抽中的概率一样。

余弦相似度只回答「谁最像你」，不保证 20 只被选中的次数均匀。原始分布里
猫咪 10.9%、抽纸 1.0%。这里给每只一个固定偏置，加在余弦分之上再取最大值：
偏置对同一个用户是常数，不改变「这个向量更靠近谁」的逻辑，只把整体分布拉平。

改了任何一张卡的权重、任何一个 signature、或 step1/step2 的 pick 与 weight
之后，必须重跑：

    python3 tools/calibrate.py        # 解出并写回 data/assessment.json
    python3 tools/calibrate.py --dry  # 只看分布，不写

依赖 numpy。全量枚举 C(20,5)×C(15,3) = 7054320 种组合，约一分钟。
"""
import json, itertools, pathlib, sys
import numpy as np

ROOT = pathlib.Path(__file__).resolve().parent.parent
AP, PP = ROOT / "data/assessment.json", ROOT / "data/prototypes.json"
DRY = "--dry" in sys.argv

A = json.load(open(AP, encoding="utf-8"))
NAME = {x["id"]: x["name"] for x in json.load(open(PP, encoding="utf-8"))["prototypes"]}

axes = list(A["axes"])
cards = A["cards"]
n, k1, k2 = len(cards), A["flow"]["step1"]["pick"], A["flow"]["step2"]["pick"]
w1, w2 = A["flow"]["step1"]["weight"], A["flow"]["step2"]["weight"]

W = np.array([[c["w"].get(a, 0.0) for a in axes] for c in cards])
pids = sorted(A["signatures"])
S = np.array([[A["signatures"][p].get(a, 0.0) for a in axes] for p in pids])
Sn = S / np.linalg.norm(S, axis=1, keepdims=True)

hits = list(itertools.combinations(range(n), k1))
tri = list(itertools.combinations(range(n), k2))
Hv = np.array([W[list(h)].sum(0) * w1 for h in hits])
Tv = np.array([W[list(t)].sum(0) * w2 for t in tri])
Hm = np.array([sum(1 << i for i in h) for h in hits])
Tm = np.array([sum(1 << i for i in t) for t in tri])


def sweep(bias, rows=None):
    """rows=None 走全量；否则只跑给定的 hit-set 下标。返回 (中签数, 总数, 平均匹配度)"""
    cnt = np.zeros(len(pids), dtype=np.int64)
    tot, conf = 0, 0.0
    for i in (range(len(hits)) if rows is None else rows):
        V = Hv[i] + Tv[(Tm & Hm[i]) == 0]          # 无感的三张不能跟正选的五张重合
        nv = np.linalg.norm(V, axis=1, keepdims=True)
        nv[nv == 0] = 1e-9
        C = (V / nv) @ Sn.T
        a = (C + bias).argmax(1)
        cnt += np.bincount(a, minlength=len(pids))
        tot += len(C)
        conf += C[np.arange(len(C)), a].sum()
    return cnt, tot, conf / tot


target = 1.0 / len(pids)
b = np.zeros(len(pids))

# 先在抽样上快速收敛，再在全量上收尾——全量一轮太贵，不适合迭代几十次
samp = np.random.default_rng(7).choice(len(hits), 6000, replace=False)
for it in range(400):
    cnt, tot, _ = sweep(b, samp)
    sh = cnt / tot
    if np.abs(sh - target).max() < 1.5e-4:
        break
    b += (0.30 / (1 + it * 0.002)) * (target - sh)

for it in range(12):
    cnt, tot, conf = sweep(b)
    sh = cnt / tot
    dev = np.abs(sh - target).max() * 100
    print(f"全量第 {it} 轮   最大偏离 {dev:.4f} 个百分点", flush=True)
    if dev < 0.05:
        break
    b += 0.9 * (target - sh)

print(f"\n{tot} 种组合   平均匹配度 {conf:.3f}\n")
for i in np.argsort(-sh):
    print(f"  {pids[i]} {NAME[pids[i]]:<4}  {sh[i]*100:6.3f}%   偏置 {b[i]:+.4f}")
print(f"\n最大偏离 {np.abs(sh-target).max()*100:.3f} 个百分点（均值 {target*100:.3f}%）")

if DRY:
    print("\n--dry：没有写回")
else:
    A["calibration"] = {p: round(float(b[i]), 5) for i, p in enumerate(pids)}
    json.dump(A, open(AP, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(f"\n✓ 已写回 {AP.relative_to(ROOT)} > calibration —— 记得跑 python3 build-data.py")
