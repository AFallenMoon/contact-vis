import { DataLoader } from './data-loader.js';
import { Visualization } from './visualization.js';
import { config } from './config.js';
import './visualization-trajectory.js'; // 必须在 Visualization 导入后加载，用于扩展原型

/**
 * 应用主程序 - 事件处理和界面控制
 */
export class App {
    constructor() {
        this.initialized = false;
        this.currentQueryUserId = null;
        this.currentView = 'map-view';
        this.dataLoader = new DataLoader();
        this.visualization = new Visualization(this.dataLoader);
    }

    /**
     * 初始化应用
     */
    async init() {
        try {
            // 设置全局引用，供其他模块使用
            window.app = this;
            
            // 初始化数据（获取时间戳和第一个时间戳数据）
            const success = await this.dataLoader.initData();
            if (!success) {
                console.error('数据初始化失败，应用可能无法正常工作');
            }

            // 初始化地图
            this.visualization.initMap();
            
            // 初始化事件监听
            this.setupEventListeners();
            
            // 确保导航按钮的初始状态正确（包括 hover 类）
            this.switchView('map-view');

            // 只有当有数据时才初始化动画
            if (this.dataLoader.allTimestamps.length > 0) {
                this.visualization.initMapAnimation();
                this.visualization.drawMapAtTimestamp(this.visualization.mapAnimation.currentTimestamp);
                
                // 更新统计信息（在元素存在时才更新，避免空节点导致报错）
                const totalEl = document.getElementById('total-contacts');
                if (totalEl) {
                    const count = this.dataLoader.contacts.length;
                    totalEl.textContent = count;
                    // 更新原点颜色（根据对数大小变色，类似热力图）
                    this.updateContactCountDotColor(count);
                }
                
                // 更新边界信息
                const bounds = this.dataLoader.bounds;
                const boundsEl = document.getElementById('bounds-info');
                if (boundsEl && bounds && typeof bounds.minLat === 'number') {
                    boundsEl.textContent = 
                        `纬度: ${bounds.minLat.toFixed(4)} - ${bounds.maxLat.toFixed(4)}, ` +
                        `经度: ${bounds.minLng.toFixed(4)} - ${bounds.maxLng.toFixed(4)}`;
                }
            } else {
                console.warn('没有可用数据，动画功能已禁用');
                const totalEl = document.getElementById('total-contacts');
                if (totalEl) {
                    totalEl.textContent = '0';
                    // 更新原点颜色
                    this.updateContactCountDotColor(0);
                }
            }

            this.initialized = true;
        } catch (error) {
            console.error('应用初始化失败:', error);
            alert(`应用初始化错误: ${error.message}\n请检查浏览器控制台了解详情`);
        }
    }

