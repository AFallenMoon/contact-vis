/**
 * 数据加载和处理模块（从后端API获取数据）
 */
import { config } from './config.js';
import { cacheManager } from './cache-manager.js';

export class DataLoader {
    constructor() {
        this.rawData = [];                 // 当前时间戳的原始数据
        this.allTimestamps = [];           // 所有可用时间戳
        this.contacts = [];                // 当前时间戳的密接对
        this.bounds = { minLat: Infinity, maxLat: -Infinity, minLng: Infinity, maxLng: -Infinity };
        this.userContacts = {};            // 按用户ID索引的密接对（当前查询结果）
        this.userSecondaryContacts = {};   // 按用户ID索引的次密接对（当前查询结果）
        this.dataCache = new Map();        // 预加载数据缓存 {timestamp: {rawData, contacts, bounds}}
        this.apiBaseUrl = config.apiBaseUrl; // API 基础地址
    }
    
    /**
     * 统一的 fetch 方法，自动添加 Bearer Token 认证头
     */
    async apiFetch(url, options = {}) {
        const headers = {
            'Content-Type': 'application/json',
            ...options.headers
        };
        
        // 添加 Bearer Token 认证头
        if (config.apiToken) {
            headers['Authorization'] = `Bearer ${config.apiToken}`;
        }
        
        return fetch(url, {
            ...options,
            headers
        });
    }

    /**
     * 初始化数据：获取所有时间戳和第一个时间戳的数据，并预加载第二个时间戳
     */
    async initData() {
        try {
            // 先尝试从缓存获取时间戳列表
            const cachedTimestamps = cacheManager.get('timestamps', 'all');
            if (cachedTimestamps) {
                console.log('[Cache] 从缓存加载时间戳列表');
                this.allTimestamps = cachedTimestamps;
            } else {
                // 从 API 获取时间戳列表
                const timestampsResponse = await this.apiFetch(`${this.apiBaseUrl}/api/timestamps`);
                if (!timestampsResponse.ok) {
                    throw new Error(`获取时间戳失败: ${timestampsResponse.status} ${timestampsResponse.statusText}`);
                }
                this.allTimestamps = await timestampsResponse.json();
                // 缓存时间戳列表
                cacheManager.set('timestamps', 'all', this.allTimestamps);
            }
            
            if (this.allTimestamps.length === 0) {
                throw new Error("未找到任何时间戳数据");
            }

            // 获取第一个时间戳的数据
            const firstTimestamp = this.allTimestamps[0];
            await this.loadDataByTimestamp(firstTimestamp);
            
            console.log(`初始化完成：第一个时间戳 ${firstTimestamp}，包含 ${this.contacts.length} 条记录`);
            
            // 预加载第二个时间戳的数据（如果存在），避免网络卡顿
            if (this.allTimestamps.length > 1) {
                const secondTimestamp = this.allTimestamps[1];
                this.preloadDataByTimestamp(secondTimestamp).catch(err => {
                    console.warn(`预加载第二个时间戳 ${secondTimestamp} 失败:`, err);
                });
            }
            
            return true;
        } catch (error) {
            console.error('数据初始化失败:', error);
            alert(`数据初始化错误: ${error.message}\n请检查后端服务是否启动并正常运行`);
            return false;
        }
    }

