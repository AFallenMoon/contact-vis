from flask import Flask, request, jsonify
from flask_cors import CORS
from flask_caching import Cache  
from flask_compress import Compress
import sqlite3
import os
import threading
from contextlib import contextmanager
import json

# 数据源配置：使用 Parquet
DATA_SOURCE = 'parquet'

app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": "*"}})

# 启用响应压缩（自动压缩 JSON 响应）
Compress(app)

# 缓存配置 - 使用优化的本地内存缓存
# 使用SimpleCache，但配置更智能的缓存策略
app.config['CACHE_TYPE'] = 'SimpleCache'
app.config['CACHE_DEFAULT_TIMEOUT'] = 3600  # 默认缓存超时时间（秒）- 1小时
app.config['CACHE_THRESHOLD'] = 1000  # 缓存条目数量阈值，超过后使用LRU淘汰
print("✓ Using optimized SimpleCache (in-memory cache with LRU eviction)")

cache = Cache(app)  # 初始化缓存

# 缓存辅助函数：生成更简洁的缓存键
def make_cache_key(prefix: str, *args) -> str:
    """生成缓存键，使用简洁的格式"""
    key_parts = [prefix] + [str(arg) for arg in args]
    return '::'.join(key_parts)

# 数据库配置 - 使用绝对路径，避免工作目录变化导致找不到数据库
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, 'mijie_10m.db')
PARQUET_PATH = os.path.join(BASE_DIR, 'trajectory_parquet')

# 初始化数据加载器
parquet_loader = None
if DATA_SOURCE == 'parquet':
    try:
        from parquet_loader import ParquetDataLoader
        parquet_loader = ParquetDataLoader(PARQUET_PATH)
        print(f"✓ Using Parquet data source: {PARQUET_PATH}")
    except ImportError:
        print("⚠ Parquet loader not available, falling back to SQLite")
        DATA_SOURCE = 'sqlite'
    except Exception as e:
        print(f"⚠ Parquet loader initialization failed: {e}, falling back to SQLite")
        DATA_SOURCE = 'sqlite'

if DATA_SOURCE == 'sqlite':
    print(f"✓ Using SQLite database: {DB_PATH}")

# SQLite 线程本地存储，每个线程一个连接
local = threading.local()

# 数据库连接函数 - 使用线程本地连接以提高性能
def get_db_connection():
    if not hasattr(local, 'conn') or local.conn is None:
        local.conn = sqlite3.connect(DB_PATH, check_same_thread=False)
        local.conn.row_factory = sqlite3.Row
        # 启用 WAL 模式以提高并发性能
        local.conn.execute('PRAGMA journal_mode=WAL')
        # 优化 SQLite 设置
        local.conn.execute('PRAGMA synchronous=NORMAL')
        local.conn.execute('PRAGMA cache_size=10000')
        local.conn.execute('PRAGMA temp_store=MEMORY')
    return local.conn

# 上下文管理器确保连接正确关闭
@contextmanager
def db_cursor():
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        yield cursor
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        cursor.close()


# ============================================================================
# SQLite 数据访问函数（带缓存）- 仅在SQLite路径使用Flask-Caching
# 对于Parquet路径，ParquetDataLoader内部已有缓存，避免双层缓存
# ============================================================================

@cache.cached(timeout=86400, key_prefix='timestamps')
def _get_timestamps_sqlite():
    """获取所有唯一的时间戳（SQLite路径，带缓存）"""
    conn = get_db_connection()
    cursor = conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('contacts', 'contacts2')")
    existing_tables = [row[0] for row in cursor.fetchall()]
    
    if not existing_tables:
        return []
    
    if len(existing_tables) == 2:
        cursor = conn.execute('''
            SELECT DISTINCT timestamp FROM (
                SELECT timestamp FROM contacts WHERE timestamp IS NOT NULL
                UNION
                SELECT timestamp FROM contacts2 WHERE timestamp IS NOT NULL
            )
            ORDER BY timestamp
        ''')
    elif 'contacts' in existing_tables:
        cursor = conn.execute('SELECT DISTINCT timestamp FROM contacts WHERE timestamp IS NOT NULL ORDER BY timestamp')
    elif 'contacts2' in existing_tables:
        cursor = conn.execute('SELECT DISTINCT timestamp FROM contacts2 WHERE timestamp IS NOT NULL ORDER BY timestamp')
    else:
        return []
    
    return [int(row['timestamp']) for row in cursor.fetchall()]


