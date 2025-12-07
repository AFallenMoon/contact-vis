import { Visualization } from './visualization.js';
import { config } from './config.js';
import { config } from './config.js';

/**
 * 轨迹相关方法：挂载到 Visualization 原型上
 */

/**
 * 公共工具：根据轨迹点构建聚合后的 locationGroups 和关键点
 */
function buildTrajectoryData(trajectory) {
    const sortedTrajectory = [...trajectory].sort((a, b) => a.timestamp - b.timestamp);
    const locationGroups = {};

    sortedTrajectory.forEach(point => {
        const key = `${point.lng.toFixed(4)}|${point.lat.toFixed(4)}`;
        if (!locationGroups[key]) {
            locationGroups[key] = {
                lat: point.lat,
                lng: point.lng,
                timestamps: [],
                timePeriods: [],
                contact_type: point.contact_type || 'direct'
            };
        }
        locationGroups[key].timestamps.push(point.timestamp);
    });

    // 时间段合并
    Object.values(locationGroups).forEach(group => {
        // 先对时间戳去重，避免重复的时间戳导致重复的时间段
        group.timestamps = [...new Set(group.timestamps)].sort((a, b) => a - b);
        group.timePeriods = [];
        if (group.timestamps.length === 0) return;
        let start = group.timestamps[0];
        let end = group.timestamps[0];
        for (let i = 1; i < group.timestamps.length; i++) {
            if (group.timestamps[i] === end + 1) {
                end = group.timestamps[i];
            } else {
                group.timePeriods.push({ start, end });
                start = group.timestamps[i];
                end = group.timestamps[i];
            }
        }
        group.timePeriods.push({ start, end });
    });

    const points = sortedTrajectory.map(p => [p.lat, p.lng]);
    const startPoint = points[0];
    const endPoint = points[points.length - 1];

    return { sortedTrajectory, locationGroups, points, startPoint, endPoint };
}

/**
 * 在查询视图中绘制轨迹
 */
