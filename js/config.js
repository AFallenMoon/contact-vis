/**
 * 应用配置
 * 前后端分离架构：前端部署在 GitHub Pages，后端部署在阿里云函数计算
 */
export const config = {
    // 自动检测 API 地址
    get apiBaseUrl() {
        // 如果设置了环境变量，使用环境变量
        if (window.API_BASE_URL) {
            return window.API_BASE_URL;
        }
        
        // 从 meta 标签读取 API 地址（部署时由 GitHub Actions 自动更新）
        const metaTag = document.querySelector('meta[name="api-base-url"]');
        if (metaTag && metaTag.content) {
            return metaTag.content;
        }
        
        // 默认值（需要在部署时设置）
        return 'https://visualization-api-cn-hangzhou.fcapp.run';
    },
    
    // Bearer Token 配置（用于函数计算 HTTP 触发器认证）
    get apiToken() {
        // 从 meta 标签读取 token（部署时由 GitHub Actions 自动更新）
        const tokenTag = document.querySelector('meta[name="api-token"]');
        if (tokenTag && tokenTag.content) {
            return tokenTag.content;
        }
        
        // 默认值（需要在部署时设置）
        return '';
    }
};