@cache.memoize(timeout=7200)
def _get_contacts_by_timestamp_sqlite(timestamp):
    """获取指定时间戳的所有密接对数据（SQLite路径，带缓存）"""
    conn = get_db_connection()
    cursor = conn.execute('''
        SELECT user_id1, user_id2, timestamp, longitude, latitude, 'direct' as contact_type, NULL as through_id
        FROM contacts 
        WHERE timestamp = ?
        UNION ALL
        SELECT user_id1, user_id2, timestamp, longitude, latitude, 'indirect' as contact_type, through_id
        FROM contacts2 
        WHERE timestamp = ?
    ''', (timestamp, timestamp))
    
    all_contacts = [{
        'id1': row['user_id1'],
        'id2': row['user_id2'],
        'timestamp': row['timestamp'],
        'lng': row['longitude'],
        'lat': row['latitude'],
        'contact_type': row['contact_type'],
        **({'through': row['through_id']} if row['through_id'] is not None else {})
    } for row in cursor]
    
    response = app.response_class(
        response=json.dumps(all_contacts, separators=(',', ':')),
        mimetype='application/json'
    )
    return response


@cache.cached(timeout=86400, key_prefix='bounds')
def _get_bounds_sqlite():
    """获取所有接触记录的经纬度边界（SQLite路径，带缓存）"""
    conn = get_db_connection()
    cursor = conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('contacts', 'contacts2')")
    existing_tables = [row[0] for row in cursor.fetchall()]
    
    if not existing_tables:
        return {
            'minLng': 116.0,
            'maxLng': 117.0,
            'minLat': 39.0,
            'maxLat': 40.0
        }
    
    if len(existing_tables) == 2:
        query = '''
            SELECT 
                MIN(longitude) as minLng,
                MAX(longitude) as maxLng,
                MIN(latitude) as minLat,
                MAX(latitude) as maxLat
            FROM (
                SELECT longitude, latitude FROM contacts 
                WHERE longitude IS NOT NULL AND latitude IS NOT NULL
                UNION ALL
                SELECT longitude, latitude FROM contacts2 
                WHERE longitude IS NOT NULL AND latitude IS NOT NULL
            )
        '''
    elif 'contacts' in existing_tables:
        query = '''
            SELECT 
                MIN(longitude) as minLng,
                MAX(longitude) as maxLng,
                MIN(latitude) as minLat,
                MAX(latitude) as maxLat
            FROM contacts
            WHERE longitude IS NOT NULL AND latitude IS NOT NULL
        '''
    elif 'contacts2' in existing_tables:
        query = '''
            SELECT 
                MIN(longitude) as minLng,
                MAX(longitude) as maxLng,
                MIN(latitude) as minLat,
                MAX(latitude) as maxLat
            FROM contacts2
            WHERE longitude IS NOT NULL AND latitude IS NOT NULL
        '''
    else:
        return {
            'minLng': 116.0,
            'maxLng': 117.0,
            'minLat': 39.0,
            'maxLat': 40.0
        }
    
    cursor = conn.execute(query)
    row = cursor.fetchone()
    
    if row and row['minLng'] is not None:
        return {
            'minLng': row['minLng'],
            'maxLng': row['maxLng'],
            'minLat': row['minLat'],
            'maxLat': row['maxLat']
        }
    else:
        return {
            'minLng': 116.0,
            'maxLng': 117.0,
            'minLat': 39.0,
            'maxLat': 40.0
        }


@cache.memoize(timeout=600)
def _get_user_direct_contacts_sqlite(user_id):
    """获取指定用户的直接密接（SQLite路径，带缓存）"""
    conn = get_db_connection()
    cursor = conn.execute(
        '''SELECT user_id1, user_id2, timestamp, longitude, latitude FROM contacts 
           WHERE user_id1 = ?
           UNION ALL
           SELECT user_id1, user_id2, timestamp, longitude, latitude FROM contacts 
           WHERE user_id2 = ? AND user_id1 != ?''',
        (user_id, user_id, user_id)
    )
    
    return [{
        'id1': row['user_id1'],
        'id2': row['user_id2'],
        'timestamp': row['timestamp'],
        'lng': row['longitude'],
        'lat': row['latitude'],
        'contact_type': 'direct'
    } for row in cursor]