    /**
     * 设置事件监听器
     */
    setupEventListeners() {
        // 导航标签页（使用 Tailwind 类切换样式）
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.addEventListener('click', () => this.switchView(btn.dataset.view));
        });

        // 查询按钮
        document.getElementById('query-btn').addEventListener('click', () => {
            const userId = document.getElementById('user-id-input').value.trim();
            if (userId) {
                this.queryUser(parseInt(userId));
            }
        });

        // 重置按钮
        document.getElementById('reset-btn').addEventListener('click', () => {
            document.getElementById('user-id-input').value = '';
            document.getElementById('query-results').innerHTML = `
                <div class="text-sm md:text-base text-slate-500 text-center py-8">
                    请输入用户 ID 以查看该用户的密接与次密接记录
                </div>
            `;
            this.currentQueryUserId = null;
            // 返回结果列表视图
            this.backToQueryResults();
        });

        // 返回结果列表按钮
        const backToResultsBtn = document.getElementById('back-to-results-btn');
        if (backToResultsBtn) {
            backToResultsBtn.addEventListener('click', () => {
                this.backToQueryResults();
            });
        }

        // 返回新增密接列表按钮
        const backToNewContactsListBtn = document.getElementById('back-to-new-contacts-list-btn');
        if (backToNewContactsListBtn) {
            backToNewContactsListBtn.addEventListener('click', () => {
                this.backToNewContactsList();
            });
        }

        // 回车查询
        document.getElementById('user-id-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                const userId = document.getElementById('user-id-input').value.trim();
                if (userId) {
                    this.queryUser(parseInt(userId));
                }
            }
        });

        // 时间轴控件事件
        const firstBtn = document.getElementById('first-btn');
        const rewindBtn = document.getElementById('rewind-btn');
        const playBtn = document.getElementById('play-btn');
        const pauseBtn = document.getElementById('pause-btn');
        const forwardBtn = document.getElementById('forward-btn');
        const lastBtn = document.getElementById('last-btn');

        if (firstBtn) firstBtn.onclick = () => {
            if (this.dataLoader.allTimestamps.length > 0) {
                this.visualization.setTimestamp(this.dataLoader.allTimestamps[0]);
            }
        };
        if (rewindBtn) rewindBtn.onclick = () => this.visualization.prevTimestamp(3);
        if (forwardBtn) forwardBtn.onclick = () => this.visualization.nextTimestamp(3);
        if (playBtn) playBtn.onclick = () => {
            if (this.dataLoader.allTimestamps.length === 0) {
                alert('没有可用数据，无法播放动画');
                return;
            }
            this.visualization.playMapAnimation();
        };
        if (pauseBtn) pauseBtn.onclick = () => this.visualization.pauseMapAnimation();
        if (lastBtn) lastBtn.onclick = () => {
            if (this.dataLoader.allTimestamps.length > 0) {
                this.visualization.setTimestamp(this.dataLoader.allTimestamps[this.dataLoader.allTimestamps.length - 1]);
            }
        };

        // 倍速切换按钮（轮切：1x → 2x → 5x → 10x → 1x）
        const speedBtn = document.getElementById('playback-speed-btn');
        if (speedBtn) {
            speedBtn.onclick = () => {
                const currentSpeed = this.visualization.mapAnimation.playbackSpeed;
                const speeds = [1, 2, 5, 10];
                const currentIndex = speeds.indexOf(currentSpeed);
                const nextIndex = (currentIndex + 1) % speeds.length;
                this.visualization.setPlaybackSpeed(speeds[nextIndex]);
            };
        }

        // 窗口resize时重新绘制
        window.addEventListener('resize', () => {
            if (this.currentView === 'map-view' && this.visualization.map) {
                this.visualization.map.invalidateSize();
                if (this.dataLoader.rawData.length > 0) {
                    this.visualization.drawMapAtTimestamp(this.visualization.mapAnimation.currentTimestamp);
                }
            }
        });

    }



    /**
     * 切换视图
     */
    switchView(viewName) {
        // 切换导航按钮样式（使用 Tailwind utility classes）
        document.querySelectorAll('.nav-btn').forEach(btn => {
            const isActive = btn.dataset.view === viewName;
            const dataView = btn.dataset.view || btn.getAttribute('data-view') || '';
            
            // 基础类
            const baseClasses = 'px-4 py-2 rounded-lg text-sm font-medium transition';
            
            if (isActive) {
                // 激活状态：黑色背景，悬浮时保持不变
                btn.className = `nav-btn active ${baseClasses} border border-slate-900 bg-slate-900 hover:bg-slate-900 text-white`;
            } else {
                // 未激活状态：白色背景，悬浮时稍微加深
                btn.className = `nav-btn ${baseClasses} bg-white text-slate-700 border border-slate-200 hover:bg-slate-50`;
            }
            
            // 确保 data-view 属性存在
            btn.setAttribute('data-view', dataView);
        });

        // 切换视图容器可见性（通过 Tailwind 的 hidden/block）
        document.querySelectorAll('.view-container').forEach(view => {
            if (view.id === viewName) {
                view.classList.remove('hidden');
                view.classList.add('block');
            } else {
                view.classList.remove('block');
                view.classList.add('hidden');
            }
        });
        
        // 移动共享的地图容器到当前视图（不重新初始化，避免闪烁）
        if ((viewName === 'map-view' || viewName === 'query-view') && this.visualization) {
            const mapContainer = document.getElementById('map-container');
            const targetWrapperId = viewName === 'map-view' ? 'map-container-wrapper-map' : 'map-container-wrapper-query';
            const targetWrapper = document.getElementById(targetWrapperId);
            
            if (mapContainer && targetWrapper) {
                // 如果地图容器不在目标位置，移动它
                if (mapContainer.parentElement !== targetWrapper) {
                    // 显示地图容器
                    mapContainer.style.display = '';
                    // 移动到目标位置
                    targetWrapper.appendChild(mapContainer);
                }
                
                // 如果地图未初始化，初始化它
                if (!this.visualization.map) {
                    this.visualization.initMap();
                } else {
                    // 地图已存在，只需要刷新大小（延迟以确保DOM已更新）
                    setTimeout(() => {
                        if (this.visualization.map) {
                            this.visualization.map.invalidateSize();
                        }
                    }, 50);
                }
            }
        }

        this.currentView = viewName;

        // 当切换到查询视图时，确保查询标记图层已初始化
        if (viewName === 'query-view') {
            // 隐藏地图导览的热力图层，显示查询图层
            if (this.visualization.heatmapLayer && this.visualization.map && this.visualization.map.hasLayer(this.visualization.heatmapLayer)) {
                this.visualization.map.removeLayer(this.visualization.heatmapLayer);
            }
            if (this.visualization.markersLayer) {
                this.visualization.markersLayer.clearLayers();
            }
            if (this.visualization.legendControl && this.visualization.legendControl._map === this.visualization.map) {
                this.visualization.map.removeControl(this.visualization.legendControl);
            }
            
            // 确保背景图层存在
            if (this.visualization.map && this.visualization.baseTileLayer && !this.visualization.map.hasLayer(this.visualization.baseTileLayer)) {
                this.visualization.baseTileLayer.addTo(this.visualization.map);
            }
            
            this.visualization.initQueryMap();
            // 初始化切换按钮，确保即使没有数据时也能切换
            this.visualization.initContactTypeButtons();
            
            // 仅刷新地图大小，避免重新绘制或强制重载瓦片，减少闪烁
            setTimeout(() => {
                if (this.visualization.map) {
                    this.visualization.map.invalidateSize();
                }
            }, 200);
        }

        if (viewName === 'map-view' && this.visualization.map) {
            // 隐藏查询相关的图层，显示地图导览的图层
            if (this.visualization.queryMarkersLayer) {
                this.visualization.queryMarkersLayer.clearLayers();
            }
            if (this.visualization.queryCanvasLayer && this.visualization.map.hasLayer(this.visualization.queryCanvasLayer)) {
                this.visualization.map.removeLayer(this.visualization.queryCanvasLayer);
            }
            if (this.visualization.queryHeatmapLayer && this.visualization.map.hasLayer(this.visualization.queryHeatmapLayer)) {
                this.visualization.map.removeLayer(this.visualization.queryHeatmapLayer);
            }
            if (this.visualization.queryLegendControl && this.visualization.queryLegendControl._map === this.visualization.map) {
                this.visualization.map.removeControl(this.visualization.queryLegendControl);
            }
            // 不再在视图切换时强制重绘/重置地图，只保留一次性初始化逻辑
            // 地图上的当前状态（缩放、中心、当前时间戳的点/轨迹）保持不变
        }
    }

    /**
     * 查询用户的所有密接对和次密接对（当前时间戳）
     */
    async queryUser(userId) {
        if (isNaN(userId)) {
            alert('请输入有效的用户ID（数字）');
            return;
        }
        
        document.getElementById('user-id-input').value = userId;
        this.currentQueryUserId = userId;

        // 获取当前时间戳
        const currentTimestamp = this.visualization.mapAnimation.currentTimestamp;
        
        // 查询数据：同时获取密接和次密接
        const contacts = await this.dataLoader.queryUserContacts(userId);
        const secondaryContacts = await this.dataLoader.queryUserSecondaryContacts(userId);

        // 渲染结果
        this.visualization.renderQueryResults(userId, contacts, secondaryContacts);

        // 确保显示结果列表视图
        this.backToQueryResults();

        if (!document.getElementById('query-view').classList.contains('active')) {
            this.switchView('query-view');
        }
    }

    /**
     * 显示接触轨迹（在查询视图内）
     */
    async showTrajectory(id1, id2) {
        if (isNaN(id1) || isNaN(id2)) {
            console.error('无效的用户ID:', id1, id2);
            return;
        }
        
        // 确保在查询视图中
        if (this.currentView !== 'query-view') {
            this.switchView('query-view');
        }
        
        // 隐藏结果列表，显示轨迹明细卡片
        const resultsContainer = document.getElementById('query-results-container');
        const trajectoryDetail = document.getElementById('query-trajectory-detail');
        
        if (resultsContainer) resultsContainer.classList.add('hidden');
        if (trajectoryDetail) trajectoryDetail.classList.remove('hidden');
        
        // 获取轨迹数据并绘制
        const trajectory = await this.dataLoader.getContactTrajectory(id1, id2);
        // drawQueryTrajectory 现在是 async 函数，直接调用即可（内部会等待地图初始化）
        await this.visualization.drawQueryTrajectory(trajectory, id1, id2);
    }

    /**
     * 返回查询结果列表
     */
    backToQueryResults() {
        const resultsContainer = document.getElementById('query-results-container');
        const trajectoryDetail = document.getElementById('query-trajectory-detail');
        
        if (resultsContainer) resultsContainer.classList.remove('hidden');
        if (trajectoryDetail) trajectoryDetail.classList.add('hidden');
        
        // 恢复密接接触点的显示
        if (this.visualization.queryContactMarkers) {
            this.visualization.queryContactMarkers.forEach(marker => {
                if (marker && marker._map) {
                    if (typeof marker.setOpacity === 'function') {
                        marker.setOpacity(1);
                    } else if (typeof marker.setStyle === 'function') {
                        marker.setStyle({ opacity: 1, fillOpacity: 0.9 });
                    }
                }
            });
        }

        // 清除查询视图中已绘制的轨迹（折线 + 轨迹标记，包括 CircleMarker 和 Marker）
        if (this.visualization.map) {
            const layersToRemove = [];
            this.visualization.map.eachLayer(layer => {
                if (
                    ((layer instanceof L.Marker || layer instanceof L.CircleMarker) && layer.options && layer.options.isTrajectoryMarker) ||
                    (layer instanceof L.Polyline && layer.options && layer.options.isTrajectoryPolyline)
                ) {
                    layersToRemove.push(layer);
                }
            });
            layersToRemove.forEach(layer => this.visualization.map.removeLayer(layer));
        }

        // 同时清除查询图层中用于轨迹的标记（queryMarkersLayer 内部的起点 / 终点 / 中途点）
        if (this.visualization.queryMarkersLayer) {
            const toRemove = [];
            this.visualization.queryMarkersLayer.eachLayer(layer => {
                if (layer.options && layer.options.isTrajectoryMarker) {
                    toRemove.push(layer);
                }
            });
            toRemove.forEach(layer => this.visualization.queryMarkersLayer.removeLayer(layer));
        }
    }

    /**
     * 在总览视图中显示新增密接的轨迹明细
     */
    async showNewContactsTrajectory(id1, id2) {
        if (isNaN(id1) || isNaN(id2)) {
            console.error('无效的用户ID:', id1, id2);
            return;
        }
        
        // 确保在总览视图中
        if (this.currentView !== 'map-view') {
            this.switchView('map-view');
        }
        
        // 隐藏新增密接列表容器，显示轨迹明细卡片
        const newContactsContainer = document.getElementById('new-contacts-container');
        const trajectoryDetail = document.getElementById('new-contacts-trajectory-detail');
        
        if (newContactsContainer) {
            newContactsContainer.classList.add('hidden');
        }
        if (trajectoryDetail) {
            trajectoryDetail.classList.remove('hidden');
        }
        
        // 获取轨迹数据
        const trajectory = await this.dataLoader.getContactTrajectory(id1, id2);
        
        // 等待视图切换完成，确保地图容器可见
        setTimeout(() => {
            // 确保地图容器大小正确
            if (this.visualization.map) {
                this.visualization.map.invalidateSize();
            }
            
            // 等待地图容器稳定后再绘制轨迹
            setTimeout(() => {
                this.visualization.drawMapTrajectory(trajectory, id1, id2);
            }, 300);
        }, 200);
    }

    /**
     * 返回新增密接列表
     */
    backToNewContactsList() {
        const newContactsContainer = document.getElementById('new-contacts-container');
        const trajectoryDetail = document.getElementById('new-contacts-trajectory-detail');
        
        if (newContactsContainer) newContactsContainer.classList.remove('hidden');
        if (trajectoryDetail) trajectoryDetail.classList.add('hidden');
        
        // 恢复主地图上被隐藏的密接接触点标记样式
        if (this.visualization.mapContactMarkers) {
            this.visualization.mapContactMarkers.forEach(marker => {
                if (marker && marker._map) {
                    if (typeof marker.setOpacity === 'function') {
                        marker.setOpacity(1);
                    } else if (typeof marker.setStyle === 'function') {
                        marker.setStyle({ opacity: 1, fillOpacity: 0.9 });
                    }
                }
            });
        }

        // 清除主地图上的轨迹（折线 + 轨迹标记，包括 CircleMarker 和 Marker）
        if (this.visualization.map) {
            this.visualization.map.eachLayer(layer => {
                if (
                    layer instanceof L.Polyline ||
                    ((layer instanceof L.Marker || layer instanceof L.CircleMarker) && layer.options && layer.options.isTrajectoryMarker)
                ) {
                    this.visualization.map.removeLayer(layer);
                }
            });
            // 重新绘制当前时间戳的地图
            if (this.dataLoader.allTimestamps.length > 0) {
                this.visualization.drawMapAtTimestamp(this.visualization.mapAnimation.currentTimestamp);
            }
        }
    }

    /**
     * 根据密接对数更新原点颜色（与热力图渐变一致）
     */
    updateContactCountDotColor(count) {
        const dotEl = document.getElementById('total-contacts-dot');
        if (!dotEl) return;

        // 定义颜色渐变范围（与热力图完全一致：blue -> cyan -> lime -> yellow -> red）
        // 在 10000 时达到最右侧颜色（红色）
        const maxCount = 10000;
        const normalized = Math.min(count / maxCount, 1); // 归一化到 0-1

        // 使用统一的颜色配置
        const colors = config.colors.heatmap;

        let color;
        if (normalized === 0) {
            color = colors.blue;
        } else if (normalized <= 0.5) {
            // 0.0 -> 0.5: blue 到 cyan
            const t = normalized / 0.5;
            color = this.interpolateColor(colors.blue, colors.cyan, t);
        } else if (normalized <= 0.7) {
            // 0.5 -> 0.7: cyan 到 lime
            const t = (normalized - 0.5) / 0.2;
            color = this.interpolateColor(colors.cyan, colors.lime, t);
        } else if (normalized <= 0.9) {
            // 0.7 -> 0.9: lime 到 yellow
            const t = (normalized - 0.7) / 0.2;
            color = this.interpolateColor(colors.lime, colors.yellow, t);
        } else {
            // 0.9 -> 1.0: yellow 到 red
            const t = (normalized - 0.9) / 0.1;
            color = this.interpolateColor(colors.yellow, colors.red, t);
        }

        dotEl.style.backgroundColor = color;
    }

    /**
     * 颜色插值函数
     */
    interpolateColor(color1, color2, t) {
        const hex1 = color1.replace('#', '');
        const hex2 = color2.replace('#', '');
        
        const r1 = parseInt(hex1.substring(0, 2), 16);
        const g1 = parseInt(hex1.substring(2, 4), 16);
        const b1 = parseInt(hex1.substring(4, 6), 16);
        
        const r2 = parseInt(hex2.substring(0, 2), 16);
        const g2 = parseInt(hex2.substring(2, 4), 16);
        const b2 = parseInt(hex2.substring(4, 6), 16);
        
        const r = Math.round(r1 + (r2 - r1) * t);
        const g = Math.round(g1 + (g2 - g1) * t);
        const b = Math.round(b1 + (b2 - b1) * t);
        
        return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    }
}