    /**
     * 预加载指定时间戳的数据（不切换当前数据）
     */
    async preloadDataByTimestamp(timestamp) {
        // 如果已经在缓存中，直接返回
        if (this.dataCache.has(timestamp)) {
            return;
        }
        
        try {
            const response = await this.apiFetch(`${this.apiBaseUrl}/api/contacts/${timestamp}`);
            
            let responseData;
            try {
                responseData = await response.json();
            } catch (e) {
                responseData = { error: '无法解析服务器响应' };
            }

            if (!response.ok) {
                const errorMsg = responseData.error || `数据加载失败: ${response.status} ${response.statusText}`;
                throw new Error(errorMsg);
            }
            
            // 处理数据但不更新当前数据
            const tempRawData = responseData;
            const tempBounds = { minLat: Infinity, maxLat: -Infinity, minLng: Infinity, maxLng: -Infinity };
            
            // 计算边界
            for (const record of tempRawData) {
                tempBounds.minLat = Math.min(tempBounds.minLat, record.lat);
                tempBounds.maxLat = Math.max(tempBounds.maxLat, record.lat);
                tempBounds.minLng = Math.min(tempBounds.minLng, record.lng);
                tempBounds.maxLng = Math.max(tempBounds.maxLng, record.lng);
            }
            
            // 处理密接对
            const contactMap = new Map();
            for (const record of tempRawData) {
                const [smaller, larger] = record.id1 < record.id2 
                    ? [record.id1, record.id2] 
                    : [record.id2, record.id1];
                const key = `${smaller}|${larger}`;
                
                if (!contactMap.has(key)) {
                    contactMap.set(key, {
                        id1: smaller,
                        id2: larger,
                        timestamps: [record.timestamp],
                        points: [{
                            timestamp: record.timestamp,
                            lng: record.lng,
                            lat: record.lat,
                            contact_type: record.contact_type || 'direct'
                        }],
                        contact_type: record.contact_type || 'direct',
                        through: record.through
                    });
                } else {
                    const contact = contactMap.get(key);
                    contact.timestamps.push(record.timestamp);
                    contact.points.push({
                        timestamp: record.timestamp,
                        lng: record.lng,
                        lat: record.lat,
                        contact_type: record.contact_type || 'direct'
                    });
                }
            }
            
            const tempContacts = Array.from(contactMap.values()).map(contact => {
                contact.timestamps.sort((a, b) => a - b);
                contact.points.sort((a, b) => a.timestamp - b.timestamp);
                contact.timePeriods = this.mergeTimePeriods(contact.timestamps);
                return contact;
            });
            
            // 存入缓存
            this.dataCache.set(timestamp, {
                rawData: tempRawData,
                contacts: tempContacts,
                bounds: tempBounds
            });
            
            console.log(`预加载时间戳 ${timestamp}：${tempContacts.length} 条记录`);
        } catch (error) {
            console.warn(`预加载时间戳 ${timestamp} 失败:`, error);
            // 预加载失败不抛出错误，不影响主流程
        }
    }

    /**
     * 按时间戳从后端API加载数据（优先使用缓存）
     */
    async loadDataByTimestamp(timestamp) {
        // 优先检查内存缓存
        if (this.dataCache.has(timestamp)) {
            const cached = this.dataCache.get(timestamp);
            this.rawData = cached.rawData;
            this.contacts = cached.contacts;
            this.bounds = cached.bounds;
            console.log(`[Cache] 从内存缓存加载时间戳 ${timestamp}：${this.contacts.length} 条记录`);
            
            // 从缓存中移除（已使用）
            this.dataCache.delete(timestamp);
            return true;
        }
        
        // 检查 localStorage 缓存
        const cachedData = cacheManager.get('contacts', String(timestamp));
        if (cachedData) {
            this.rawData = cachedData.rawData;
            this.contacts = cachedData.contacts;
            this.bounds = cachedData.bounds;
            console.log(`[Cache] 从持久化缓存加载时间戳 ${timestamp}：${this.contacts.length} 条记录`);
            return true;
        }
        
        try {
            const response = await this.apiFetch(`${this.apiBaseUrl}/api/contacts/${timestamp}`);
            
            let responseData;
            try {
                responseData = await response.json();
            } catch (e) {
                responseData = { error: '无法解析服务器响应' };
            }

            if (!response.ok) {
                const errorMsg = responseData.error || `数据加载失败: ${response.status} ${response.statusText}`;
                throw new Error(errorMsg);
            }
            
            this.rawData = responseData;
            this.processContacts();
            
            // 缓存处理后的数据
            const cacheData = {
                rawData: this.rawData,
                contacts: this.contacts,
                bounds: this.bounds
            };
            cacheManager.set('contacts', String(timestamp), cacheData);
            
            if (this.rawData.length === 0) {
                console.warn(`时间戳 ${timestamp} 没有数据`);
            }
            
            console.log(`[API] 加载时间戳 ${timestamp}：${this.contacts.length} 条记录`);
            return true;
        } catch (error) {
            console.error(`时间戳 ${timestamp} 数据加载失败:`, error);
            alert(`数据加载错误: ${error.message}`);
            return false;
        }
    }

