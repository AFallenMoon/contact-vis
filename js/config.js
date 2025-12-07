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
        
        // 默认值（占位符，实际部署时由 GitHub Actions 替换）
        return '';
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
    },
    
    // 地图瓦片配置（支持多个瓦片源）
    get tileConfig() {
        // 从 meta 标签读取瓦片源配置
        const tileMetaTag = document.querySelector('meta[name="tile-source"]');
        const tileSource = tileMetaTag ? tileMetaTag.content : 'esri'; // 默认使用 Esri（国际通用，芝加哥地区显示效果好）
        
        // 瓦片源配置
        const tileSources = {
            // 高德地图（推荐，国内速度快，无需 API Key）
            gaode: {
                url: 'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}',
                subdomains: ['1', '2', '3', '4'],
                attribution: '© 高德地图',
                maxZoom: 19
            },
            // 高德卫星图
            gaode_satellite: {
                url: 'https://webst0{s}.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}',
                subdomains: ['1', '2', '3', '4'],
                attribution: '© 高德地图',
                maxZoom: 19
            },
            // 腾讯地图（国内速度快，无需 API Key）
            tencent: {
                url: 'https://rt{s}.map.gtimg.com/realtimerender?z={z}&x={x}&y={y}&type=vector&style=0',
                subdomains: ['0', '1', '2', '3'],
                attribution: '© 腾讯地图',
                maxZoom: 19
            },
            // OpenStreetMap（国际通用，国内可能较慢）
            osm: {
                url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
                subdomains: ['a', 'b', 'c'],
                attribution: '© OpenStreetMap contributors',
                maxZoom: 19
            },
            // OpenStreetMap 国内镜像（如果可用）
            osm_cn: {
                url: 'https://tile.openstreetmap.cn/OpenStreetMap/tile/{z}/{x}/{y}.png',
                subdomains: [],
                attribution: '© OpenStreetMap contributors',
                maxZoom: 19
            },
            // OSM Hot 风格
            osm_hot: {
                url: 'https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png',
                subdomains: ['a', 'b', 'c'],
                attribution: '© OpenStreetMap contributors, Tiles style by HOT',
                maxZoom: 19
            },
            // CartoDB Positron（浅色风格）
            cartodb: {
                url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
                subdomains: ['a', 'b', 'c', 'd'],
                attribution: '© OpenStreetMap contributors © CARTO',
                maxZoom: 20
            },
            // Esri WorldStreetMap
            esri: {
                url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
                subdomains: [],
                attribution: '© Esri',
                maxZoom: 19
            }
        };
        
        return tileSources[tileSource] || tileSources.esri;
    }
};