Visualization.prototype.drawQueryTrajectory = async function (trajectory, id1, id2) {
    // 确保查询地图已初始化（等待初始化完成）
    await this.initQueryMap();

    // 再次检查地图和标记图层是否存在
    if (!this.map || !this.queryMarkersLayer) {
        console.error('查询地图初始化失败，无法绘制轨迹');
        return;
    }

    // 使用 setTimeout 确保 DOM 已更新
    setTimeout(() => {
        if (!this.map || !this.queryMarkersLayer) {
            console.error('查询地图或标记图层不存在');
            return;
        }

        // 清除现有轨迹Canvas图层（兼容旧逻辑，现已废弃）
        if (this.queryTrajectoryCanvasLayer) {
            this.map.removeLayer(this.queryTrajectoryCanvasLayer);
            this.queryTrajectoryCanvasLayer = null;
        }
        
        // 清除现有轨迹标记和线条（用于点击检测的透明标记 + 折线）
        const layersToRemove = [];
        this.map.eachLayer(layer => {
            if (
                (layer instanceof L.Marker && layer.options && layer.options.isTrajectoryMarker) ||
                (layer instanceof L.Polyline && layer.options && layer.options.isTrajectoryPolyline)
            ) {
                layersToRemove.push(layer);
            }
        });
        layersToRemove.forEach(layer => {
            this.map.removeLayer(layer);
        });
        
        // 确保背景图层存在（如果被误删，重新添加）
        if (this.baseTileLayer && !this.map.hasLayer(this.baseTileLayer)) {
            this.baseTileLayer.addTo(this.map);
        }

        // 更新用户ID显示
        const user1El = document.getElementById('query-traj-user1');
        const user2El = document.getElementById('query-traj-user2');
        if (user1El) user1El.textContent = id1;
        if (user2El) user2El.textContent = id2;

        // 如果轨迹为空，显示提示信息并返回
        if (!trajectory || trajectory.length === 0) {
            const listEl = document.getElementById('query-trajectory-list');
            if (listEl) {
                listEl.innerHTML = `
                    <div class="flex flex-col items-center justify-center py-10 text-sm md:text-base text-slate-500">
                        <p class="mb-1">未找到这两个用户的接触轨迹数据</p>
                        <p class="text-xs md:text-sm text-slate-400">请尝试选择其他密接记录查看</p>
                    </div>
                `;
            }
            return;
        }

        const { sortedTrajectory, locationGroups, points, startPoint, endPoint } = buildTrajectoryData(trajectory);
        
        // 使用标准 Leaflet 折线绘制轨迹
        L.polyline(points, {
            color: config.colors.trajectory.line,
            weight: 4,
            opacity: 0.7,
            lineCap: 'round',
            lineJoin: 'round',
            isTrajectoryPolyline: true
        }).addTo(this.map);
        
        // 起点标记（红色圆点）
        L.circleMarker(startPoint, {
            radius: 7.5,
            fillColor: config.colors.trajectory.start,
            color: 'white',
            weight: 2,
            opacity: 1,
            fillOpacity: 1,
            isTrajectoryMarker: true
        }).addTo(this.queryMarkersLayer).bindPopup(
            `起点<br>
            时间戳: ${sortedTrajectory[0].timestamp}<br>
            纬度: ${startPoint[0].toFixed(6)}<br>
            经度: ${startPoint[1].toFixed(6)}`
        );

        // 终点标记（绿色圆点）
        L.circleMarker(endPoint, {
            radius: 7.5,
            fillColor: config.colors.trajectory.end,
            color: 'white',
            weight: 2,
            opacity: 1,
            fillOpacity: 1,
            isTrajectoryMarker: true
        }).addTo(this.queryMarkersLayer).bindPopup(
            `终点<br>
            时间戳: ${sortedTrajectory[sortedTrajectory.length - 1].timestamp}<br>
            纬度: ${endPoint[0].toFixed(6)}<br>
            经度: ${endPoint[1].toFixed(6)}`
        );

        // 中间点标记（可见小圆点，保留原来的轨迹样式）
        Object.values(locationGroups).forEach((group, index) => {
            if (index === 0 || index === Object.values(locationGroups).length - 1) return;
            const periodText = group.timePeriods.map(p => p.start === p.end ? `${p.start}` : `${p.start} - ${p.end}`).join(', ');
            // 使用与独立轨迹视图类似的小圆点样式
            L.circleMarker([group.lat, group.lng], {
                radius: 5,
                fillColor: config.colors.trajectory.waypoint,
                color: 'white',
                weight: 2,
                opacity: 1,
                fillOpacity: 1,
                isTrajectoryMarker: true
            }).addTo(this.queryMarkersLayer).bindPopup(`
                位置: ${group.lat.toFixed(6)}, ${group.lng.toFixed(6)}<br>
                时间段: ${periodText}<br>
                类型: ${group.contact_type === 'direct' ? '密接' : '次密接'}
            `);
        });

        // 计算边界并调整视图
        const bounds = L.latLngBounds(points);
        // 设置标志，避免 fitBounds 触发缩放事件导致的重绘
        this.isAdjustingQueryMapView = true;
        
        // 确保地图容器大小正确
        this.map.invalidateSize();
        
        // 等待地图大小更新后再调整视图
        setTimeout(() => {
            this.map.fitBounds(bounds, { padding: [50, 50] });
            
            // 等待地图视图调整和瓦片加载完成
            const onMapReady = () => {
                // 强制刷新瓦片图层，确保所有瓦片都加载
                if (this.baseTileLayer) {
                    this.baseTileLayer.redraw();
                }
                
                // 再次调用 invalidateSize 确保地图正确渲染
                this.map.invalidateSize();
                
                // 重置标志
                this.isAdjustingQueryMapView = false;
                
                // 移除一次性事件监听器
                this.map.off('moveend', onMapReady);
                this.map.off('zoomend', onMapReady);
            };
            
            // 监听地图移动和缩放完成事件
            this.map.once('moveend', onMapReady);
            this.map.once('zoomend', onMapReady);
            
            // 如果瓦片图层有加载事件，也监听
            if (this.baseTileLayer) {
                this.baseTileLayer.once('load', () => {
                    setTimeout(() => {
                        this.map.invalidateSize();
                    }, 100);
                });
            }
        }, 100);

        // 轨迹列表（Tailwind 风格表格）
        const listEl = document.getElementById('query-trajectory-list');
        if (listEl) {
            let tableHtml = `
                <div class="overflow-x-auto">
                    <table class="border-collapse text-sm text-slate-700 w-full">
                        <thead>
                            <tr class="bg-slate-50">
                                <th class="border border-slate-200 px-2 py-1.5 text-center text-sm text-slate-600 font-semibold">序号</th>
                                <th class="border border-slate-200 px-2 py-1.5 text-center text-sm text-slate-600 font-semibold">经纬度</th>
                                <th class="border border-slate-200 px-2 py-1.5 text-center text-sm text-slate-600 font-semibold whitespace-nowrap">时间戳</th>
                                <th class="border border-slate-200 px-2 py-1.5 text-center text-sm text-slate-600 font-semibold">接触类型</th>
                            </tr>
                        </thead>
                        <tbody>
            `;
            Object.values(locationGroups).forEach((group, index) => {
                // 显示所有时间戳，用逗号分隔
                const timestampsText = group.timestamps.join(', ');
                const isDirect = group.contact_type === 'direct';
                const badgeClass = isDirect
                    ? 'bg-rose-600'
                    : 'bg-amber-500';
                const badgeText = isDirect ? '密接' : '次密接';
                tableHtml += `
                            <tr class="${index % 2 === 1 ? 'bg-slate-50/60' : ''}">
                                <td class="border border-slate-200 px-2 py-1.5 text-sm text-slate-700 font-mono text-center">${index + 1}</td>
                                <td class="border border-slate-200 px-2 py-1.5 text-sm text-slate-700 text-center">
                                    <span class="font-mono">${group.lat.toFixed(6)}, ${group.lng.toFixed(6)}</span>
                                </td>
                                <td class="border border-slate-200 px-2 py-1.5 text-sm text-slate-700 text-center">
                                    <span class="font-mono">${timestampsText}</span>
                                </td>
                                <td class="border border-slate-200 px-2 py-1.5 text-center">
                                    <span class="inline-flex items-center justify-center rounded-full ${badgeClass} text-white text-sm px-2.5 py-1">
                                        ${badgeText}
                                    </span>
                                </td>
                            </tr>
                `;
            });
            tableHtml += `
                        </tbody>
                    </table>
                </div>
            `;
            listEl.innerHTML = tableHtml;
        }
    }, 150);
};

