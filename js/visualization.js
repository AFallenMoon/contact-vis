/**
 * 可视化模块 - 集成Leaflet地图（优化大数据量处理）
 */
export class Visualization {
    constructor(dataLoader) {
        this.dataLoader = dataLoader;
        this.map = null;          // 主地图实例（地图导览和密接对查询共享）
        this.trajectoryMap = null; // 轨迹视图地图实例
        this.markersLayer = null; // 标记图层
        this.queryMarkersLayer = null; // 查询专用标记图层（与markersLayer分离，用于查询结果）
        this.legendControl = null; // 图例控件
        this.queryLegendControl = null; // 查询地图图例控件
        this.displayMode = 'all'; // 显示模式: 'all' 全部, 'direct' 密接, 'indirect' 次密接
        this.queryContactType = 'direct'; // 查询结果当前显示类型: 'direct' 密接, 'indirect' 次密接
        this.currentDirectContacts = []; // 当前查询的直接密接数据
        this.currentSecondaryContacts = []; // 当前查询的次密接数据
        this.currentQueryUserId = null; // 当前查询的用户ID
        this.isAdjustingQueryMapView = false; // 标志：是否正在程序性调整查询地图视图
        this.queryContactMarkers = []; // 保存查询结果地图上的密接接触点标记，用于在绘制轨迹时隐藏
        this.mapContactMarkers = []; // 保存主地图上的密接接触点标记，用于在绘制轨迹时隐藏
        this.visualizationMode = 'points'; // 可视化模式: 'points' 标记点, 'heatmap' 热力图
        this.heatmapLayer = null; // 热力图层
        this.queryHeatmapLayer = null; // 查询地图热力图层
        this.visualizationControl = null; // 可视化模式切换控件
        this.baseTileLayer = null; // 主地图背景图层引用
        // 不再需要queryBaseTileLayer，统一使用baseTileLayer
        this.queryTrajectoryCanvasLayer = null; // 查询地图轨迹Canvas图层
        
        this.mapAnimation = {
            currentTimestamp: null,
            timer: null,
            playing: false,
            minTimestamp: null,
            maxTimestamp: null,
            playbackSpeed: 1 // 播放倍速：1x, 2x, 5x, 10x
        };

        this._syncSlider = null;
        this.timestampIndex = new Map(); // 时间戳-数据索引映射（优化查询性能）

        // 时间轴节流控制
        this._sliderThrottleTimer = null;     // 定时器句柄
        this._sliderPendingTimestamp = null;  // 最近一次滑动对应的时间戳
        this._lastRequestedTimestamp = null;  // 最近一次实际请求的时间戳，避免重复请求
        
        // 缩放优化：节流和防抖
        this._zoomRedrawTimer = null;         // 缩放重绘节流定时器
        this._zoomRedrawPending = false;      // 是否有待处理的缩放重绘
        this._isZooming = false;              // 是否正在缩放中
        
        // 新增密接追踪
        this.previousTimestampContacts = new Set(); // 上一个时间戳的密接对集合（用于计算新增）
        this.previousTimestamp = null; // 上一个时间戳
        this.previousTimestampData = null; // 上一个时间戳的完整数据（用于查询比较）
        this.newContactType = 'direct'; // 新增密接列表当前显示类型: 'direct' 密接, 'indirect' 次密接
        this.allNewContacts = []; // 所有新增密接数据（包括直接和次密接）
        this.dataCenter = null; // 数据边界中心点，用于定位按钮
    }

    /**
     * 为瓦片图层添加404检测和子域名重试机制
     * 在收到404错误时，自动切换到下一个子域名重新请求
     * @param {L.TileLayer} tileLayer - 瓦片图层
     */
    enableTileValidation(tileLayer) {
        if (!tileLayer) return;
        
        // 记录每个瓦片的重试状态
        const tileRetryState = new Map(); // {tileKey: {retryCount, triedSubdomains: Set}}
        
        // 从tileLayer配置中获取子域名列表，如果没有则使用默认值
        const subdomains = tileLayer.options.subdomains || ['a', 'b', 'c'];
        
        // 确保subdomains是数组格式（Leaflet可能返回字符串）
        const subdomainArray = Array.isArray(subdomains) ? subdomains : subdomains.split('');
        
        // 获取当前URL使用的子域名
        const getCurrentSubdomain = (url) => {
            for (const subdomain of subdomainArray) {
                if (url.includes(`.${subdomain}.`)) {
                    return subdomain;
                }
            }
            return null;
        };
        
        // 获取下一个未尝试的子域名
        const getNextSubdomain = (triedSubdomains) => {
            for (const subdomain of subdomainArray) {
                if (!triedSubdomains.has(subdomain)) {
                    return subdomain;
                }
            }
            return null;
        };
        
        // 用指定子域名重新请求瓦片
        const retryWithSubdomain = (coords, subdomain) => {
            if (!tileLayer._tiles) return;
            
            const tileKey2 = L.Util.template('{z}_{x}_{y}', coords);
            const tile = tileLayer._tiles[tileKey2];
            
            if (tile && tile.el) {
                // 生成新的URL，使用指定的子域名
                const newUrl = tileLayer.getTileUrl(coords).replace('{s}', subdomain);
                
                // 如果URL不同，重新加载
                if (tile.el.src !== newUrl) {
                    console.log(`瓦片404，切换到子域名 ${subdomain} 重新请求: z=${coords.z}, x=${coords.x}, y=${coords.y}`);
                    tile.el.src = newUrl;
                }
            }
        };
        
        // 监听瓦片加载错误事件（404等）
        tileLayer.on('tileerror', (e) => {
            const coords = e.coords;
            const tileKey = `${coords.z}_${coords.x}_${coords.y}`;
            
            // 获取或创建重试状态
            let state = tileRetryState.get(tileKey);
            if (!state) {
                state = { retryCount: 0, triedSubdomains: new Set() };
                tileRetryState.set(tileKey, state);
            }
            
            // 获取当前使用的子域名
            if (tileLayer._tiles) {
                const tileKey2 = L.Util.template('{z}_{x}_{y}', coords);
                const tile = tileLayer._tiles[tileKey2];
                
                if (tile && tile.el) {
                    const currentSubdomain = getCurrentSubdomain(tile.el.src);
                    if (currentSubdomain) {
                        state.triedSubdomains.add(currentSubdomain);
                    }
                    
                    // 尝试下一个未使用的子域名
                    const nextSubdomain = getNextSubdomain(state.triedSubdomains);
                    if (nextSubdomain) {
                        state.retryCount++;
                        state.triedSubdomains.add(nextSubdomain);
                        console.warn(`瓦片404错误，切换到子域名 ${nextSubdomain} 重试: z=${coords.z}, x=${coords.x}, y=${coords.y}, 重试次数=${state.retryCount}`);
                        retryWithSubdomain(coords, nextSubdomain);
                    } else {
                        // 所有子域名都尝试过了
                        if (state.retryCount < subdomainArray.length) {
                            console.warn(`所有子域名都失败: z=${coords.z}, x=${coords.x}, y=${coords.y}, 已尝试: ${Array.from(state.triedSubdomains).join(', ')}`);
                        }
                    }
                }
            }
        });
        
        // 监听瓦片加载成功，清除重试状态
        tileLayer.on('tileload', (e) => {
            const coords = e.coords;
            const tileKey = `${coords.z}_${coords.x}_${coords.y}`;
            tileRetryState.delete(tileKey);
        });
    }