    /**
     * 处理原始数据：更新边界、建立索引
     */
    processContacts() {
        // 重置边界
        this.bounds = { minLat: Infinity, maxLat: -Infinity, minLng: Infinity, maxLng: -Infinity };
        
        // 第一次遍历：确定边界
        for (const record of this.rawData) {
            this.bounds.minLat = Math.min(this.bounds.minLat, record.lat);
            this.bounds.maxLat = Math.max(this.bounds.maxLat, record.lat);
            this.bounds.minLng = Math.min(this.bounds.minLng, record.lng);
            this.bounds.maxLng = Math.max(this.bounds.maxLng, record.lng);
        }

        // 检查边界是否有效
        if (this.bounds.minLat === Infinity) {
            console.warn("未找到有效数据点，使用默认边界");
            this.bounds = {
                minLat: 39.9,
                maxLat: 40.1,
                minLng: 116.3,
                maxLng: 116.5
            };
        }

        // 第二次遍历：合并连续时间段的密接对，建立索引
        const contactMap = new Map(); // key: "id1|id2" (规范化)
        
        for (const record of this.rawData) {
            const [smaller, larger] = record.id1 < record.id2 
                ? [record.id1, record.id2] 
                : [record.id2, record.id1];
            const key = `${smaller}|${larger}`;
            
            if (!contactMap.has(key)) {
                contactMap.set(key, {
                    id1: smaller,
                    id2: larger,
                    timestamps: [record.timestamp],
                    points: [{
                        timestamp: record.timestamp,
                        lng: record.lng,
                        lat: record.lat,
                        contact_type: record.contact_type || 'direct'
                    }],
                    contact_type: record.contact_type || 'direct',
                    through: record.through
                });
            } else {
                const contact = contactMap.get(key);
                contact.timestamps.push(record.timestamp);
                contact.points.push({
                    timestamp: record.timestamp,
                    lng: record.lng,
                    lat: record.lat,
                    contact_type: record.contact_type || 'direct'
                });
            }
        }

        // 将Map转换为数组
        this.contacts = [];
        for (const contact of contactMap.values()) {
            contact.timestamps.sort((a, b) => a - b);
            contact.points.sort((a, b) => a.timestamp - b.timestamp);
            contact.timePeriods = this.mergeTimePeriods(contact.timestamps);
            this.contacts.push(contact);
        }
    }

    /**
     * 合并连续时间段
     */
    mergeTimePeriods(timestamps) {
        if (timestamps.length === 0) return [];

        const periods = [];
        let start = timestamps[0];
        let end = timestamps[0];

        for (let i = 1; i < timestamps.length; i++) {
            if (timestamps[i] === end + 1) {
                end = timestamps[i];
            } else {
                periods.push({ start, end });
                start = timestamps[i];
                end = timestamps[i];
            }
        }
        periods.push({ start, end });

        return periods;
    }

    /**
     * 按用户ID和时间戳查询其所有直接密接对
     */
    async queryUserContacts(userId) {
        // 检查缓存
        const cached = cacheManager.get('userContacts', `direct_${userId}`);
        if (cached) {
            console.log(`[Cache] 从缓存加载用户 ${userId} 的直接密接`);
            this.userContacts[userId] = cached;
            return cached;
        }
        
        try {
            const response = await this.apiFetch(`${this.apiBaseUrl}/api/user/${userId}/contacts`);
            if (!response.ok) {
                throw new Error(`获取密接数据失败: ${response.status} ${response.statusText}`);
            }
            const data = await response.json();
            
            // 处理返回的数据
            this.userContacts[userId] = this.processContactData(data, 'direct');
            // 缓存处理后的数据
            cacheManager.set('userContacts', `direct_${userId}`, this.userContacts[userId]);
            return this.userContacts[userId];
        } catch (error) {
            console.error('密接查询失败:', error);
            alert(`密接查询错误: ${error.message}`);
            return [];
        }
    }

    /**
     * 按用户ID和时间戳查询其次密接对
     */
    async queryUserSecondaryContacts(userId) {
        // 检查缓存
        const cached = cacheManager.get('userContacts', `secondary_${userId}`);
        if (cached) {
            console.log(`[Cache] 从缓存加载用户 ${userId} 的次密接`);
            this.userSecondaryContacts[userId] = cached;
            return cached;
        }
        
        try {
            const response = await this.apiFetch(`${this.apiBaseUrl}/api/user/${userId}/secondary-contacts`);
            if (!response.ok) {
                throw new Error(`获取次密接数据失败: ${response.status} ${response.statusText}`);
            }
            const data = await response.json();
            
            // 处理返回的数据
            this.userSecondaryContacts[userId] = this.processContactData(data, 'indirect');
            // 缓存处理后的数据
            cacheManager.set('userContacts', `secondary_${userId}`, this.userSecondaryContacts[userId]);
            return this.userSecondaryContacts[userId];
        } catch (error) {
            console.error('次密接查询失败:', error);
            alert(`次密接查询错误: ${error.message}`);
            return [];
        }
    }

