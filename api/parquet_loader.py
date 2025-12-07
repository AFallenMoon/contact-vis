"""
Parquet 数据访问层
提供从 Parquet 文件读取轨迹数据的接口
"""
import pyarrow.parquet as pq
import pyarrow.compute as pc
from pathlib import Path
from typing import List, Dict
from collections import OrderedDict


class ParquetDataLoader:
    """Parquet 数据加载器"""
    
    def __init__(self, base_path: str, preload_hot_data: bool = True):
        """
        初始化 Parquet 数据加载器
        
        Args:
            base_path: Parquet 数据的基础路径（包含 contacts 和 contacts2 目录或文件）
            preload_hot_data: 是否预加载热点数据（时间戳列表、边界等），默认True
        """
        self.base_path = Path(base_path)
        # 支持目录或文件路径
        contacts_path = self.base_path / 'contacts'
        contacts2_path = self.base_path / 'contacts2'
        
        # 检查路径是否存在，如果不存在则尝试直接使用 base_path 下的文件
        if contacts_path.exists():
            self.contacts_path = contacts_path
        elif (self.base_path / 'contacts.parquet').exists():
            self.contacts_path = self.base_path / 'contacts.parquet'
        else:
            # 尝试查找所有 .parquet 文件（可能是单个文件）
            parquet_files = list(self.base_path.glob('*.parquet'))
            if parquet_files:
                # 假设第一个文件是 contacts
                self.contacts_path = parquet_files[0]
                print(f"[WARN] 未找到 contacts 目录，使用文件: {self.contacts_path}")
            else:
                self.contacts_path = contacts_path  # 保持原路径，后续会检查存在性
        
        if contacts2_path.exists():
            self.contacts2_path = contacts2_path
        elif (self.base_path / 'contacts2.parquet').exists():
            self.contacts2_path = self.base_path / 'contacts2.parquet'
        else:
            # 尝试查找所有 .parquet 文件
            parquet_files = list(self.base_path.glob('*.parquet'))
            if len(parquet_files) > 1:
                # 假设第二个文件是 contacts2
                self.contacts2_path = parquet_files[1]
                print(f"[WARN] 未找到 contacts2 目录，使用文件: {self.contacts2_path}")
            else:
                self.contacts2_path = contacts2_path  # 保持原路径，后续会检查存在性
        
        # 仅在路径不存在时输出警告
        if not self.contacts_path.exists() and not self.contacts2_path.exists():
            print(f"[WARN] 数据路径不存在: contacts={self.contacts_path}, contacts2={self.contacts2_path}")
        
        # 缓存所有时间戳
        self._timestamps_cache = None
        self._bounds_cache = None
        
        # 按时间戳缓存查询结果
        self._contacts_cache = OrderedDict()
        self._max_cache_size = 1000
        
        # 缓存用户查询结果
        self._user_contacts_cache = OrderedDict()
        self._user_secondary_cache = OrderedDict()
        self._user_cache_size = 2000
        
        # 缓存轨迹查询结果
        self._trajectory_cache = OrderedDict()
        self._trajectory_cache_size = 1000
        
        if preload_hot_data:
            self._preload_hot_data()
    
    def _preload_hot_data(self):
        """预加载热点数据"""
        try:
            # 预加载时间戳列表（通常首次请求会用到）
            _ = self.get_all_timestamps()
            # 预加载边界（通常首次请求会用到）
            _ = self.get_bounds()
            print("[INIT] 热点数据预加载完成")
        except Exception as e:
            print(f"[WARN] 预加载热点数据失败: {e}")
    
    # 注意：项目使用的时间戳是自增整数，不是Unix时间戳
    # 因此不需要datetime转换函数
    
    def get_all_timestamps(self) -> List[int]:
        """获取所有唯一的时间戳"""
        if self._timestamps_cache is not None:
            return self._timestamps_cache
        
        timestamps = set()
        
        # 直接从数据中读取所有时间戳（更可靠）
        timestamps.update(self._get_timestamps_from_data('contacts'))
        timestamps.update(self._get_timestamps_from_data('contacts2'))
        
        result = sorted(list(timestamps))
        self._timestamps_cache = result
        return result
    
    def _get_timestamps_from_data(self, table_name: str) -> set:
        """从数据中读取所有时间戳"""
        timestamps = set()
        path = self.contacts_path if table_name == 'contacts' else self.contacts2_path
        
        if not path.exists():
            print(f"⚠️ {table_name} 路径不存在: {path}")
            return timestamps
        
        try:
            table = pq.read_table(
                path, 
                columns=['timestamp'],
                use_pandas_metadata=False
            )
            if len(table) == 0:
                print(f"⚠️ {table_name} 数据为空")
                return timestamps
            unique_timestamps = pc.unique(table['timestamp'])
            timestamps.update(unique_timestamps.to_pylist())
            if len(timestamps) > 0:
                print(f"[INIT] {table_name}: {len(timestamps)} 个时间戳")
        except Exception as e:
            print(f"[ERROR] 扫描 {table_name} 时间戳失败: {e}")
        
        return timestamps
    
    def get_contacts_by_timestamp(self, timestamp: int) -> List[Dict]:
        """获取指定时间戳的所有密接对数据"""
        if timestamp in self._contacts_cache:
            self._contacts_cache.move_to_end(timestamp)
            return self._contacts_cache[timestamp]
        
        result = []
        
        # 读取 contacts 数据
        if self.contacts_path.exists():
            try:
                table = pq.read_table(
                    self.contacts_path,
                    columns=['user_id1', 'user_id2', 'timestamp', 'longitude', 'latitude'],
                    filters=[('timestamp', '==', timestamp)],
                    use_pandas_metadata=False
                )
                
                for i in range(len(table)):
                    result.append({
                        'id1': int(table['user_id1'][i].as_py()),
                        'id2': int(table['user_id2'][i].as_py()),
                        'timestamp': int(table['timestamp'][i].as_py()),
                        'lng': float(table['longitude'][i].as_py()),
                        'lat': float(table['latitude'][i].as_py()),
                        'contact_type': 'direct'
                    })
            except Exception as e:
                print(f"[WARN] 读取 contacts 数据失败: {e}")
        
        # 读取 contacts2 数据
        if self.contacts2_path.exists():
            try:
                table = pq.read_table(
                    self.contacts2_path,
                    columns=['user_id1', 'user_id2', 'through_id', 'timestamp', 'longitude', 'latitude'],
                    filters=[('timestamp', '==', timestamp)],
                    use_pandas_metadata=False
                )
                
                for i in range(len(table)):
                    result.append({
                        'id1': int(table['user_id1'][i].as_py()),
                        'id2': int(table['user_id2'][i].as_py()),
                        'timestamp': int(table['timestamp'][i].as_py()),
                        'lng': float(table['longitude'][i].as_py()),
                        'lat': float(table['latitude'][i].as_py()),
                        'contact_type': 'indirect',
                        'through': int(table['through_id'][i].as_py())
                    })
            except Exception as e:
                print(f"[WARN] 读取 contacts2 数据失败: {e}")
        
        if len(self._contacts_cache) >= self._max_cache_size:
            self._contacts_cache.popitem(last=False)
        
        self._contacts_cache[timestamp] = result
        return result
    
    def get_bounds(self) -> Dict[str, float]:
        """获取所有接触记录的经纬度边界"""
        if self._bounds_cache is not None:
            return self._bounds_cache
        
        min_lng = float('inf')
        max_lng = float('-inf')
        min_lat = float('inf')
        max_lat = float('-inf')
        
        # 从 contacts 读取边界
        if self.contacts_path.exists():
            try:
                table = pq.read_table(
                    self.contacts_path,
                    columns=['longitude', 'latitude'],
                    use_pandas_metadata=False
                )
                if len(table) > 0:
                    lng_min = pc.min(table['longitude']).as_py()
                    lng_max = pc.max(table['longitude']).as_py()
                    lat_min = pc.min(table['latitude']).as_py()
                    lat_max = pc.max(table['latitude']).as_py()
                    
                    min_lng = min(min_lng, lng_min)
                    max_lng = max(max_lng, lng_max)
                    min_lat = min(min_lat, lat_min)
                    max_lat = max(max_lat, lat_max)
            except Exception as e:
                print(f"[WARN] 读取 contacts 边界失败: {e}")
        
        # 从 contacts2 读取边界
        if self.contacts2_path.exists():
            try:
                table = pq.read_table(
                    self.contacts2_path,
                    columns=['longitude', 'latitude'],
                    use_pandas_metadata=False
                )
                if len(table) > 0:
                    lng_min = pc.min(table['longitude']).as_py()
                    lng_max = pc.max(table['longitude']).as_py()
                    lat_min = pc.min(table['latitude']).as_py()
                    lat_max = pc.max(table['latitude']).as_py()
                    
                    min_lng = min(min_lng, lng_min)
                    max_lng = max(max_lng, lng_max)
                    min_lat = min(min_lat, lat_min)
                    max_lat = max(max_lat, lat_max)
            except Exception as e:
                print(f"[WARN] 读取 contacts2 边界失败: {e}")
        
        # 如果未找到数据，返回默认边界
        if min_lng == float('inf'):
            bounds = {
                'minLng': 116.0,
                'maxLng': 117.0,
                'minLat': 39.0,
                'maxLat': 40.0
            }
        else:
            bounds = {
                'minLng': float(min_lng),
                'maxLng': float(max_lng),
                'minLat': float(min_lat),
                'maxLat': float(max_lat)
            }
        
        self._bounds_cache = bounds
        return bounds
    
    def get_user_contacts(self, user_id: int) -> List[Dict]:
        """获取指定用户的直接密接"""
        cache_key = (user_id, 'direct')
        
        # 检查缓存
        if cache_key in self._user_contacts_cache:
            self._user_contacts_cache.move_to_end(cache_key)
            return self._user_contacts_cache[cache_key]
        
        result = []
        
        if self.contacts_path.exists():
            try:
                table = pq.read_table(
                    self.contacts_path,
                    columns=['user_id1', 'user_id2', 'timestamp', 'longitude', 'latitude'],
                    use_pandas_metadata=False
                )
                df = table.to_pandas()
                
                mask = (df['user_id1'] == user_id) | (df['user_id2'] == user_id)
                df_filtered = df[mask]
                
                result = [{
                    'id1': int(row.user_id1),
                    'id2': int(row.user_id2),
                    'timestamp': int(row.timestamp),
                    'lng': float(row.longitude),
                    'lat': float(row.latitude),
                    'contact_type': 'direct'
                } for row in df_filtered.itertuples()]
            except Exception as e:
                print(f"[WARN] 查询用户密接失败: {e}")
        
        # LRU缓存
        if len(self._user_contacts_cache) >= self._user_cache_size:
            self._user_contacts_cache.popitem(last=False)
        
        self._user_contacts_cache[cache_key] = result
        return result
    
    def get_user_secondary_contacts(self, user_id: int) -> List[Dict]:
        """获取指定用户的次密接"""
        cache_key = (user_id, 'secondary')
        
        # 检查缓存
        if cache_key in self._user_secondary_cache:
            self._user_secondary_cache.move_to_end(cache_key)
            return self._user_secondary_cache[cache_key]
        
        result = []
        
        # 先获取直接密接（用于排除，已有缓存）
        direct_contacts = self.get_user_contacts(user_id)
        direct_user_ids = set()
        for contact in direct_contacts:
            other_id = contact['id2'] if contact['id1'] == user_id else contact['id1']
            direct_user_ids.add(other_id)
        
        # 查询 contacts2
        if self.contacts2_path.exists():
            try:
                table = pq.read_table(
                    self.contacts2_path,
                    columns=['user_id1', 'user_id2', 'through_id', 'timestamp', 'longitude', 'latitude'],
                    use_pandas_metadata=False
                )
                df = table.to_pandas()
                
                mask = (df['user_id1'] == user_id) | (df['user_id2'] == user_id)
                df_filtered = df[mask]
                
                for row in df_filtered.itertuples():
                    uid1 = int(row.user_id1)
                    uid2 = int(row.user_id2)
                    other_id = uid2 if uid1 == user_id else uid1
                    
                    if other_id not in direct_user_ids:
                        result.append({
                            'id1': uid1,
                            'id2': uid2,
                            'timestamp': int(row.timestamp),
                            'lng': float(row.longitude),
                            'lat': float(row.latitude),
                            'contact_type': 'indirect',
                            'through': int(row.through_id)
                        })
            except Exception as e:
                print(f"[WARN] 查询用户次密接失败: {e}")
        
        # LRU缓存
        if len(self._user_secondary_cache) >= self._user_cache_size:
            self._user_secondary_cache.popitem(last=False)
        
        self._user_secondary_cache[cache_key] = result
        return result
    
    def get_trajectory(self, id1: int, id2: int) -> List[Dict]:
        """获取两个用户之间的接触轨迹"""
        cache_key = (min(id1, id2), max(id1, id2))
        
        # 检查缓存
        if cache_key in self._trajectory_cache:
            self._trajectory_cache.move_to_end(cache_key)
            return self._trajectory_cache[cache_key]
        
        result = []
        
        # 查询 contacts 中的轨迹
        if self.contacts_path.exists():
            try:
                table = pq.read_table(
                    self.contacts_path,
                    columns=['user_id1', 'user_id2', 'timestamp', 'longitude', 'latitude'],
                    use_pandas_metadata=False
                )
                df = table.to_pandas()
                
                mask = ((df['user_id1'] == id1) & (df['user_id2'] == id2)) | \
                       ((df['user_id1'] == id2) & (df['user_id2'] == id1))
                df_filtered = df[mask].sort_values('timestamp')
                
                result.extend([{
                    'timestamp': int(row.timestamp),
                    'lng': float(row.longitude),
                    'lat': float(row.latitude),
                    'contact_type': 'direct'
                } for row in df_filtered.itertuples()])
            except Exception as e:
                print(f"[WARN] 查询轨迹失败: {e}")
        
        # 查询 contacts2 中的轨迹
        if self.contacts2_path.exists():
            try:
                table = pq.read_table(
                    self.contacts2_path,
                    columns=['user_id1', 'user_id2', 'through_id', 'timestamp', 'longitude', 'latitude'],
                    use_pandas_metadata=False
                )
                df = table.to_pandas()
                
                mask = ((df['user_id1'] == id1) & (df['user_id2'] == id2)) | \
                       ((df['user_id1'] == id2) & (df['user_id2'] == id1))
                df_filtered = df[mask].sort_values('timestamp')
                
                result.extend([{
                    'timestamp': int(row.timestamp),
                    'lng': float(row.longitude),
                    'lat': float(row.latitude),
                    'contact_type': 'indirect',
                    'through': int(row.through_id)
                } for row in df_filtered.itertuples()])
            except Exception as e:
                print(f"[WARN] 查询次密接轨迹失败: {e}")
        
        if len(self._trajectory_cache) >= self._trajectory_cache_size:
            self._trajectory_cache.popitem(last=False)
        
        self._trajectory_cache[cache_key] = result
        return result

