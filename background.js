// 点击扩展图标 → 在新标签页打开播放器
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL("player.html") });
});