    /**
     * 处理接触数据为统一格式
     */
    processContactData(data, contactType) {
        const contactMap = new Map();
        
        for (const record of data) {
            const [smaller, larger] = record.id1 < record.id2 
                ? [record.id1, record.id2] 
                : [record.id2, record.id1];
            const key = `${smaller}|${larger}`;
            
            if (!contactMap.has(key)) {
                contactMap.set(key, {
                    id1: smaller,
                    id2: larger,
                    timestamps: [record.timestamp],
                    points: [{
                        timestamp: record.timestamp,
                        lng: record.lng,
                        lat: record.lat,
                        contact_type: record.contact_type || contactType
                    }],
                    contact_type: record.contact_type || contactType,
                    through: record.through
                });
            } else {
                const contact = contactMap.get(key);
                contact.timestamps.push(record.timestamp);
                contact.points.push({
                    timestamp: record.timestamp,
                    lng: record.lng,
                    lat: record.lat,
                    contact_type: record.contact_type || contactType
                });
            }
        }
        
        return Array.from(contactMap.values()).map(contact => {
            contact.timestamps.sort((a, b) => a - b);
            contact.points.sort((a, b) => a.timestamp - b.timestamp);
            contact.timePeriods = this.mergeTimePeriods(contact.timestamps);
            return contact;
        });
    }

    /**
     * 从后端API获取两个用户间的所有接触点轨迹
     */
    async getContactTrajectory(id1, id2) {
        // 规范化参数顺序，保证与后端缓存键一致，并避免(id1,id2)顺序导致的问题
        const a = Math.min(id1, id2);
        const b = Math.max(id1, id2);
        const cacheKey = `${a}_${b}`;
        
        // 检查缓存
        const cached = cacheManager.get('trajectory', cacheKey);
        if (cached) {
            console.log(`[Cache] 从缓存加载轨迹 ${a}-${b}`);
            return cached;
        }
        
        try {
            const response = await this.apiFetch(`${this.apiBaseUrl}/api/trajectory/${a}/${b}`);
            if (!response.ok) {
                throw new Error(`轨迹数据获取失败: ${response.status} ${response.statusText}`);
            }
            const data = await response.json();
            // 缓存轨迹数据
            cacheManager.set('trajectory', cacheKey, data);
            return data;
        } catch (error) {
            console.error('轨迹查询失败:', error);
            alert(`轨迹查询错误: ${error.message}`);
            return [];
        }
    }

    /**
     * 从后端API获取地图边界信息
     */
    async getBoundsInfo() {
        // 检查缓存
        const cached = cacheManager.get('bounds', 'all');
        if (cached) {
            console.log('[Cache] 从缓存加载边界信息');
            return cached;
        }
        
        try {
            const response = await this.apiFetch(`${this.apiBaseUrl}/api/bounds`);
            if (!response.ok) {
                throw new Error(`边界查询失败: ${response.status} ${response.statusText}`);
            }
            const bounds = await response.json();
            const boundsInfo = {
                minLat: bounds.minLat || 39.9,
                maxLat: bounds.maxLat || 40.1,
                minLng: bounds.minLng || 116.3,
                maxLng: bounds.maxLng || 116.5,
                centerLat: ((bounds.minLat + bounds.maxLat) / 2) || 40.0,
                centerLng: ((bounds.minLng + bounds.maxLng) / 2) || 116.4
            };
            // 缓存边界信息
            cacheManager.set('bounds', 'all', boundsInfo);
            return boundsInfo;
        } catch (error) {
            console.error('边界查询失败:', error);
            return {
                minLat: 39.9,
                maxLat: 40.1,
                minLng: 116.3,
                maxLng: 116.5,
                centerLat: 40.0,
                centerLng: 116.4
            };
        }
    }

    /**
     * 获取当前时间戳的所有地点
     */
    getAllLocations() {
        const locations = [];
        for (const record of this.rawData) {
            locations.push({
                lng: record.lng,
                lat: record.lat
            });
        }
        return locations;
    }
}