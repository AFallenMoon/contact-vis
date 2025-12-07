import { App } from './app.js';
import './config.js'; // 确保配置先加载
import './visualization-trajectory.js';

// 初始化应用入口
document.addEventListener('DOMContentLoaded', () => {
    const app = new App();
    // 仍然挂到 window 上，兼容现有通过 window.app 访问的逻辑
    window.app = app;
    app.init();
});


