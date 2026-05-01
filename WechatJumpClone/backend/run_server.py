# ============================================================
#  run_server.py — 后端启动脚本
# 执行: python run_server.py
# ============================================================
import sys
import os

# 将项目根目录加入 sys.path，使得 Flask 能找到 app 包
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app import create_app

app = create_app()

if __name__ == "__main__":
    print("=" * 50)
    print("  微信跳一跳 · 商业化后端服务")
    print("  地址: http://localhost:5000")
    print("  健康检查: http://localhost:5000/api/health")
    print("=" * 50)
    app.run(host="0.0.0.0", port=5000, debug=True)