    // 初始化地图（主地图）
    initMap() {
        this.map = L.map('map-container', {
            minZoom: 0,  // 允许缩放到最小级别
            maxZoom: 19, // 允许缩放到最大级别
            attributionControl: false // 不显示默认的版权标签
        }).setView([0, 0], 13);
        // 保存背景图层引用，确保不会被误删
        // 使用OpenStreetMap
        this.baseTileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            subdomains: ['a', 'b', 'c'],
            keepBuffer: 5,  // 扩大缓冲区，预加载更多边界瓦片
            updateWhenZooming: false,  // 缩放时不更新，提升性能
            updateWhenIdle: true,  // 空闲时更新
            maxZoom: 19
        }).addTo(this.map);
        
        // 启用瓦片检测和重试机制
        this.enableTileValidation(this.baseTileLayer);
        this.markersLayer = L.layerGroup().addTo(this.map);
        this.createLegend();
        
        // 在地图加载完成后，设置边界和视图
        this.map.whenReady(() => {
            this.map.invalidateSize();
            setTimeout(() => {
                if (this.map) {
                    this.setMapMaxBounds();
                }
            }, 100);
        });
        
        // 可视化模式切换控件现在在HTML中，延迟初始化以确保DOM已加载
        setTimeout(() => {
            this.createVisualizationControl();
        }, 100);
        
        // 监听缩放事件（由于使用固定大小，不再需要重新绘制）
        this.map.on('zoomstart', () => {
            this._isZooming = true;
            // 缩放开始时优化标记渲染性能
            if (this.markersLayer) {
                this.markersLayer.eachLayer(layer => {
                    if (layer instanceof L.Marker) {
                        // 禁用交互，减少重绘开销
                        const element = layer.getElement();
                        if (element) {
                            element.style.pointerEvents = 'none';
                            element.style.willChange = 'transform';
                            // 使用 CSS transform 优化，而不是重新计算位置
                            element.style.transform = 'translateZ(0)'; // 启用硬件加速
                        }
                    }
                });
            }
        });
        
        this.map.on('zoomend', () => {
            this._isZooming = false;
            // 恢复标记的交互和样式
            if (this.markersLayer) {
                this.markersLayer.eachLayer(layer => {
                    if (layer instanceof L.Marker) {
                        const element = layer.getElement();
                        if (element) {
                            element.style.pointerEvents = '';
                            element.style.willChange = '';
                        }
                    }
                });
            }
            // 热力图会自动适应缩放级别，不需要重新绘制
        });
    }

    /**
     * 初始化查询地图（现在使用共享的主地图）
     * @returns {Promise} 返回一个 Promise，当地图初始化完成时 resolve
     */
    initQueryMap() {
        // 确保主地图已初始化
        if (!this.map) {
            this.initMap();
        }
        
        // 如果查询标记图层不存在，创建它
        if (!this.queryMarkersLayer && this.map) {
            this.queryMarkersLayer = L.layerGroup().addTo(this.map);
            this.createQueryMapLegend();
        }
        
        // 刷新地图大小
        if (this.map) {
            this.map.invalidateSize();
        }
        
        return Promise.resolve();
    }

    /**
     * 创建查询地图图例
     */
    createQueryMapLegend() {
        if (!this.map) return;
        
        // 如果图例已存在且已添加到地图，先移除
        if (this.queryLegendControl && this.queryLegendControl._map === this.map) {
            this.map.removeControl(this.queryLegendControl);
            this.queryLegendControl = null;
        }
        
        // 创建新的图例控件
        const Legend = L.Control.extend({
            onAdd: () => {
                const div = L.DomUtil.create('div', '');
                div.innerHTML = `
                    <div class="rounded-md bg-white border border-slate-300 px-3 py-2">
                        <div class="font-semibold text-slate-900 mb-2 text-xs">接触点类型</div>
                        <div class="flex flex-col gap-2">
                            <div class="flex items-center gap-2">
                                <span class="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-[#dc2626] border border-white"></span>
                                <span class="text-[10px] font-medium text-slate-700">密接接触点</span>
                            </div>
                            <div class="flex items-center gap-2">
                                <span class="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-[#f59e0b] border border-white"></span>
                                <span class="text-[10px] font-medium text-slate-700">次密接接触点</span>
                            </div>
                            <div class="flex items-center gap-2">
                                <span class="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-[#667eea] border border-white"></span>
                                <span class="text-[10px] font-medium text-slate-700">混合接触点</span>
                            </div>
                        </div>
                    </div>
                `;
                return div;
            }
        });
        this.queryLegendControl = new Legend({ position: 'bottomright' });
        this.queryLegendControl.addTo(this.map);
    }

    /**
     * 创建主地图图例（根据可视化模式动态更新）
     */
    createLegend() {
        if (!this.map) return;
        
        // 如果图例已存在且已添加到地图，先移除
        if (this.legendControl && this.legendControl._map === this.map) {
            this.map.removeControl(this.legendControl);
            this.legendControl = null;
        }
        
        // 创建新的图例控件
        const Legend = L.Control.extend({
            onAdd: () => {
                const div = L.DomUtil.create('div', '');
                this.updateLegendContent(div);
                return div;
            }
        });
        this.legendControl = new Legend({ position: 'bottomright' });
        this.legendControl.addTo(this.map);
    }

    /**
     * 更新图例内容（根据可视化模式）
     */
    updateLegendContent(div) {
        if (!div) {
            if (this.legendControl) {
                div = this.legendControl.getContainer();
            } else {
                // 如果图例控件不存在，重新创建
                this.createLegend();
                div = this.legendControl ? this.legendControl.getContainer() : null;
            }
            if (!div) return;
        }
        
        if (this.visualizationMode === 'heatmap') {
            // 热力图图例（紧凑且无阴影）
            div.innerHTML = `
                <div class="rounded-md bg-white border border-slate-300 px-3 py-2">
                    <div class="font-semibold text-slate-900 mb-2 text-xs">热力图强度</div>
                    <div class="flex flex-col gap-2">
                        <div class="w-full h-3 bg-gradient-to-r from-blue-500 via-cyan-400 via-lime-400 via-yellow-400 to-red-500 rounded border border-slate-200"></div>
                        <div class="flex items-center justify-between text-[10px] text-slate-700 font-medium">
                            <span>低</span>
                            <span>高</span>
                        </div>
                    </div>
                </div>
            `;
        } else {
            // 标记点图例（紧凑且无阴影）
            div.innerHTML = `
                <div class="rounded-md bg-white border border-slate-300 px-3 py-2">
                    <div class="font-semibold text-slate-900 mb-2 text-xs">接触点类型</div>
                    <div class="flex flex-col gap-2">
                        <div class="flex items-center gap-2">
                            <span class="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-[#dc2626] border border-white"></span>
                            <span class="text-[10px] font-medium text-slate-700">密接接触点</span>
                        </div>
                        <div class="flex items-center gap-2">
                            <span class="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-[#f59e0b] border border-white"></span>
                            <span class="text-[10px] font-medium text-slate-700">次密接接触点</span>
                        </div>
                        <div class="flex items-center gap-2">
                            <span class="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-[#667eea] border border-white"></span>
                            <span class="text-[10px] font-medium text-slate-700">混合接触点</span>
                        </div>
                    </div>
                </div>
            `;
        }
    }

    /**
     * 初始化可视化模式切换控件（胶囊按钮样式）
     */
    createVisualizationControl() {
        const canvasBtn = document.getElementById('viz-mode-canvas');
        const heatmapBtn = document.getElementById('viz-mode-heatmap');
        
        if (canvasBtn && heatmapBtn) {
            // 设置初始按钮样式
            this.updateVisualizationButtons();
            
            // 绑定点击事件
            canvasBtn.addEventListener('click', () => {
                this.switchVisualizationMode('points');
            });
            heatmapBtn.addEventListener('click', () => {
                this.switchVisualizationMode('heatmap');
            });
        }
    }

    /**
     * 更新可视化模式按钮样式
     */
    updateVisualizationButtons() {
        const canvasBtn = document.getElementById('viz-mode-canvas');
        const heatmapBtn = document.getElementById('viz-mode-heatmap');
        
        if (canvasBtn && heatmapBtn) {
            const baseClasses = 'viz-mode-btn flex-1 py-1.5 px-3 text-xs font-medium transition';
            
            if (this.visualizationMode === 'points') {
                // 标记点按钮：激活状态
                canvasBtn.className = `${baseClasses} border-r border-slate-200 bg-slate-900 hover:bg-slate-900 text-white`;
                // 热力图按钮：未激活状态
                heatmapBtn.className = `${baseClasses} bg-white hover:bg-slate-50 text-slate-700`;
            } else {
                // 热力图按钮：激活状态
                heatmapBtn.className = `${baseClasses} bg-slate-900 hover:bg-slate-900 text-white`;
                // 标记点按钮：未激活状态
                canvasBtn.className = `${baseClasses} border-r border-slate-200 bg-white hover:bg-slate-50 text-slate-700`;
            }
        }
    }

    /**
     * 切换可视化模式
     */
    switchVisualizationMode(mode) {
        if (mode !== 'points' && mode !== 'heatmap') {
            return;
        }
        
        this.visualizationMode = mode;
        
        // 更新按钮样式
        this.updateVisualizationButtons();
        
        // 更新图例
        this.updateLegendContent();
        
        // 重新绘制地图
        if (this.mapAnimation.currentTimestamp) {
            this.drawMapAtTimestamp(this.mapAnimation.currentTimestamp);
        }
    }

    /**
     * 创建定位控件（回到数据中心）
     * @param {L.Map} map - 地图实例
     */
    createLocationControl(map) {
        if (!map) return;
        
        // 创建自定义控件
        const LocationControl = L.Control.extend({
            onAdd: (map) => {
                const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control');
                const button = L.DomUtil.create('a', 'location-control-btn', container);
                button.href = '#';
                button.innerHTML = `
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M12 2v4m0 12v4M2 12h4m12 0h4"></path>
                        <circle cx="12" cy="12" r="3"></circle>
                    </svg>
                `;
                button.title = '回到数据中心';
                
                // 防止地图拖动时触发点击
                L.DomEvent.disableClickPropagation(button);
                L.DomEvent.on(button, 'click', (e) => {
                    L.DomEvent.stopPropagation(e);
                    L.DomEvent.preventDefault(e);
                    this.returnToDataCenter(map);
                });
                
                // 添加样式
                button.style.cssText = `
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    width: 34px;
                    height: 34px;
                    background-color: white;
                    color: #333;
                    border: 2px solid rgba(0,0,0,0.2);
                    border-radius: 4px;
                    cursor: pointer;
                    transition: all 0.2s;
                `;
                
                button.onmouseover = () => {
                    button.style.backgroundColor = '#f4f4f4';
                    button.style.borderColor = 'rgba(0,0,0,0.3)';
                };
                button.onmouseout = () => {
                    button.style.backgroundColor = 'white';
                    button.style.borderColor = 'rgba(0,0,0,0.2)';
                };
                
                return container;
            }
        });
        
        // 添加到地图左下角
        const locationControl = new LocationControl({
            position: 'bottomleft'
        });
        locationControl.addTo(map);
    }

    /**
     * 回到数据中心
     * @param {L.Map} map - 地图实例
     */
    returnToDataCenter(map) {
        if (!map) return;

        // 计算当前地图上所有点（CircleMarker / Marker）的最小外接矩形
        let pointsBounds = null;
        map.eachLayer(layer => {
            if ((layer instanceof L.CircleMarker || layer instanceof L.Marker) &&
                typeof layer.getLatLng === 'function') {
                const latlng = layer.getLatLng();
                if (latlng) {
                    if (!pointsBounds) {
                        pointsBounds = L.latLngBounds(latlng, latlng);
                    } else {
                        pointsBounds.extend(latlng);
                    }
                }
            }
        });

        // 目标中心：优先用最小外接矩形中心，其次数据中心，最后当前中心
        let targetCenter = null;
        if (pointsBounds) {
            targetCenter = pointsBounds.getCenter();
        } else if (this.dataCenter) {
            targetCenter = this.dataCenter;
        } else {
            targetCenter = map.getCenter();
        }

        // 保持当前缩放级别，只平移到中心
        const currentZoom = map.getZoom();
        map.flyTo(targetCenter, currentZoom, {
            animate: true,
            duration: 0.8
        });
    }

    /**
     * 设置地图边界
     * 不限制地图移动范围，允许加载边界外的瓦片，避免比例尺太大时边缘部分不加载
     */
    async setMapMaxBounds() {
        const bounds = await this.dataLoader.getBoundsInfo();
        if (bounds) {
            // 计算数据边界中心点
            const centerLat = (Number(bounds.minLat) + Number(bounds.maxLat)) / 2;
            const centerLng = (Number(bounds.minLng) + Number(bounds.maxLng)) / 2;
            this.dataCenter = L.latLng(centerLat, centerLng);
            
            // 使用后端返回的边界创建数据边界
            const dataBounds = L.latLngBounds(
                L.latLng(Number(bounds.minLat), Number(bounds.minLng)),
                L.latLng(Number(bounds.maxLat), Number(bounds.maxLng))
            );

            if (this.map) {
                this.map.invalidateSize();
                
                // 不设置setMaxBounds，允许地图自由移动，从而可以加载边界外的瓦片
                // 移除之前的边界限制和panInsideBounds
                this.map.off('dragend'); // 移除之前的dragend监听器
                
                // 创建定位控件
                this.createLocationControl(this.map);
                
                // 直接设置初始视图到数据边界
                this.map.fitBounds(dataBounds, { 
                    padding: [0, 0], 
                    maxZoom: 19, // 允许更大的缩放级别
                    animate: false 
                });
                
                // 移除最小缩放限制，允许自由缩放
                if (this.map) {
                    this.map.setMinZoom(0); // 允许缩放到最小级别
                }
            }

            // queryMap已合并到map，不需要单独处理
        }
        return bounds;
    }

    /**
     * 初始化地图动画
     */
    initMapAnimation() {
        const timestamps = this.dataLoader.allTimestamps;
        if (timestamps.length === 0) return;

        this.mapAnimation.minTimestamp = timestamps[0];
        this.mapAnimation.maxTimestamp = timestamps[timestamps.length - 1];
        this.mapAnimation.currentTimestamp = timestamps[0];

        // 初始化时间轴滑块
        const slider = document.getElementById('timestamp-slider');
        slider.min = 0;
        slider.max = timestamps.length - 1;
        slider.value = 0;
        
        // 初始化倍速UI（默认1x）
        this.updatePlaybackSpeedUI(this.mapAnimation.playbackSpeed);
        document.getElementById('slider-value').textContent = timestamps[0];

        // 绑定滑块事件（带节流）：
        // - 持续拖动时，每隔 THROTTLE_MS 触发一次真正的 setTimestamp
        // - 停止拖动后，会立即对最新位置触发一次
        const THROTTLE_MS = 25;  // 约 40 次/秒，兼顾流畅度和性能
        slider.oninput = (e) => {
            const index = parseInt(e.target.value);
            const timestamp = timestamps[index];

            // 立即更新 UI 显示（不等后端返回）
            document.getElementById('slider-value').textContent = timestamp;

            // 如果时间戳和上一次请求的一样，就没必要再请求
            if (timestamp === this._lastRequestedTimestamp) {
                return;
            }

            // 记录最新的目标时间戳
            this._sliderPendingTimestamp = timestamp;

            // 如果当前没有定时器，启动一个
            if (!this._sliderThrottleTimer) {
                this._sliderThrottleTimer = setTimeout(async () => {
                    this._sliderThrottleTimer = null;
                    const targetTs = this._sliderPendingTimestamp;
                    this._sliderPendingTimestamp = null;

                    // 再次检查，避免无效调用
                    if (targetTs != null && targetTs !== this._lastRequestedTimestamp) {
                        this._lastRequestedTimestamp = targetTs;
                        await this.setTimestamp(targetTs);
                    }
                }, THROTTLE_MS);
            }
        };

        // 添加鼠标悬停显示时间戳功能
        slider.onmousemove = (e) => {
            const rect = slider.getBoundingClientRect();
            const percent = (e.clientX - rect.left) / rect.width;
            const index = Math.round(percent * (timestamps.length - 1));
            const hoveredTimestamp = timestamps[Math.max(0, Math.min(index, timestamps.length - 1))];
            slider.title = `时间戳: ${hoveredTimestamp}`;
        };

        this._syncSlider = true;
    }

    /**
     * 设置当前时间戳并更新地图
     * 注意：不再 await 后端请求，避免阻塞滑动体验。
     * 数据返回后仅在时间戳仍是当前值时才绘制，防止绘制过期帧。
     */
    async setTimestamp(timestamp) {
        if (!this.dataLoader.allTimestamps.includes(timestamp)) return;

        // 立即更新当前时间戳状态和 UI，保证滑动“跟手”
        this.mapAnimation.currentTimestamp = timestamp;
        const sliderValueEl = document.getElementById('slider-value');
        if (sliderValueEl) {
            sliderValueEl.textContent = timestamp;
        }

        // 后台请求数据，完成后再根据最新状态决定是否绘制
        this.dataLoader.loadDataByTimestamp(timestamp).then(() => {
            // 如果在加载过程中用户又切换到了其他时间戳，就不绘制旧时间戳的数据
            if (this.mapAnimation.currentTimestamp !== timestamp) return;

            this.drawMapAtTimestamp(timestamp);

            // 更新统计信息
            const totalEl = document.getElementById('total-contacts');
            if (totalEl) {
                const count = this.dataLoader.contacts.length;
                totalEl.textContent = count;
                // 更新原点颜色（根据对数大小变色，类似热力图）
                if (window.app && window.app.updateContactCountDotColor) {
                    window.app.updateContactCountDotColor(count);
                }
            }

            // 计算并渲染新增密接（异步，需要查询上一个时间戳的数据）
            this.calculateAndRenderNewContacts(timestamp).catch(err => {
                console.error('计算新增密接失败:', err);
            });

            // 同步滑块位置
            if (this._syncSlider) {
                const index = this.dataLoader.allTimestamps.indexOf(timestamp);
                const slider = document.getElementById('timestamp-slider');
                if (slider && index >= 0) {
                    slider.value = index;
                }
            }
            
            // 预加载下一个时间戳的数据，避免网络卡顿
            const currentIndex = this.dataLoader.allTimestamps.indexOf(timestamp);
            if (currentIndex >= 0 && currentIndex < this.dataLoader.allTimestamps.length - 1) {
                const nextTimestamp = this.dataLoader.allTimestamps[currentIndex + 1];
                this.dataLoader.preloadDataByTimestamp(nextTimestamp).catch(err => {
                    console.warn(`预加载下一个时间戳 ${nextTimestamp} 失败:`, err);
                });
            }
        }).catch(err => {
            console.error('加载时间戳数据失败:', err);
        });
    }

    /**
     * 上一个时间戳
     */
    prevTimestamp(step = 1) {
        const currentIndex = this.dataLoader.allTimestamps.indexOf(this.mapAnimation.currentTimestamp);
        if (currentIndex > 0) {
            const newIndex = Math.max(0, currentIndex - step);
            this.setTimestamp(this.dataLoader.allTimestamps[newIndex]);
        }
    }

    /**
     * 下一个时间戳
     */
    nextTimestamp(step = 1) {
        const currentIndex = this.dataLoader.allTimestamps.indexOf(this.mapAnimation.currentTimestamp);
        if (currentIndex < this.dataLoader.allTimestamps.length - 1) {
            const newIndex = Math.min(this.dataLoader.allTimestamps.length - 1, currentIndex + step);
            this.setTimestamp(this.dataLoader.allTimestamps[newIndex]);
        }
    }

    /**
     * 播放地图动画
     */
    playMapAnimation() {
        if (this.mapAnimation.playing) return;
        
        this.mapAnimation.playing = true;
        document.getElementById('play-btn').style.display = 'none';
        document.getElementById('pause-btn').style.display = 'inline-block';
        
        // 根据倍速计算间隔时间（基础间隔 1000ms）
        const interval = 1000 / this.mapAnimation.playbackSpeed;
        
        this.mapAnimation.timer = setInterval(() => {
            this.nextTimestamp();
            // 如果到了最后一个时间戳，停止播放
            if (this.mapAnimation.currentTimestamp === this.mapAnimation.maxTimestamp) {
                this.pauseMapAnimation();
            }
        }, interval);
    }

    /**
     * 暂停地图动画
     */
    pauseMapAnimation() {
        if (!this.mapAnimation.playing) return;
        
        this.mapAnimation.playing = false;
        clearInterval(this.mapAnimation.timer);
        document.getElementById('play-btn').style.display = 'inline-block';
        document.getElementById('pause-btn').style.display = 'none';
    }

    /**
     * 设置播放倍速
     * @param {number} speed - 倍速值（1, 2, 5, 10）
     */
    setPlaybackSpeed(speed) {
        const validSpeeds = [1, 2, 5, 10];
        if (!validSpeeds.includes(speed)) {
            console.warn(`无效的倍速值: ${speed}，使用默认值 1x`);
            speed = 1;
        }
        
        const wasPlaying = this.mapAnimation.playing;
        
        // 如果正在播放，先暂停
        if (wasPlaying) {
            this.pauseMapAnimation();
        }
        
        // 更新倍速
        this.mapAnimation.playbackSpeed = speed;
        
        // 更新UI显示
        this.updatePlaybackSpeedUI(speed);
        
        // 如果之前正在播放，重新开始播放（使用新倍速）
        if (wasPlaying) {
            this.playMapAnimation();
        }
    }

    /**
     * 更新播放倍速UI显示
     * @param {number} speed - 倍速值
     */
    updatePlaybackSpeedUI(speed) {
        const speedBtn = document.getElementById('playback-speed-btn');
        if (speedBtn) {
            speedBtn.textContent = `${speed}x`;
            // 更新按钮的 data-speed 属性
            speedBtn.dataset.speed = speed;
        }
    }


    /**
     * 在指定时间戳绘制地图（使用 Canvas 渲染优化性能）
     */
    drawMapAtTimestamp(timestamp) {
        if (!this.map || !this.markersLayer) return;
        
        // 如果正在缩放中，延迟重绘（由 zoomend 事件处理）
        if (this._isZooming) {
            return;
        }

        // 隐藏查询相关的图层（因为现在共享同一个地图）
        if (this.queryMarkersLayer) {
            this.queryMarkersLayer.clearLayers();
        }
        if (this.queryCanvasLayer && this.map.hasLayer(this.queryCanvasLayer)) {
            this.map.removeLayer(this.queryCanvasLayer);
            this.queryCanvasLayer = null;
        }
        if (this.queryHeatmapLayer && this.map.hasLayer(this.queryHeatmapLayer)) {
            this.map.removeLayer(this.queryHeatmapLayer);
            this.queryHeatmapLayer = null;
        }
        if (this.queryLegendControl && this.queryLegendControl._map === this.map) {
            this.map.removeControl(this.queryLegendControl);
        }

        // 清除现有标记和图层
        this.markersLayer.clearLayers();
        if (this.heatmapLayer) {
            this.map.removeLayer(this.heatmapLayer);
            this.heatmapLayer = null;
        }
        
        // 确保地图导览的图例显示（如果不存在则创建）
        if (!this.legendControl) {
            this.createLegend();
        } else if (this.legendControl._map !== this.map) {
            this.map.addControl(this.legendControl);
        }

        // 获取当前时间戳的接触数据
        const contacts = this.dataLoader.contacts;
        if (contacts.length === 0) return;

        // 处理重叠点，同时收集详细接触信息
        const pointGroups = new Map();
        
        contacts.forEach(contact => {
            contact.points.forEach(point => {
                if (point.timestamp === timestamp) {
                    const key = `${point.lng.toFixed(4)}|${point.lat.toFixed(4)}`;
                    if (!pointGroups.has(key)) {
                        pointGroups.set(key, {
                            lng: point.lng,
                            lat: point.lat,
                            direct: 0,
                            indirect: 0,
                            directContacts: [], // 密接用户对
                            indirectContacts: [] // 次密接用户对
                        });
                    }
                    const group = pointGroups.get(key);
                    if (point.contact_type === 'direct') {
                        group.direct++;
                        group.directContacts.push(`${contact.id1} ↔ ${contact.id2}`);
                    } else {
                        group.indirect++;
                        const throughInfo = contact.through ? ` (通过 ${contact.through})` : '';
                        group.indirectContacts.push(`${contact.id1} ↔ ${contact.id2}${throughInfo}`);
                    }
                }
            });
        });
        
        // 根据点密度构建热力图数据点：每个密接次数对应一个点，强度为1
        // 如果一个位置有n次密接，就添加n个相同位置的点，让Leaflet.heat根据密度自动计算热力
        const heatmapPoints = [];
        pointGroups.forEach(group => {
            const totalCount = group.direct + group.indirect;
            if (totalCount > 0) {
                // 添加totalCount个相同位置的点，每个点的强度都是1
                // Leaflet.heat会根据点的密度自动计算热力强度
                for (let i = 0; i < totalCount; i++) {
                    heatmapPoints.push([group.lat, group.lng, 1]);
                }
            }
        });
        
        // 根据可视化模式选择渲染方式
        if (this.visualizationMode === 'heatmap' && typeof L.heatLayer !== 'undefined') {
            if (heatmapPoints.length === 0) {
                return;
            }
            
            // 过滤掉无效的数据点
            const validHeatmapPoints = heatmapPoints.filter(p => {
                return Array.isArray(p) && 
                       p.length >= 3 && 
                       typeof p[0] === 'number' && 
                       typeof p[1] === 'number' && 
                       typeof p[2] === 'number' && 
                       p[2] > 0 && 
                       !isNaN(p[0]) && 
                       !isNaN(p[1]) && 
                       !isNaN(p[2]);
            });
            
            // 调试信息
            console.log('热力图点密度可视化:', {
                '总点数': validHeatmapPoints.length,
                '唯一位置数': pointGroups.size,
                '平均每个位置的点数': (validHeatmapPoints.length / pointGroups.size).toFixed(2),
                '可视化方式': '点密度（每个密接次数=1个点，强度=1）'
            });
            
            // 确保地图已经准备好并且有有效的尺寸
            const addHeatmapLayer = () => {
                // 检查地图尺寸
                const mapSize = this.map.getSize();
                if (mapSize.x === 0 || mapSize.y === 0) {
                    // 如果尺寸无效，先调用 invalidateSize 并重试
                    this.map.invalidateSize();
                    setTimeout(addHeatmapLayer, 50);
                    return;
                }
                
                // 移除旧的热力图层（如果存在）
                if (this.heatmapLayer) {
                    this.map.removeLayer(this.heatmapLayer);
                }
                
                // 创建并添加热力图层
                // 不设置max参数，让Leaflet.heat根据点密度自动计算热力强度
                // 这样密度高的区域（多个重合点）会自动显示为高强度的热力
                this.heatmapLayer = L.heatLayer(validHeatmapPoints, {
                    radius: 25,
                    blur: 15,
                    maxZoom: 18, // 允许所有缩放级别
                    minOpacity: 0.05,
                    gradient: {
                        0.0: 'blue',
                        0.25: 'cyan',
                        0.5: 'lime',
                        0.75: 'yellow',
                        1.0: 'red'
                    }
                    // 不设置max，让Leaflet.heat根据点密度自动计算
                }).addTo(this.map);
            };
            
            // 使用 whenReady 确保地图已初始化
            if (this.map._loaded) {
                addHeatmapLayer();
            } else {
                this.map.whenReady(addHeatmapLayer);
            }
        } else {
            // 使用 Canvas 渲染点（性能较好）
            this.drawPointsWithCanvas(pointGroups);
        }
    }

    /**
     * 使用 Canvas 渲染点（真正的 Canvas 渲染，优化性能）
     */
    drawPointsWithCanvas(pointGroups) {
        // 清除之前的标记引用和图层
        this.mapContactMarkers = [];
        
        // 获取地图边界，只渲染可见区域内的点（优化性能）
        const bounds = this.map.getBounds();
        const visiblePoints = [];
        const popupData = new Map(); // 存储弹出框数据
        
        pointGroups.forEach(group => {
            // 检查点是否在可见区域内（减少渲染的点数）
            if (bounds.contains([group.lat, group.lng])) {
                const hasDirect = group.direct > 0;
                const hasIndirect = group.indirect > 0;
                const count = group.direct + group.indirect;
                
                // 确定颜色
                let color;
                if (hasDirect && hasIndirect) {
                    color = "#667eea"; // 混合
                } else if (hasDirect && !hasIndirect) {
                    color = "#dc2626"; // 密接
                } else {
                    color = "#f59e0b"; // 次密接
                }
                
                visiblePoints.push({
                    lat: group.lat,
                    lng: group.lng,
                    color: color,
                    count: count
                });
                
                // 保存弹出框数据
                let popupContent = `<strong>位置: </strong>${group.lat.toFixed(6)}, ${group.lng.toFixed(6)}<br>`;
                if (group.direct > 0) {
                    popupContent += `<strong>密接 (${group.direct}次): </strong><br>`;
                    const uniqueDirectContacts = [...new Set(group.directContacts)];
                    popupContent += uniqueDirectContacts.map(pair => `• ${pair}`).join('<br>') + '<br>';
                }
                if (group.indirect > 0) {
                    popupContent += `<strong>次密接 (${group.indirect}次): </strong><br>`;
                    const uniqueIndirectContacts = [...new Set(group.indirectContacts)];
                    popupContent += uniqueIndirectContacts.map(pair => `• ${pair}`).join('<br>');
                }
                popupData.set(`${group.lat}|${group.lng}`, popupContent);
            }
        });
        
        // 使用与地图“绑定”的 Leaflet 标记点来渲染（替代 Canvas 覆盖层，保证与地图完全同步）
        // 在“屏幕中大小基本不变”的基础上，加一个随 zoom 线性变化的轻微补偿：
        // - 地图放大时，点半径略微变大（线性关系），避免肉眼感觉点明显变小
        // - 地图缩小时，点半径略微变小，但做下限保护，避免缩得过小
        const zoom = this.map && typeof this.map.getZoom === 'function' ? this.map.getZoom() : 13;
        const baseZoom = 13;
        const zoomDelta = zoom - baseZoom;
        // 线性补偿因子：每放大 1 级，半径增加 25%；每缩小 1 级，半径减小 25%
        let zoomFactor = 1 + 0.25 * zoomDelta;
        // 下限保护，避免缩得太小
        if (zoomFactor < 1) zoomFactor = 1;

        visiblePoints.forEach(point => {
            // 根据密接次数动态调整点的大小（整体放大：最小5px，最大10px），先按对数缩放，再乘以轻微的 zoom 线性补偿
            const minRadius = 5;
            const maxRadius = 10;
            const minCount = 1;
            const maxCount = 200;
            const safeCount = Math.max(point.count, minCount);
            const logCount = Math.log(1 + safeCount);       // ln(1 + count)，避免 count=0 问题
            const logMax = Math.log(1 + maxCount);
            const baseRadius = minRadius + (maxRadius - minRadius) * (logCount / logMax);
            const radius = baseRadius * zoomFactor;

            // 底层圆点（真正与地图绑定的点）
            const circle = L.circleMarker([point.lat, point.lng], {
                radius: radius,
                fillColor: point.color,
                color: '#ffffff',
                weight: 1,
                opacity: 1,
                fillOpacity: 0.9
            }).addTo(this.markersLayer);

            const popupContent = popupData.get(`${point.lat}|${point.lng}`);

            // 如果有多个接触点，在标记上显示数字（使用 divIcon 叠加）
            if (point.count > 1) {
                const iconHtml = `
                    <div style="
                        display:inline-flex;
                        align-items:center;
                        justify-content:center;
                        width:${radius * 2}px;
                        height:${radius * 2}px;
                        border-radius:50%;
                        background:${point.color};
                        color:#fff;
                        font-size:10px;
                        border:1px solid #fff;
                        box-sizing:border-box;
                    ">
                        ${point.count}
                    </div>
                `;

                const numberMarker = L.marker([point.lat, point.lng], {
                    icon: L.divIcon({
                        className: 'contact-count-marker',
                        html: iconHtml,
                        iconSize: [radius * 2, radius * 2],
                        iconAnchor: [radius, radius]
                    })
                }).addTo(this.markersLayer);

                if (popupContent) {
                    circle.bindPopup(popupContent);
                    numberMarker.bindPopup(popupContent);
                }

                this.mapContactMarkers.push(circle, numberMarker);
            } else {
                if (popupContent) {
                    circle.bindPopup(popupContent);
                }
                this.mapContactMarkers.push(circle);
            }
        });
    }

    /**
     * 创建标记图标（固定大小，优化性能）
     * @param {number} count - 接触点数量
     * @param {boolean} hasDirect - 是否有直接密接
     * @param {boolean} hasIndirect - 是否有次密接
     * @param {number} zoomLevel - 地图缩放级别（已废弃，保持固定大小）
     */
    createMarkerIcon(count, hasDirect, hasIndirect, zoomLevel = null) {
        let color, hoverColor;
        if (hasDirect && hasIndirect) {
            // 混合：既有直接密接又有次密接
            color = "#667eea"; // 混合
            hoverColor = "#818cf8"; // 混合悬浮 (indigo-400)
        } else if (hasDirect && !hasIndirect) {
            // 只有直接密接
            color = "#dc2626"; // 密接 (rose-600)
            hoverColor = "#ef4444"; // 密接悬浮 (rose-500)
        } else if (hasIndirect && !hasDirect) {
            // 只有次密接
            color = "#f59e0b"; // 次密接 (amber-500)
            hoverColor = "#fbbf24"; // 次密接悬浮 (amber-400)
        } else {
            // 默认情况（理论上不应该发生）
            color = "#dc2626"; // 密接 (rose-600)
            hoverColor = "#ef4444"; // 密接悬浮 (rose-500)
        }
        
        // 使用固定大小，提高性能
        const radius = 8; // 固定半径 8px
        
        return L.divIcon({
            html: `<div class="map-marker" style="width: ${radius*2}px; height: ${radius*2}px; border-radius: 50%; background-color: ${color}; 
                    display: flex; align-items: center; justify-content: center; color: white; font-weight: bold;
                    box-shadow: 0 2px 5px rgba(0,0,0,0.2); transition: background-color 0.2s, transform 0.2s; cursor: pointer;
                    will-change: transform; transform: translateZ(0); backface-visibility: hidden; font-size: 10px;"
                    onmouseover="this.style.backgroundColor='${hoverColor}'; this.style.transform='translateZ(0) scale(1.15)';"
                    onmouseout="this.style.backgroundColor='${color}'; this.style.transform='translateZ(0) scale(1)';">${count > 1 ? count : ''}</div>`,
            className: 'custom-marker',
            iconSize: [radius*2, radius*2],
            iconAnchor: [radius, radius]
        });
    }

    /**
     * 绘制查询结果地图
     */
    async drawQueryResultsMap(userId, directContacts, secondaryContacts) {
        // 确保查询地图已初始化（等待初始化完成）
        await this.initQueryMap();

        // 再次检查地图和标记图层是否存在
        if (!this.map || !this.queryMarkersLayer) {
            console.error('查询地图初始化失败，无法绘制查询结果');
            return;
        }

        setTimeout(() => {
            if (!this.queryMarkersLayer || !this.map) {
                console.error('查询地图或标记图层不存在');
                return;
            }

            // 隐藏地图导览的图层（因为现在共享同一个地图）
            if (this.heatmapLayer && this.map.hasLayer(this.heatmapLayer)) {
                this.map.removeLayer(this.heatmapLayer);
            }
            if (this.markersLayer) {
                this.markersLayer.clearLayers();
            }
            if (this.legendControl && this.legendControl._map === this.map) {
                this.map.removeControl(this.legendControl);
            }

            // 清除之前的查询标记引用和图层
            this.queryContactMarkers = [];
            
            this.queryMarkersLayer.clearLayers();
            // 清除查询热力图图层
            if (this.queryHeatmapLayer) {
                this.map.removeLayer(this.queryHeatmapLayer);
                this.queryHeatmapLayer = null;
            }
            // 清除轨迹线条（只删除轨迹线条，不删除背景图层）
            this.map.eachLayer(layer => {
                if (layer instanceof L.Polyline) {
                    this.map.removeLayer(layer);
                }
            });
            
            // 确保背景图层存在（如果被误删，重新添加）
            if (this.baseTileLayer && !this.map.hasLayer(this.baseTileLayer)) {
                this.baseTileLayer.addTo(this.map);
            }
            
            // 强制刷新背景图层，确保瓦片加载
            if (this.baseTileLayer) {
                this.baseTileLayer.redraw();
            }
            
            // 确保查询图例显示（如果不存在则创建）
            if (!this.queryLegendControl) {
                this.createQueryMapLegend();
            } else if (this.queryLegendControl._map !== this.map) {
                this.map.addControl(this.queryLegendControl);
            }
            
            // 再次刷新地图大小，确保容器尺寸正确
            setTimeout(() => {
                if (this.map) {
                    this.map.invalidateSize();
                }
            }, 100);

            const allPoints = [];
            directContacts.forEach(contact => {
                const otherId = contact.id1 === userId ? contact.id2 : contact.id1;
                contact.points.forEach(point => allPoints.push({
                    ...point, 
                    contact_type: 'direct',
                    otherId: otherId
                }));
            });
            secondaryContacts.forEach(contact => {
                const otherId = contact.id1 === userId ? contact.id2 : contact.id1;
                contact.points.forEach(point => allPoints.push({
                    ...point, 
                    contact_type: 'indirect',
                    otherId: otherId,
                    through: contact.through
                }));
            });

            const groups = new Map();
            allPoints.forEach(d => {
                const key = `${d.lng.toFixed(4)}|${d.lat.toFixed(4)}`;
                if (!groups.has(key)) groups.set(key, []);
                groups.get(key).push(d);
            });

            const mapPoints = [];
            const heatmapPoints = [];
            const popupData = new Map();
            
            groups.forEach((points, key) => {
                const [lng, lat] = key.split('|').map(Number);
                mapPoints.push([lat, lng]);
                const count = points.length;
                const hasDirect = points.some(c => c.contact_type === 'direct');
                const hasIndirect = points.some(c => c.contact_type === 'indirect');
                
                // 收集热力图数据
                heatmapPoints.push([lat, lng, count]);
                
                // 收集 Canvas 渲染数据
                let color;
                if (hasDirect && hasIndirect) {
                    color = "#667eea";
                } else if (hasDirect && !hasIndirect) {
                    color = "#dc2626";
                } else {
                    color = "#f59e0b";
                }
                
                // 构建弹出框内容
                const directPoints = points.filter(c => c.contact_type === 'direct');
                const indirectPoints = points.filter(c => c.contact_type === 'indirect');
                const directUserIds = [...new Set(directPoints.map(p => p.otherId))];
                const indirectUsers = [...new Set(indirectPoints.map(p => `${p.otherId}(通过${p.through})`))];
                
                let popupContent = `<strong>位置: </strong>${lat.toFixed(6)}, ${lng.toFixed(6)}<br>`;
                if (directPoints.length > 0) {
                    popupContent += `<strong>密接 (${directPoints.length}次): </strong><br>`;
                    popupContent += `与用户: ${directUserIds.join(', ')}<br>`;
                }
                if (indirectPoints.length > 0) {
                    popupContent += `<strong>次密接 (${indirectPoints.length}次): </strong><br>`;
                    popupContent += `与用户: ${indirectUsers.join(', ')}<br>`;
                }
                popupData.set(`${lat}|${lng}`, popupContent);
                
                // 根据密接次数动态调整点的大小（最小6px，最大16px）
                // 使用平方根缩放，降低面积膨胀速度
                const minSize = 6;
                const maxSize = 16; // 降低最大尺寸
                const minCount = 1;
                const maxCount = 200; // 提高最大计数假设值，让增长更慢
                // 使用平方根缩放：sqrt(count)，比对数更慢
                const sqrtCount = Math.sqrt(Math.max(count, minCount));
                const sqrtMax = Math.sqrt(maxCount);
                const size = minSize + (maxSize - minSize) * (sqrtCount / sqrtMax);
                const anchor = size / 2;
                
                // 使用 Canvas 渲染（性能更好）
                const marker = L.circleMarker([lat, lng], {
                    radius: size / 2,
                    fillColor: color,
                    color: '#ffffff',
                    weight: 1,
                    opacity: 1,
                    fillOpacity: 0.9
                }).addTo(this.queryMarkersLayer);
                
                marker.bindPopup(popupContent);
                
                // 保存标记引用，用于在绘制轨迹时隐藏
                this.queryContactMarkers.push(marker);
            });

            if (mapPoints.length > 0) {
                const bounds = L.latLngBounds(mapPoints);
                // 设置标志，避免 fitBounds 触发缩放事件导致的重绘
                this.isAdjustingQueryMapView = true;
                this.map.fitBounds(bounds, { padding: [50, 50] });
                // 使用 setTimeout 确保 fitBounds 完成后再重置标志
                setTimeout(() => {
                    this.isAdjustingQueryMapView = false;
                }, 300);
            } else {
                this.map.setView([39.9042, 116.4074], 12);
            }

            this.map.invalidateSize();
        }, 150);
    }

    // 创建查询地图图标
    /**
     * 创建查询地图标记图标（固定大小，优化性能）
     * @param {number} count - 接触点数量
     * @param {boolean} hasDirect - 是否有直接密接
     * @param {boolean} hasIndirect - 是否有次密接
     * @param {number} zoomLevel - 地图缩放级别（已废弃，保持固定大小）
     */
    createQueryMapIcon(count, hasDirect, hasIndirect, zoomLevel = null) {
        let color, hoverColor;
        if (hasDirect && hasIndirect) {
            // 混合：既有直接密接又有次密接
            color = "#667eea"; // 混合
            hoverColor = "#818cf8"; // 混合悬浮 (indigo-400)
        } else if (hasDirect && !hasIndirect) {
            // 只有直接密接
            color = "#dc2626"; // 密接 (rose-600)
            hoverColor = "#ef4444"; // 密接悬浮 (rose-500)
        } else if (hasIndirect && !hasDirect) {
            // 只有次密接
            color = "#f59e0b"; // 次密接 (amber-500)
            hoverColor = "#fbbf24"; // 次密接悬浮 (amber-400)
        } else {
            // 默认情况（理论上不应该发生）
            color = "#dc2626"; // 密接 (rose-600)
            hoverColor = "#ef4444"; // 密接悬浮 (rose-500)
        }
        
        // 使用固定大小，提高性能
        const radius = 8; // 固定半径 8px
        
        return L.divIcon({
            html: `<div class="map-marker" style="width: ${radius*2}px; height: ${radius*2}px; border-radius: 50%; background-color: ${color}; 
                    display: flex; align-items: center; justify-content: center; color: white; font-weight: bold;
                    box-shadow: 0 2px 5px rgba(0,0,0,0.2); transition: background-color 0.2s, transform 0.2s; cursor: pointer;
                    will-change: transform; transform: translateZ(0); backface-visibility: hidden; font-size: 10px;"
                    onmouseover="this.style.backgroundColor='${hoverColor}'; this.style.transform='translateZ(0) scale(1.15)';"
                    onmouseout="this.style.backgroundColor='${color}'; this.style.transform='translateZ(0) scale(1)';">${count > 1 ? count : ''}</div>`,
            className: 'custom-marker',
            iconSize: [radius*2, radius*2],
            iconAnchor: [radius, radius]
        });
    }

    /**
     * 渲染查询结果
     */
    renderQueryResults(userId, directContacts, secondaryContacts) {
        const resultsContainer = document.getElementById('query-results');

        // 保存当前查询数据
        this.currentQueryUserId = userId;
        this.currentDirectContacts = directContacts;
        this.currentSecondaryContacts = secondaryContacts;
        this.queryContactType = 'direct'; // 默认显示直接密接

        // 绘制地图（异步，不等待完成，避免阻塞 UI）
        this.drawQueryResultsMap(userId, directContacts, secondaryContacts).catch(err => {
            console.error('绘制查询结果地图失败:', err);
        });

        // 初始化切换按钮
        this.initContactTypeButtons();

        // 渲染列表
        this.renderContactList();
    }

    /**
     * 初始化联系人类型切换按钮
     */
    initContactTypeButtons() {
        // 移除旧的事件监听器（如果存在）
        const directBtn = document.getElementById('contact-type-direct-btn');
        const indirectBtn = document.getElementById('contact-type-indirect-btn');
        
        if (directBtn) {
            directBtn.replaceWith(directBtn.cloneNode(true));
        }
        if (indirectBtn) {
            indirectBtn.replaceWith(indirectBtn.cloneNode(true));
        }

        // 重新获取按钮并绑定事件
        const newDirectBtn = document.getElementById('contact-type-direct-btn');
        const newIndirectBtn = document.getElementById('contact-type-indirect-btn');

        if (newDirectBtn) {
            newDirectBtn.addEventListener('click', () => {
                this.switchContactType('direct');
            });
        }
        if (newIndirectBtn) {
            newIndirectBtn.addEventListener('click', () => {
                this.switchContactType('indirect');
            });
        }

        // 更新按钮样式
        this.updateContactTypeButtons();
    }

    /**
     * 切换联系人类型
     */
    switchContactType(type) {
        this.queryContactType = type;
        this.updateContactTypeButtons();
        this.renderContactList();
    }

    /**
     * 更新联系人类型按钮样式
     */
    updateContactTypeButtons() {
        const directBtn = document.getElementById('contact-type-direct-btn');
        const indirectBtn = document.getElementById('contact-type-indirect-btn');

        if (directBtn && indirectBtn) {
            const baseClasses = 'contact-type-btn flex-1 py-3 text-sm font-medium transition';
            
            if (this.queryContactType === 'direct') {
                // 直接密接按钮：激活状态（黑色），悬浮时保持不变
                directBtn.className = `${baseClasses} border-r border-slate-200 bg-slate-900 hover:bg-slate-900 text-white`;
                // 次密接按钮：未激活状态（白色），悬浮时稍微加深
                indirectBtn.className = `${baseClasses} bg-white hover:bg-slate-50 text-slate-700`;
            } else {
                // 次密接按钮：激活状态（黑色），悬浮时保持不变
                indirectBtn.className = `${baseClasses} bg-slate-900 hover:bg-slate-900 text-white`;
                // 直接密接按钮：未激活状态（白色），悬浮时稍微加深
                directBtn.className = `${baseClasses} border-r border-slate-200 bg-white hover:bg-slate-50 text-slate-700`;
            }
            
            // 确保 data-type 属性存在
            directBtn.setAttribute('data-type', 'direct');
            indirectBtn.setAttribute('data-type', 'indirect');
        }
    }

    /**
     * 渲染联系人列表
     */
    renderContactList() {
        const resultsContainer = document.getElementById('query-results');
        if (!resultsContainer) return;

        const userId = this.currentQueryUserId;
        const contacts = this.queryContactType === 'direct' 
            ? this.currentDirectContacts 
            : this.currentSecondaryContacts;

        // 结果列表渲染逻辑
        if (!userId) {
            // 没有查询用户时，显示提示信息
            const typeText = this.queryContactType === 'direct' ? '直接密接' : '次密接';
            resultsContainer.innerHTML = `
                <div class="text-sm md:text-base text-slate-500 text-center py-8">
                    输入用户 ID 查询${typeText}记录
                </div>
            `;
            return;
        }

        if (contacts.length === 0) {
            const typeText = this.queryContactType === 'direct' ? '密接' : '次密接';
            resultsContainer.innerHTML = `
                <div class="flex flex-col items-center justify-center py-10 text-sm md:text-base text-slate-500">
                    <p class="mb-1">未找到用户 <span class="font-semibold text-slate-700">${this.currentQueryUserId}</span> 的${typeText}记录</p>
                    <p class="text-xs md:text-sm text-slate-400">请确认用户 ID 是否正确，或尝试其他用户</p>
                </div>
            `;
            return;
        }

        let html = `<div class="space-y-2.5">`;

        contacts.forEach(contact => {
            const otherId = contact.id1 === this.currentQueryUserId ? contact.id2 : contact.id1;
            const timePeriodsText = contact.timePeriods
                .map(p => p.start === p.end ? `${p.start}` : `${p.start} - ${p.end}`)
                .join(', ');
            
            const isDirect = this.queryContactType === 'direct';
            const badgeClass = isDirect ? 'bg-rose-600' : 'bg-amber-500';
            const badgeText = isDirect ? '密接' : '次密接';
            
            html += `
                <div
                    class="contact-card group flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-4 cursor-pointer hover:bg-slate-50 transition min-h-[5rem]"
                    data-id1="${this.currentQueryUserId}"
                    data-id2="${otherId}"
                >
                    <div class="flex flex-col gap-2 flex-1 min-w-0">
                        <div class="flex items-center gap-3">
                            <span class="text-sm text-slate-800">ID: <span class="font-mono text-slate-900 user-id-highlight cursor-pointer hover:text-slate-600 font-semibold">${otherId}</span></span>
                        </div>
                        ${!isDirect ? `
                        <div class="text-sm text-slate-500">
                            <span class="text-slate-400">通过 </span>
                            <span class="font-mono text-slate-700">${contact.through}</span>
                            <span class="text-slate-400"> 接触</span>
                        </div>
                        ` : ''}
                        <div class="text-sm text-slate-500">
                            <span class="text-slate-400">时间段: </span>
                            <span class="font-mono text-slate-700">${timePeriodsText}</span>
                        </div>
                    </div>
                    <div class="ml-4 flex-shrink-0">
                        <span class="inline-flex items-center rounded-full ${badgeClass} text-white text-sm px-2.5 py-1">
                            ${badgeText}
                        </span>
                    </div>
                </div>
            `;
        });

        html += `</div>`;
        resultsContainer.innerHTML = html;

        // 绑定用户ID点击事件（点击 ID 继续向下钻取）
        document.querySelectorAll('.user-id-highlight').forEach(element => {
            element.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const clickedUserId = parseInt(element.textContent.trim());
                if (!isNaN(clickedUserId) && clickedUserId !== this.currentQueryUserId) {
                    // 调用app实例的queryUser方法
                    if (window.app) {
                        window.app.queryUser(clickedUserId);
                    }
                }
            });
        });

        // 绑定卡片点击事件（点击整行查看轨迹）
        document.querySelectorAll('.contact-card').forEach(card => {
            card.addEventListener('click', () => {
                const id1 = parseInt(card.dataset.id1);
                const id2 = parseInt(card.dataset.id2);
                if (!isNaN(id1) && !isNaN(id2) && window.app) {
                    window.app.showTrajectory(id1, id2);
                }
            });
        });
    }

    /**
     * 计算并渲染新增密接列表
     */
    async calculateAndRenderNewContacts(currentTimestamp) {
        const newContactsListEl = document.getElementById('new-contacts-list');
        if (!newContactsListEl) return;

        // 获取当前时间戳的所有密接对
        const currentContactsSet = new Set();
        const currentContactsData = [];
        
        this.dataLoader.contacts.forEach(contact => {
            // 检查当前时间戳是否在这个密接对的时间段内
            const hasCurrentTimestamp = contact.points.some(
                point => point.timestamp === currentTimestamp
            );
            
            if (hasCurrentTimestamp) {
                const [smaller, larger] = contact.id1 < contact.id2 
                    ? [contact.id1, contact.id2] 
                    : [contact.id2, contact.id1];
                const key = `${smaller}|${larger}`;
                
                if (!currentContactsSet.has(key)) {
                    currentContactsSet.add(key);
                    // 获取当前时间戳对应的经纬度
                    const currentPoint = contact.points.find(
                        point => point.timestamp === currentTimestamp
                    );
                    currentContactsData.push({
                        id1: smaller,
                        id2: larger,
                        contact_type: contact.contact_type || 'direct',
                        through: contact.through,
                        timestamp: currentTimestamp,
                        lat: currentPoint ? currentPoint.lat : null,
                        lng: currentPoint ? currentPoint.lng : null
                    });
                }
            }
        });

        // 计算新增密接（当前时间戳有但上一个时间戳没有的）
        let newContacts = [];
        
        // 获取上一个时间戳
        const currentIndex = this.dataLoader.allTimestamps.indexOf(currentTimestamp);
        const previousTimestamp = currentIndex > 0 ? this.dataLoader.allTimestamps[currentIndex - 1] : null;
        
        if (previousTimestamp !== null) {
            // 查询上一个时间戳的数据
            try {
                const previousResponse = await fetch(`http://127.0.0.1:5000/api/contacts/${previousTimestamp}`);
                if (previousResponse.ok) {
                    const previousData = await previousResponse.json();
                    
                    // 处理上一个时间戳的数据，建立集合
                    const previousContactsSet = new Set();
                    previousData.forEach(record => {
                        const [smaller, larger] = record.id1 < record.id2 
                            ? [record.id1, record.id2] 
                            : [record.id2, record.id1];
                        const key = `${smaller}|${larger}`;
                        previousContactsSet.add(key);
                    });
                    
                    // 计算新增：当前时间戳有但上一个时间戳没有的
                    newContacts = currentContactsData.filter(contact => {
                        const key = `${contact.id1}|${contact.id2}`;
                        return !previousContactsSet.has(key);
                    });
                } else {
                    // 如果查询失败，使用当前数据作为新增
                    newContacts = currentContactsData;
                }
            } catch (error) {
                console.error('查询上一个时间戳数据失败:', error);
                // 如果查询失败，使用当前数据作为新增
                newContacts = currentContactsData;
            }
        } else {
            // 没有上一个时间戳（首次加载），显示所有当前密接
            newContacts = currentContactsData;
        }

        // 保存所有新增密接数据
        this.allNewContacts = newContacts;

        // 渲染新增密接列表
        this.renderNewContactsList(currentTimestamp);
    }

    /**
     * 渲染新增密接列表
     */
    renderNewContactsList(timestamp) {
        const newContactsListEl = document.getElementById('new-contacts-list');
        if (!newContactsListEl) return;

        // 如果没有时间戳（初始化时），显示等待信息
        if (timestamp === null || timestamp === undefined) {
            const typeText = this.newContactType === 'direct' ? '新增密接' : '新增次密接';
            newContactsListEl.innerHTML = `
                <div class="text-sm md:text-base text-slate-500 text-center py-8">
                    等待数据加载...
                </div>
            `;
            return;
        }

        // 根据当前选择的类型过滤
        const filteredContacts = this.allNewContacts.filter(contact => {
            return contact.contact_type === this.newContactType;
        });

        if (filteredContacts.length === 0) {
            const typeText = this.newContactType === 'direct' ? '新增密接' : '新增次密接';
            // 检查是否有数据但被过滤掉了，还是没有数据
            if (this.allNewContacts.length === 0) {
                newContactsListEl.innerHTML = `
                    <div class="text-sm md:text-base text-slate-500 text-center py-8">
                        当前时间戳 ${timestamp} 无新增密接记录
                    </div>
                `;
            } else {
                newContactsListEl.innerHTML = `
                    <div class="text-sm md:text-base text-slate-500 text-center py-8">
                        当前时间戳 ${timestamp} 无${typeText}记录
                    </div>
                `;
            }
            return;
        }

        let html = `<div class="space-y-2.5">`;

        filteredContacts.forEach(contact => {
            const isDirect = contact.contact_type === 'direct';
            const badgeClass = isDirect ? 'bg-rose-600' : 'bg-amber-500';
            const badgeText = isDirect ? '密接' : '次密接';
            
            html += `
                <div
                    class="new-contact-card group flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-4 cursor-pointer hover:bg-slate-50 transition min-h-[5rem]"
                    data-id1="${contact.id1}"
                    data-id2="${contact.id2}"
                >
                    <div class="flex flex-col gap-1 flex-1 min-w-0">
                        <div class="flex items-center gap-3">
                            <span class="text-sm text-slate-800">ID: <span class="font-mono text-slate-900 user-id-highlight cursor-pointer hover:text-slate-600 font-semibold">${contact.id1}</span> ↔ <span class="font-mono text-slate-900 user-id-highlight cursor-pointer hover:text-slate-600 font-semibold">${contact.id2}</span></span>
                        </div>
                        ${!isDirect && contact.through ? `
                        <div class="text-sm text-slate-500">
                            <span class="text-slate-400">通过 </span>
                            <span class="font-mono text-slate-700">${contact.through}</span>
                            <span class="text-slate-400"> 接触</span>
                        </div>
                        ` : ''}
                        ${contact.lat !== null && contact.lng !== null ? `
                        <div class="text-sm text-slate-500">
                            <span class="text-slate-400">位置: </span>
                            <span class="font-mono text-slate-700">${contact.lat.toFixed(6)}, ${contact.lng.toFixed(6)}</span>
                        </div>
                        ` : ''}
                    </div>
                    <div class="ml-4 flex-shrink-0">
                        <span class="inline-flex items-center rounded-full ${badgeClass} text-white text-sm px-2.5 py-1">
                            ${badgeText}
                        </span>
                    </div>
                </div>
            `;
        });

        html += `</div>`;
        newContactsListEl.innerHTML = html;

        // 绑定用户ID点击事件（点击 ID 继续向下钻取）
        document.querySelectorAll('.new-contact-card .user-id-highlight').forEach(element => {
            element.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const clickedUserId = parseInt(element.textContent.trim());
                if (!isNaN(clickedUserId) && window.app) {
                    // 调用app实例的queryUser方法
                    window.app.queryUser(clickedUserId);
                }
            });
        });

        // 绑定卡片点击事件（点击整行查看轨迹）
        document.querySelectorAll('.new-contact-card').forEach(card => {
            card.addEventListener('click', () => {
                const id1 = parseInt(card.dataset.id1);
                const id2 = parseInt(card.dataset.id2);
                if (!isNaN(id1) && !isNaN(id2) && window.app) {
                    // 在总览视图中显示轨迹明细
                    window.app.showNewContactsTrajectory(id1, id2);
                }
            });
        });

        // 绑定新增密接类型切换按钮事件
        this.setupNewContactTypeButtons();
    }

    /**
     * 设置新增密接类型切换按钮
     */
    setupNewContactTypeButtons() {
        // 移除旧的事件监听器（通过克隆节点）
        const directBtn = document.getElementById('new-contact-type-direct-btn');
        const indirectBtn = document.getElementById('new-contact-type-indirect-btn');
        
        if (directBtn) {
            const newDirectBtn = directBtn.cloneNode(true);
            directBtn.parentNode.replaceChild(newDirectBtn, directBtn);
        }
        if (indirectBtn) {
            const newIndirectBtn = indirectBtn.cloneNode(true);
            indirectBtn.parentNode.replaceChild(newIndirectBtn, indirectBtn);
        }

        // 重新获取按钮并绑定事件
        const newDirectBtn = document.getElementById('new-contact-type-direct-btn');
        const newIndirectBtn = document.getElementById('new-contact-type-indirect-btn');

        if (newDirectBtn) {
            newDirectBtn.addEventListener('click', () => {
                this.switchNewContactType('direct');
            });
        }
        if (newIndirectBtn) {
            newIndirectBtn.addEventListener('click', () => {
                this.switchNewContactType('indirect');
            });
        }

        // 更新按钮样式
        this.updateNewContactTypeButtons();
        
        // 如果没有数据，也渲染一次列表以显示提示信息
        if (!this.mapAnimation.currentTimestamp) {
            this.renderNewContactsList(null);
        }
    }

    /**
     * 切换新增密接类型
     */
    switchNewContactType(type) {
        this.newContactType = type;
        this.updateNewContactTypeButtons();
        // 重新渲染列表（使用当前时间戳）
        if (this.mapAnimation.currentTimestamp) {
            this.renderNewContactsList(this.mapAnimation.currentTimestamp);
        }
    }

    /**
     * 更新新增密接类型按钮样式
     */
    updateNewContactTypeButtons() {
        const directBtn = document.getElementById('new-contact-type-direct-btn');
        const indirectBtn = document.getElementById('new-contact-type-indirect-btn');

        if (directBtn && indirectBtn) {
            const baseClasses = 'new-contact-type-btn flex-1 py-3 text-sm font-medium transition';
            
            if (this.newContactType === 'direct') {
                // 新增密接按钮：激活状态（黑色），悬浮时保持不变
                directBtn.className = `${baseClasses} border-r border-slate-200 bg-slate-900 hover:bg-slate-900 text-white`;
                // 新增次密接按钮：未激活状态（白色），悬浮时稍微加深
                indirectBtn.className = `${baseClasses} bg-white hover:bg-slate-50 text-slate-700`;
            } else {
                // 新增次密接按钮：激活状态（黑色），悬浮时保持不变
                indirectBtn.className = `${baseClasses} bg-slate-900 hover:bg-slate-900 text-white`;
                // 新增密接按钮：未激活状态（白色），悬浮时稍微加深
                directBtn.className = `${baseClasses} border-r border-slate-200 bg-white hover:bg-slate-50 text-slate-700`;
            }
            
            // 确保 data-type 属性存在
            directBtn.setAttribute('data-type', 'direct');
            indirectBtn.setAttribute('data-type', 'indirect');
        }
    }

    /**
     * 在主地图上绘制轨迹（用于总览视图）
     */
    drawMapTrajectory(trajectory, id1, id2) {
        if (!this.map) return;

        setTimeout(() => {
            // 隐藏热力图图层，避免遮挡轨迹
            if (this.heatmapLayer) {
                this.map.removeLayer(this.heatmapLayer);
                this.heatmapLayer = null;
            }
            
            // 隐藏密接接触点标记（而不是删除），避免遮挡轨迹
            this.mapContactMarkers.forEach(marker => {
                if (marker && marker._map) {
                    if (typeof marker.setOpacity === 'function') {
                        marker.setOpacity(0);
                    } else if (typeof marker.setStyle === 'function') {
                        marker.setStyle({ opacity: 0, fillOpacity: 0 });
                    }
                }
            });
            
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
                // 使用OpenStreetMap
                this.baseTileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                    subdomains: ['a', 'b', 'c']
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
            
            // 使用标准 Leaflet 折线绘制轨迹
            const polyline = L.polyline(points, {
                color: '#667eea',
                weight: 4,
                opacity: 0.7,
                lineCap: 'round',
                lineJoin: 'round',
                isTrajectoryPolyline: true
            }).addTo(this.map);
            
            // 添加标记用于点击检测和弹出框
            // 起点标记（红色圆点）
            const startMarker = L.circleMarker(startPoint, {
                radius: 7.5,
                fillColor: 'red',
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
            const endMarker = L.circleMarker(endPoint, {
                radius: 7.5,
                fillColor: 'green',
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

            // 中间点标记
            Object.values(locationGroups).forEach((group, index) => {
                if (index === 0 || index === Object.values(locationGroups).length - 1) return;
                const periodText = group.timePeriods.map(p => p.start === p.end ? `${p.start}` : `${p.start} - ${p.end}`).join(', ');
                L.marker([group.lat, group.lng], {
                    icon: L.divIcon({
                        html: '<div style="width: 1px; height: 1px;"></div>',
                        iconSize: [12, 12],
                        iconAnchor: [6, 6]
                    }),
                    isTrajectoryMarker: true,
                    opacity: 0
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
                        <table class="border-collapse text-sm text-slate-700">
                            <thead>
                                <tr class="bg-slate-50">
                                    <th class="border border-slate-200 px-2 py-1.5 text-left text-sm text-slate-600 font-semibold">序号</th>
                                    <th class="border border-slate-200 px-2 py-1.5 text-left text-sm text-slate-600 font-semibold">经纬度</th>
                                    <th class="border border-slate-200 px-2 py-1.5 text-left text-sm text-slate-600 font-semibold whitespace-nowrap">时间戳</th>
                                    <th class="border border-slate-200 px-2 py-1.5 text-left text-sm text-slate-600 font-semibold">接触类型</th>
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
                                    <td class="border border-slate-200 px-2 py-1.5 text-sm text-slate-700 font-mono">${index + 1}</td>
                                    <td class="border border-slate-200 px-2 py-1.5 text-sm text-slate-700">
                                        <span class="font-mono">${group.lat.toFixed(6)}, ${group.lng.toFixed(6)}</span>
                                    </td>
                                    <td class="border border-slate-200 px-2 py-1.5 text-sm text-slate-700">
                                        <span class="font-mono">${timestampsText}</span>
                                    </td>
                                    <td class="border border-slate-200 px-2 py-1.5">
                                        <span class="inline-flex items-center rounded-full ${badgeClass} text-white text-sm px-2.5 py-1">
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
    }

    /**
     * 绘制轨迹
     */
    drawTrajectory(trajectory, id1, id2) {
        if (!this.trajectoryMap) {
            this.trajectoryMap = L.map('trajectory-map', {
                minZoom: 0,  // 允许缩放到最小级别
                maxZoom: 19, // 允许缩放到最大级别
                attributionControl: false // 不显示默认的版权标签
            }).setView([0, 0], 13);
            // 使用OpenStreetMap
            const trajectoryTileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                subdomains: ['a', 'b', 'c']
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
            color: '#667eea',
            weight: 4,
            opacity: 0.7,
            lineJoin: 'round'
        }).addTo(this.trajectoryMap);

        // 起点标记
        L.marker(points[0], {
            icon: L.divIcon({
                html: '<div style="background-color: red; width: 15px; height: 15px; border-radius: 50%; border: 2px solid white;"></div>',
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
                html: '<div style="background-color: green; width: 15px; height: 15px; border-radius: 50%; border: 2px solid white;"></div>',
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
                    html: `<div style="background-color: #667eea; width: 12px; height: 12px; border-radius: 50%; border: 2px solid white;"></div>`,
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
    }
}