from flask import Flask, jsonify, request
from flask_cors import CORS
from flask_compress import Compress
import os

app = Flask(__name__)

# 优化：生产环境配置（最小实例=1，实例常驻）
app.config['JSONIFY_PRETTYPRINT_REGULAR'] = False  # 禁用美化输出，减少响应大小
app.config['JSON_SORT_KEYS'] = False  # 禁用键排序，提升性能
app.config['JSON_COMPACT'] = True  # 使用紧凑JSON格式

# CORS配置：允许所有来源（前后端分离架构）
CORS(app, resources={r"/api/*": {"origins": "*"}}, supports_credentials=True)

# 启用响应压缩（自动压缩 JSON 响应）
Compress(app)

# Parquet 数据路径配置
# 数据已挂载到 /mnt/oss（包含 contacts 和 contacts2 目录）
PARQUET_PATH = '/mnt/oss'

# 初始化数据加载器（优化：最小实例=1时，实例常驻，启动时预加载热点数据）
parquet_loader = None
try:
    from parquet_loader import ParquetDataLoader
    import os
    from pathlib import Path
    
    # 优化：最小实例=1时，实例常驻，预加载可以提升首次请求速度
    parquet_loader = ParquetDataLoader(PARQUET_PATH, preload_hot_data=True)
    print(f"[INIT] Parquet data source: {PARQUET_PATH}")
except ImportError as e:
    print(f"✗ Parquet loader import failed: {e}")
    import traceback
    traceback.print_exc()
    raise
except Exception as e:
    print(f"✗ Parquet loader initialization failed: {e}")
    import traceback
    traceback.print_exc()
    raise


# ============================================================================
# 请求日志中间件（生产环境：仅记录关键信息）
# ============================================================================

@app.before_request
def log_request_info():
    """记录请求信息（生产环境：简化日志）"""
    # 跳过健康检查的日志（减少日志噪音）
    if request.path in ['/health', '/api/health']:
        return
    print(f"[{request.method}] {request.path}")

# ============================================================================
# 统一错误处理（优化：减少重复代码）
# ============================================================================

@app.errorhandler(404)
def not_found(error):
    """处理404错误"""
    print(f"[404] {request.path}")
    return jsonify({'error': '接口不存在'}), 404

@app.errorhandler(500)
def internal_error(error):
    """处理500错误"""
    print(f"[500] {request.path}")
    return jsonify({'error': '服务器内部错误'}), 500

@app.errorhandler(400)
def bad_request(error):
    """处理400错误"""
    print(f"[400] {request.path}")
    return jsonify({'error': '请求格式错误'}), 400

# ============================================================================
# 健康检查端点（用于监控，FC实例保活由最小实例数配置控制）
# ============================================================================

@app.route('/health', methods=['GET'])
@app.route('/api/health', methods=['GET'])
def health_check():
    """健康检查端点（用于监控，FC实例保活由最小实例数配置控制）"""
    return jsonify({
        'status': 'healthy',
        'service': 'trajectory-visualization-api'
    }), 200

# ============================================================================
# API 路由处理函数
# ============================================================================

@app.route('/api/timestamps', methods=['GET', 'OPTIONS'])
def get_timestamps():
    """获取所有唯一的时间戳"""
    if request.method == 'OPTIONS':
        return '', 200
    try:
        timestamps = parquet_loader.get_all_timestamps()
        return jsonify(timestamps)
    except Exception as e:
        return _handle_error('get_timestamps', e)


@app.route('/api/contacts/<int:timestamp>', methods=['GET'])
def get_contacts_by_timestamp(timestamp):
    """获取指定时间戳的所有密接对数据"""
    try:
        all_contacts = parquet_loader.get_contacts_by_timestamp(timestamp)
        # 优化：使用紧凑JSON格式（已在app.config中配置）
        return jsonify(all_contacts)
    except Exception as e:
        return _handle_error('get_contacts_by_timestamp', e)


@app.route('/api/bounds', methods=['GET', 'OPTIONS'])
def get_bounds():
    """获取所有接触记录的经纬度边界"""
    if request.method == 'OPTIONS':
        return '', 200
    try:
        bounds = parquet_loader.get_bounds()
        return jsonify(bounds)
    except Exception as e:
        return _handle_error('get_bounds', e)


@app.route('/api/user/<int:user_id>/contacts', methods=['GET'])
def get_user_direct_contacts(user_id):
    """获取指定用户的直接密接"""
    try:
        contacts = parquet_loader.get_user_contacts(user_id)
        return jsonify(contacts)
    except Exception as e:
        return _handle_error('get_user_direct_contacts', e)


@app.route('/api/user/<int:user_id>/secondary-contacts', methods=['GET'])
def get_user_secondary_contacts(user_id):
    """获取指定用户的次密接"""
    try:
        contacts = parquet_loader.get_user_secondary_contacts(user_id)
        return jsonify(contacts)
    except Exception as e:
        return _handle_error('get_user_secondary_contacts', e)


@app.route('/api/trajectory/<int:id1>/<int:id2>', methods=['GET'])
def get_trajectory(id1, id2):
    """获取两个用户之间的接触轨迹"""
    try:
        trajectory = parquet_loader.get_trajectory(id1, id2)
        return jsonify(trajectory)
    except Exception as e:
        return _handle_error('get_trajectory', e)


# ============================================================================
# 辅助函数
# ============================================================================

def _handle_error(function_name: str, error: Exception):
    """统一错误处理函数（生产环境：简化日志）"""
    error_msg = str(error)
    error_type = type(error).__name__
    print(f"[ERROR] {function_name}: {error_type} - {error_msg}")
    # 生产环境不输出详细堆栈（减少日志量）
    # 如需调试，可在函数计算控制台查看详细错误信息
    return jsonify({
        'error': f'服务器错误: {error_msg}'
    }), 500


# ============================================================================
# 启动 Flask 应用（函数计算 Web 函数）
# ============================================================================

if __name__ == '__main__':
    # 函数计算 Web 函数要求监听 9000 端口
    port = int(os.getenv('FC_SERVER_PORT', os.getenv('PORT', 9000)))
    app.run(host='0.0.0.0', port=port, debug=False)