@cache.memoize(timeout=600)
def _get_user_secondary_contacts_sqlite(user_id):
    """获取指定用户的次密接（SQLite路径，带缓存）"""
    conn = get_db_connection()
    
    # 先获取用户的直接接触者
    direct_cursor = conn.execute(
        '''SELECT user_id1, user_id2 FROM contacts 
           WHERE user_id1 = ?
           UNION ALL
           SELECT user_id1, user_id2 FROM contacts 
           WHERE user_id2 = ? AND user_id1 != ?''',
        (user_id, user_id, user_id)
    )
    
    direct_contacts = set()
    for row in direct_cursor:
        other_id = row['user_id1'] if row['user_id2'] == user_id else row['user_id2']
        direct_contacts.add(other_id)
    
    # 获取次密接
    secondary_cursor = conn.execute(
        '''SELECT user_id1, user_id2, through_id, timestamp, longitude, latitude FROM contacts2 
           WHERE user_id1 = ?
           UNION ALL
           SELECT user_id1, user_id2, through_id, timestamp, longitude, latitude FROM contacts2 
           WHERE user_id2 = ? AND user_id1 != ?''',
        (user_id, user_id, user_id)
    )
    
    contacts = []
    for row in secondary_cursor:
        other_id = row['user_id1'] if row['user_id2'] == user_id else row['user_id2']
        if other_id not in direct_contacts:
            contacts.append({
                'id1': row['user_id1'],
                'id2': row['user_id2'],
                'timestamp': row['timestamp'],
                'lng': row['longitude'],
                'lat': row['latitude'],
                'contact_type': 'indirect',
                'through': row['through_id']
            })
    
    return contacts


@cache.memoize(timeout=1800)
def _get_trajectory_sqlite(id1, id2):
    """获取两个用户之间的接触轨迹（SQLite路径，带缓存）"""
    conn = get_db_connection()
    
    # 直接接触轨迹
    direct_cursor = conn.execute(
        '''SELECT timestamp, longitude, latitude FROM contacts 
           WHERE user_id1 = ? AND user_id2 = ?
           UNION ALL
           SELECT timestamp, longitude, latitude FROM contacts 
           WHERE user_id1 = ? AND user_id2 = ?
           ORDER BY timestamp''',
        (id1, id2, id2, id1)
    )
    trajectory = [{
        'timestamp': row['timestamp'],
        'lng': row['longitude'],
        'lat': row['latitude'],
        'contact_type': 'direct'
    } for row in direct_cursor]
    
    # 次密接轨迹
    secondary_cursor = conn.execute(
        '''SELECT through_id, timestamp, longitude, latitude FROM contacts2 
           WHERE user_id1 = ? AND user_id2 = ?
           UNION ALL
           SELECT through_id, timestamp, longitude, latitude FROM contacts2 
           WHERE user_id1 = ? AND user_id2 = ?
           ORDER BY timestamp''',
        (id1, id2, id2, id1)
    )
    for row in secondary_cursor:
        trajectory.append({
            'timestamp': row['timestamp'],
            'lng': row['longitude'],
            'lat': row['latitude'],
            'contact_type': 'indirect',
            'through': row['through_id']
        })
    
    trajectory.sort(key=lambda x: x['timestamp'])
    return trajectory


# ============================================================================
# API 路由处理函数
# ============================================================================

@app.route('/api/timestamps', methods=['GET'])
def get_timestamps():
    """获取所有唯一的时间戳"""
    try:
        if DATA_SOURCE == 'parquet' and parquet_loader:
            # ParquetDataLoader内部已有缓存，无需Flask-Caching（避免双层缓存）
            timestamps = parquet_loader.get_all_timestamps()
            return jsonify(timestamps)
        else:
            # SQLite 路径使用Flask-Caching缓存
            timestamps = _get_timestamps_sqlite()
            return jsonify(timestamps)
    
    except sqlite3.Error as e:
        import traceback
        print(f"SQLite error in get_timestamps: {e}")
        traceback.print_exc()
        return jsonify({'error': f'数据库错误: {str(e)}'}), 500
    except Exception as e:
        import traceback
        print(f"Error in get_timestamps: {e}")
        traceback.print_exc()
        return jsonify({'error': f'服务器错误: {str(e)}'}), 500


@app.route('/api/contacts/<int:timestamp>', methods=['GET'])
def get_contacts_by_timestamp(timestamp):
    """获取指定时间戳的所有密接对数据"""
    try:
        if DATA_SOURCE == 'parquet' and parquet_loader:
            # ParquetDataLoader内部已有缓存，无需Flask-Caching（避免双层缓存）
            all_contacts = parquet_loader.get_contacts_by_timestamp(timestamp)
            response = app.response_class(
                response=json.dumps(all_contacts, separators=(',', ':')),
                mimetype='application/json'
            )
            return response
        else:
            # SQLite 路径使用Flask-Caching缓存
            return _get_contacts_by_timestamp_sqlite(timestamp)
    
    except sqlite3.Error as e:
        return jsonify({'error': f'数据库错误: {str(e)}'}), 500
    except Exception as e:
        return jsonify({'error': f'服务器错误: {str(e)}'}), 500


