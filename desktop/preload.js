'use strict';

/* 渲染进程能碰到的全部桌面能力就这几条。
 * 便签、图鉴、回看一概不经过这里——桌面壳只管窗口，不管内容。
 * 唯一的例外是 backup：存档的家仍然是 localStorage，桌面壳只是收一份副本存盘，
 * 从不读回来。见 main.js 里那段说明。 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('DESKTOP', {
  /* 此刻窗口里哪几块是「实心」的（窗口内坐标）。主进程拿这个跟全局光标位置比，
   * 决定窗口吃不吃鼠标——判断不能放在渲染进程做，见 main.js 里那段说明。 */
  hot: function (rects) { ipcRenderer.send('pet:hot', rects); },
  onHover: function (fn) {
    ipcRenderer.on('pet:hover', function (e, on) { fn(on); });
  },

  // 'pet' | 'panel' | 'big' | 'oobe'
  mode: function (name) { ipcRenderer.send('pet:mode', name); },

  // 'start' | 'move' | 'end'
  drag: function (phase) { ipcRenderer.send('pet:drag', phase); },

  /* 存档副本落到 userData。只写不读——localStorage 被清掉时，那份还在。 */
  backup: function (json) { ipcRenderer.send('pet:backup', json); },

  // 系统空闲了多少秒。渲染进程拿不到系统级输入，只能问主进程。
  idleSeconds: function () { return ipcRenderer.invoke('pet:idle'); },

  /* LLM。渲染进程只递「说什么」和收结果，key 在主进程那边，这里看不见。 */
  llmReady: function () { return ipcRenderer.invoke('pet:llm-ready'); },
  llmGenerate: function (payload) { return ipcRenderer.invoke('pet:llm-generate', payload); },

  focus: function () { ipcRenderer.send('pet:focus'); },
  menu: function () { ipcRenderer.send('pet:menu'); },
  onMenu: function (fn) {
    ipcRenderer.on('pet:menu-action', function (e, action) { fn(action); });
  }
});