/**
 * 在主地图上绘制轨迹（用于总览视图）
 */
Visualization.prototype.drawMapTrajectory = function (trajectory, id1, id2) {
    if (!this.map) return;

    setTimeout(() => {
        // 隐藏热力图图层，避免遮挡轨迹
        if (this.heatmapLayer) {
            this.map.removeLayer(this.heatmapLayer);
            this.heatmapLayer = null;
        }
        
        // 清除现有轨迹标记和线条
        // 先收集所有需要删除的轨迹图层（避免遍历时修改集合的问题）
        // 注意：只删除轨迹相关的图层，不删除背景图层和标记图层
        const layersToRemove = [];
        this.map.eachLayer(layer => {
            // 只删除轨迹线条和轨迹标记，不删除背景图层、标记图层等
            if (layer instanceof L.Polyline || 
                (layer instanceof L.Marker && layer.options && layer.options.isTrajectoryMarker)) {
                layersToRemove.push(layer);
            }
        });
        // 删除收集到的图层
        layersToRemove.forEach(layer => {
            this.map.removeLayer(layer);
        });
        
        // 确保背景图层存在（如果被误删，重新添加）
        if (!this.baseTileLayer) {
            // 如果背景图层不存在，重新创建
            // 使用配置的瓦片源
            const tileConfig = config.tileConfig;
            this.baseTileLayer = L.tileLayer(tileConfig.url, {
                subdomains: tileConfig.subdomains,
                maxZoom: tileConfig.maxZoom,
                attribution: tileConfig.attribution
            }).addTo(this.map);
            
            // 启用瓦片检测和重试机制
            this.enableTileValidation(this.baseTileLayer);
        } else if (!this.map.hasLayer(this.baseTileLayer)) {
            this.baseTileLayer.addTo(this.map);
        }
        
        // 确保地图容器大小正确
        this.map.invalidateSize();
        
        // 强制刷新背景图层，确保瓦片加载
        if (this.baseTileLayer) {
            this.baseTileLayer.redraw();
        }

        // 更新用户ID显示
        const user1El = document.getElementById('new-contacts-traj-user1');
        const user2El = document.getElementById('new-contacts-traj-user2');
        if (user1El) user1El.textContent = id1;
        if (user2El) user2El.textContent = id2;

        if (trajectory.length === 0) {
            const listEl = document.getElementById('new-contacts-trajectory-list');
            if (listEl) {
                listEl.innerHTML = `
                    <div class="flex flex-col items-center justify-center py-10 text-sm md:text-base text-slate-500">
                        <p class="mb-1">未找到这两个用户的接触轨迹数据</p>
                        <p class="text-xs md:text-sm text-slate-400">请尝试选择其他密接记录查看</p>
                    </div>
                `;
            }
            return;
        }

        const { sortedTrajectory, locationGroups, points, startPoint, endPoint } = buildTrajectoryData(trajectory);
        
        // 使用标准 Leaflet 折线绘制轨迹
        const polyline = L.polyline(points, {
            color: config.colors.trajectory.line,
            weight: 4,
            opacity: 0.7,
            lineCap: 'round',
            lineJoin: 'round',
            isTrajectoryPolyline: true
        }).addTo(this.map);
        
        // 添加标记用于点击检测和弹出框
        // 起点标记（红色圆点）
        L.circleMarker(startPoint, {
            radius: 7.5,
            fillColor: config.colors.trajectory.start,
            color: 'white',
            weight: 2,
            opacity: 1,
            fillOpacity: 1,
            isTrajectoryMarker: true
        }).addTo(this.map).bindPopup(
            `起点<br>
            时间戳: ${sortedTrajectory[0].timestamp}<br>
            纬度: ${startPoint[0].toFixed(6)}<br>
            经度: ${startPoint[1].toFixed(6)}`
        );

        // 终点标记（绿色圆点）
        L.circleMarker(endPoint, {
            radius: 7.5,
            fillColor: config.colors.trajectory.end,
            color: 'white',
            weight: 2,
            opacity: 1,
            fillOpacity: 1,
            isTrajectoryMarker: true
        }).addTo(this.map).bindPopup(
            `终点<br>
            时间戳: ${sortedTrajectory[sortedTrajectory.length - 1].timestamp}<br>
            纬度: ${endPoint[0].toFixed(6)}<br>
            经度: ${endPoint[1].toFixed(6)}`
        );

        // 中间点标记（可见小圆点，保留原来的轨迹样式）
        Object.values(locationGroups).forEach((group, index) => {
            if (index === 0 || index === Object.values(locationGroups).length - 1) return;
            const periodText = group.timePeriods.map(p => p.start === p.end ? `${p.start}` : `${p.start} - ${p.end}`).join(', ');
            // 使用与独立轨迹视图类似的小圆点样式
            L.circleMarker([group.lat, group.lng], {
                radius: 5,
                fillColor: config.colors.trajectory.waypoint,
                color: 'white',
                weight: 2,
                opacity: 1,
                fillOpacity: 1,
                isTrajectoryMarker: true
            }).addTo(this.map).bindPopup(`
                位置: ${group.lat.toFixed(6)}, ${group.lng.toFixed(6)}<br>
                时间段: ${periodText}<br>
                类型: ${group.contact_type === 'direct' ? '密接' : '次密接'}
            `);
        });

        // 计算边界并调整视图
        const bounds = L.latLngBounds(points);
        
        // 先确保地图容器大小正确
        this.map.invalidateSize();
        
        // 等待地图容器大小更新后再调整视图
        setTimeout(() => {
            // 再次确保地图大小正确
            this.map.invalidateSize();
            
            // 先设置视图到边界中心，确保地图先定位到大致位置
            const center = bounds.getCenter();
            this.map.setView(center, this.map.getZoom(), { animate: false });
            
            // 等待地图视图稳定
            setTimeout(() => {
                // 调整视图到轨迹边界
                this.map.fitBounds(bounds, { 
                    padding: [50, 50],
                    animate: false,
                    maxZoom: 18
                });
                
                // 等待地图视图调整完成后再刷新瓦片
                setTimeout(() => {
                    // 强制刷新瓦片图层，确保所有瓦片都加载
                    if (this.baseTileLayer) {
                        this.baseTileLayer.redraw();
                    }
                    
                    // 再次调用 invalidateSize 确保地图正确渲染
                    this.map.invalidateSize();
                }, 300);
            }, 200);
        }, 300);

        // 轨迹列表（Tailwind 风格表格）
        const listEl = document.getElementById('new-contacts-trajectory-list');
        if (listEl) {
            let tableHtml = `
                <div class="overflow-x-auto">
                    <table class="border-collapse text-sm text-slate-700 w-full">
                        <thead>
                            <tr class="bg-slate-50">
                                <th class="border border-slate-200 px-2 py-1.5 text-center text-sm text-slate-600 font-semibold">序号</th>
                                <th class="border border-slate-200 px-2 py-1.5 text-center text-sm text-slate-600 font-semibold">经纬度</th>
                                <th class="border border-slate-200 px-2 py-1.5 text-center text-sm text-slate-600 font-semibold whitespace-nowrap">时间戳</th>
                                <th class="border border-slate-200 px-2 py-1.5 text-center text-sm text-slate-600 font-semibold">接触类型</th>
                            </tr>
                        </thead>
                        <tbody>
            `;
            Object.values(locationGroups).forEach((group, index) => {
                // 显示所有时间戳，用逗号分隔
                const timestampsText = group.timestamps.join(', ');
                const isDirect = group.contact_type === 'direct';
                const badgeClass = isDirect
                    ? 'bg-rose-600'
                    : 'bg-amber-500';
                const badgeText = isDirect ? '密接' : '次密接';
                tableHtml += `
                            <tr class="${index % 2 === 1 ? 'bg-slate-50/60' : ''}">
                                <td class="border border-slate-200 px-2 py-1.5 text-sm text-slate-700 font-mono text-center">${index + 1}</td>
                                <td class="border border-slate-200 px-2 py-1.5 text-sm text-slate-700 text-center">
                                    <span class="font-mono">${group.lat.toFixed(6)}, ${group.lng.toFixed(6)}</span>
                                </td>
                                <td class="border border-slate-200 px-2 py-1.5 text-sm text-slate-700 text-center">
                                    <span class="font-mono">${timestampsText}</span>
                                </td>
                                <td class="border border-slate-200 px-2 py-1.5 text-center">
                                    <span class="inline-flex items-center justify-center rounded-full ${badgeClass} text-white text-sm px-2.5 py-1">
                                        ${badgeText}
                                    </span>
                                </td>
                            </tr>
                `;
            });
            tableHtml += `
                        </tbody>
                    </table>
                </div>
            `;
            listEl.innerHTML = tableHtml;
        }
    }, 300);
};

