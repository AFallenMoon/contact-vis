/**
 * 缓存管理器
 * 使用内存缓存（Map）实现缓存
 */
class CacheManager {
    constructor() {
        this.prefix = 'trajectory_cache_';
        this.defaultTTL = {
            timestamps: 60 * 60 * 1000,        // 1小时（时间戳列表很少变化）
            bounds: 60 * 60 * 1000,            // 1小时（边界信息很少变化）
            contacts: 30 * 60 * 1000,         // 30分钟（按时间戳的数据）
            userContacts: 15 * 60 * 1000,     // 15分钟（用户密接）
            trajectory: 15 * 60 * 1000         // 15分钟（轨迹数据）
        };
        
        // 使用内存缓存（Map）
        this.memoryCache = new Map();
    }

    /**
     * 生成缓存键
     */
    _getCacheKey(type, key) {
        return `${this.prefix}${type}_${key}`;
    }

    /**
     * 获取缓存数据
     * @param {string} type - 缓存类型（timestamps, bounds, contacts, userContacts, trajectory）
     * @param {string} key - 缓存键
     * @returns {any|null} 缓存的数据，如果不存在或已过期则返回 null
     */
    get(type, key) {
        const cacheKey = this._getCacheKey(type, key);
        const cached = this.memoryCache.get(cacheKey);
        
        if (!cached) {
            return null;
        }
        
        const { data, timestamp, ttl } = cached;
        const now = Date.now();
        const age = now - timestamp;
        
        // 检查是否过期
        if (age > ttl) {
            this.memoryCache.delete(cacheKey);
            return null;
        }
        
        return data;
    }

    /**
     * 设置缓存数据
     * @param {string} type - 缓存类型
     * @param {string} key - 缓存键
     * @param {any} data - 要缓存的数据
     * @param {number} ttl - 过期时间（毫秒），可选，默认使用类型对应的 TTL
     */
    set(type, key, data, ttl = null) {
        const cacheKey = this._getCacheKey(type, key);
        const cacheTTL = ttl || this.defaultTTL[type] || 15 * 60 * 1000;
        
        const cacheData = {
            data,
            timestamp: Date.now(),
            ttl: cacheTTL
        };
        
        // 使用内存缓存
        this.memoryCache.set(cacheKey, cacheData);
    }

    /**
     * 删除指定缓存
     */
    delete(type, key) {
        const cacheKey = this._getCacheKey(type, key);
        this.memoryCache.delete(cacheKey);
    }

    /**
     * 清理过期缓存
     */
    clearOldCache() {
        const now = Date.now();
        const keysToDelete = [];
        
        for (const [key, cached] of this.memoryCache.entries()) {
            if (key.startsWith(this.prefix)) {
                const { timestamp, ttl } = cached;
                if (now - timestamp > ttl) {
                    keysToDelete.push(key);
                }
            }
        }
        
        keysToDelete.forEach(key => this.memoryCache.delete(key));
        if (keysToDelete.length > 0) {
            console.log(`[Cache] 清理了 ${keysToDelete.length} 个过期缓存`);
        }
    }

    /**
     * 清理所有缓存
     */
    clearAll() {
        const count = this.memoryCache.size;
        this.memoryCache.clear();
        console.log(`[Cache] 清理了 ${count} 个缓存`);
    }

    /**
     * 获取缓存统计信息
     */
    getStats() {
        const stats = {
            total: 0,
            byType: {},
            totalSize: 0
        };

        for (const [key, cached] of this.memoryCache.entries()) {
            if (key.startsWith(this.prefix)) {
                stats.total++;
                const type = key.replace(this.prefix, '').split('_')[0];
                stats.byType[type] = (stats.byType[type] || 0) + 1;
                
                // 估算大小（JSON 字符串长度）
                try {
                    const size = JSON.stringify(cached).length;
                    stats.totalSize += size;
                } catch (e) {
                    // 忽略序列化错误
                }
            }
        }

        return stats;
    }
}

// 导出单例
export const cacheManager = new CacheManager();

// 页面加载时清理过期缓存
if (typeof window !== 'undefined') {
    cacheManager.clearOldCache();
    
    // 页面卸载时清理所有缓存
    window.addEventListener('beforeunload', () => {
        cacheManager.clearAll();
    });
}

