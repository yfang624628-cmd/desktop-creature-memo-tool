#!/bin/bash
# 双击这个文件，它就站到桌面上。
# 退出走它的右键菜单；万一右键点不到，Ctrl+Option+Cmd+Q 强制退出。
cd "$(dirname "$0")"

# 只许有一只。真正的守卫在 desktop/main.js 的 requestSingleInstanceLock()——
# 这里这道只是为了少闪一个进程，匹配的是启动参数，不依赖目录叫什么名字。
if pgrep -f "electron.*desktop/main.js" >/dev/null 2>&1; then
  echo "它已经在桌面上了。"
  sleep 1
  exit 0
fi

# env -u ELECTRON_RUN_AS_NODE：留着这个变量 electron 会退化成普通 node，窗口不出来
nohup env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron desktop/main.js >/dev/null 2>&1 &

sleep 1
echo "它出来了。这个窗口可以关掉，不影响它。"
exit 0