@app.route('/api/bounds', methods=['GET'])
def get_bounds():
    """获取所有接触记录的经纬度边界"""
    try:
        if DATA_SOURCE == 'parquet' and parquet_loader:
            # ParquetDataLoader内部已有缓存，无需Flask-Caching（避免双层缓存）
            bounds = parquet_loader.get_bounds()
            return jsonify(bounds)
        else:
            # SQLite 路径使用Flask-Caching缓存
            bounds = _get_bounds_sqlite()
            return jsonify(bounds)
    
    except sqlite3.Error as e:
        return jsonify({'error': f'数据库错误: {str(e)}'}), 500
    except Exception as e:
        return jsonify({'error': f'服务器错误: {str(e)}'}), 500


@app.route('/api/user/<int:user_id>/contacts', methods=['GET'])
def get_user_direct_contacts(user_id):
    """获取指定用户的直接密接"""
    try:
        if DATA_SOURCE == 'parquet' and parquet_loader:
            # ParquetDataLoader内部已有缓存，无需Flask-Caching（避免双层缓存）
            contacts = parquet_loader.get_user_contacts(user_id)
            return jsonify(contacts)
        else:
            # SQLite 路径使用Flask-Caching缓存
            contacts = _get_user_direct_contacts_sqlite(user_id)
            return jsonify(contacts)
    
    except sqlite3.Error as e:
        return jsonify({'error': f'数据库错误: {str(e)}'}), 500
    except Exception as e:
        return jsonify({'error': f'服务器错误: {str(e)}'}), 500


@app.route('/api/user/<int:user_id>/secondary-contacts', methods=['GET'])
def get_user_secondary_contacts(user_id):
    """获取指定用户的次密接"""
    try:
        if DATA_SOURCE == 'parquet' and parquet_loader:
            # ParquetDataLoader内部已有缓存，无需Flask-Caching（避免双层缓存）
            contacts = parquet_loader.get_user_secondary_contacts(user_id)
            return jsonify(contacts)
        else:
            # SQLite 路径使用Flask-Caching缓存
            contacts = _get_user_secondary_contacts_sqlite(user_id)
            return jsonify(contacts)
    
    except sqlite3.Error as e:
        return jsonify({'error': f'数据库错误: {str(e)}'}), 500
    except Exception as e:
        return jsonify({'error': f'服务器错误: {str(e)}'}), 500


@app.route('/api/trajectory/<int:id1>/<int:id2>', methods=['GET'])
def get_trajectory(id1, id2):
    """获取两个用户之间的接触轨迹"""
    try:
        if DATA_SOURCE == 'parquet' and parquet_loader:
            # ParquetDataLoader内部已有缓存，无需Flask-Caching（避免双层缓存）
            trajectory = parquet_loader.get_trajectory(id1, id2)
            return jsonify(trajectory)
        else:
            # SQLite 路径使用Flask-Caching缓存
            trajectory = _get_trajectory_sqlite(id1, id2)
            return jsonify(trajectory)
    
    except sqlite3.Error as e:
        return jsonify({'error': f'数据库错误: {str(e)}'}), 500
    except Exception as e:
        return jsonify({'error': f'服务器错误: {str(e)}'}), 500


# 提供静态文件服务（前端页面）
@app.route('/')
def index():
    """返回前端页面"""
    import os
    index_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'index.html')
    if os.path.exists(index_path):
        with open(index_path, 'r', encoding='utf-8') as f:
            return f.read()
    return jsonify({'error': 'Frontend file not found'}), 404

# 提供静态资源服务（CSS, JS）
@app.route('/<path:filename>')
def static_files(filename):
    """提供静态文件（CSS, JS）"""
    import os
    base_dir = os.path.dirname(os.path.dirname(__file__))
    
    # 允许的文件类型和目录
    allowed_dirs = ['css', 'js']
    allowed_extensions = ['.css', '.js']
    
    # 检查是否在允许的目录中
    parts = filename.split('/')
    if len(parts) > 0 and parts[0] in allowed_dirs:
        file_path = os.path.join(base_dir, filename)
        if os.path.exists(file_path) and any(file_path.endswith(ext) for ext in allowed_extensions):
            with open(file_path, 'r', encoding='utf-8') as f:
                content = f.read()
                mimetype = 'text/css' if filename.endswith('.css') else 'application/javascript'
                return app.response_class(content, mimetype=mimetype)
    
    return jsonify({'error': 'File not found'}), 404


if __name__ == '__main__':
    # 根据环境变量决定是否启用debug模式
    debug_mode = os.getenv('FLASK_ENV', 'development') == 'development'
    # 支持从环境变量读取端口（云平台通常通过 PORT 环境变量指定）
    port = int(os.getenv('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=debug_mode)
    