/**
 * 独立轨迹视图（右侧单独轨迹地图）
 */
Visualization.prototype.drawTrajectory = function (trajectory, id1, id2) {
    if (!this.trajectoryMap) {
        this.trajectoryMap = L.map('trajectory-map', {
            minZoom: 0,  // 允许缩放到最小级别
            maxZoom: 19, // 允许缩放到最大级别
            attributionControl: false // 不显示默认的版权标签
        }).setView([0, 0], 13);
        // 使用配置的瓦片源
        const tileConfig = config.tileConfig;
        const trajectoryTileLayer = L.tileLayer(tileConfig.url, {
            subdomains: tileConfig.subdomains,
            maxZoom: tileConfig.maxZoom,
            attribution: tileConfig.attribution
        }).addTo(this.trajectoryMap);
        
        // 启用瓦片检测和重试机制
        this.enableTileValidation(trajectoryTileLayer);
    } else {
        this.trajectoryMap.eachLayer(layer => {
            if (layer instanceof L.Marker || layer instanceof L.Polyline) {
                this.trajectoryMap.removeLayer(layer);
            }
        });
    }

    document.getElementById('traj-user1').textContent = id1;
    document.getElementById('traj-user2').textContent = id2;

    if (trajectory.length === 0) {
        document.getElementById('trajectory-list').innerHTML = `
            <div class="flex flex-col items-center justify-center py-10 text-sm md:text-base text-slate-500">
                <p class="mb-1">未找到这两个用户的接触轨迹数据</p>
                <p class="text-xs md:text-sm text-slate-400">请尝试选择其他密接记录查看</p>
            </div>
        `;
        return;
    }

    const sortedTrajectory = [...trajectory].sort((a, b) => a.timestamp - b.timestamp);
    const locationGroups = {};
    sortedTrajectory.forEach(point => {
        const key = `${point.lng.toFixed(4)}|${point.lat.toFixed(4)}`;
        if (!locationGroups[key]) {
            locationGroups[key] = {
                lat: point.lat,
                lng: point.lng,
                timestamps: [],
                timePeriods: [],
                contact_type: point.contact_type || 'direct'
            };
        }
        locationGroups[key].timestamps.push(point.timestamp);
    });

    // 时间段合并
    Object.values(locationGroups).forEach(group => {
        // 先对时间戳去重，避免重复的时间戳导致重复的时间段
        group.timestamps = [...new Set(group.timestamps)].sort((a, b) => a - b);
        group.timePeriods = [];
        if (group.timestamps.length === 0) return;
        let start = group.timestamps[0];
        let end = group.timestamps[0];
        for (let i = 1; i < group.timestamps.length; i++) {
            if (group.timestamps[i] === end + 1) {
                end = group.timestamps[i];
            } else {
                group.timePeriods.push({ start, end });
                start = group.timestamps[i];
                end = group.timestamps[i];
            }
        }
        group.timePeriods.push({ start, end });
    });

    const points = sortedTrajectory.map(p => [p.lat, p.lng]);
    const trackLine = L.polyline(points, {
        color: config.colors.trajectory.line,
        weight: 4,
        opacity: 0.7,
        lineJoin: 'round'
    }).addTo(this.trajectoryMap);

    // 起点标记
    L.marker(points[0], {
        icon: L.divIcon({
            html: `<div style="background-color: ${config.colors.trajectory.start}; width: 15px; height: 15px; border-radius: 50%; border: 2px solid white;"></div>`,
            iconSize: [15, 15],
            iconAnchor: [7.5, 7.5]
        })
    }).addTo(this.trajectoryMap).bindPopup(
        `起点<br>
        时间戳: ${sortedTrajectory[0].timestamp}<br>
        纬度: ${points[0][0].toFixed(6)}<br>
        经度: ${points[0][1].toFixed(6)}`
    );

    // 终点标记
    L.marker(points[points.length - 1], {
        icon: L.divIcon({
            html: `<div style="background-color: ${config.colors.trajectory.end}; width: 15px; height: 15px; border-radius: 50%; border: 2px solid white;"></div>`,
            iconSize: [15, 15],
            iconAnchor: [7.5, 7.5]
        })
    }).addTo(this.trajectoryMap).bindPopup(
        `终点<br>
        时间戳: ${sortedTrajectory[sortedTrajectory.length - 1].timestamp}<br>
        纬度: ${points[points.length - 1][0].toFixed(6)}<br>
        经度: ${points[points.length - 1][1].toFixed(6)}`
    );

    // 中间点标记
    Object.values(locationGroups).forEach((group, index) => {
        if (index === 0 || index === Object.values(locationGroups).length - 1) return;
        const periodText = group.timePeriods.map(p => p.start === p.end ? `${p.start}` : `${p.start} - ${p.end}`).join(', ');
        L.marker([group.lat, group.lng], {
            icon: L.divIcon({
                html: `<div style="background-color: ${config.colors.trajectory.waypoint}; width: 12px; height: 12px; border-radius: 50%; border: 2px solid white;"></div>`,
                iconSize: [12, 12],
                iconAnchor: [6, 6]
            })
        }).addTo(this.trajectoryMap).bindPopup(`
            位置: ${group.lat.toFixed(6)}, ${group.lng.toFixed(6)}<br>
            时间段: ${periodText}<br>
            类型: ${group.contact_type === 'direct' ? '密接' : '次密接'}
        `);
    });

    this.trajectoryMap.fitBounds(trackLine.getBounds(), { padding: [50, 50] });

    // 轨迹列表（Tailwind 风格表格）
    let tableHtml = `
        <div class="overflow-x-auto">
            <table class="min-w-full border-collapse text-sm text-slate-700">
                <thead>
                    <tr class="bg-slate-50">
                        <th class="border border-slate-200 px-2 py-1.5 text-left text-sm text-slate-600 font-semibold w-12">序号</th>
                        <th class="border border-slate-200 px-2 py-1.5 text-left text-sm text-slate-600 font-semibold">经纬度</th>
                        <th class="border border-slate-200 px-2 py-1.5 text-left text-sm text-slate-600 font-semibold whitespace-nowrap w-24">时间段</th>
                        <th class="border border-slate-200 px-2 py-1.5 text-left text-sm text-slate-600 font-semibold w-20">接触类型</th>
                    </tr>
                </thead>
                <tbody>
    `;
    Object.values(locationGroups).forEach((group, index) => {
        const periodText = group.timePeriods
            .map(p => p.start === p.end ? `${p.start}` : `${p.start} - ${p.end}`)
            .join('<br>');
        const isDirect = group.contact_type === 'direct';
        const badgeClass = isDirect
            ? 'bg-rose-600'
            : 'bg-amber-500';
        const badgeText = isDirect ? '密接' : '次密接';
        tableHtml += `
                    <tr class="${index % 2 === 1 ? 'bg-slate-50/60' : ''}">
                        <td class="border border-slate-200 px-2 py-1.5 text-sm text-slate-700 font-mono">${index + 1}</td>
                        <td class="border border-slate-200 px-2 py-1.5 text-sm text-slate-700">
                            <span class="font-mono">${group.lat.toFixed(6)}, ${group.lng.toFixed(6)}</span>
                        </td>
                        <td class="border border-slate-200 px-2 py-1.5 text-sm text-slate-700">
                            <span class="font-mono leading-4">${periodText}</span>
                        </td>
                        <td class="border border-slate-200 px-2 py-1.5">
                            <span class="inline-flex items-center rounded-full ${badgeClass} text-white text-sm px-2 py-0.5">
                                ${badgeText}
                            </span>
                        </td>
                    </tr>
        `;
    });
    tableHtml += `
                </tbody>
            </table>
        </div>
    `;
    document.getElementById('trajectory-list').innerHTML = tableHtml;
};


