# ============================================================
#  __init__.py — Flask 应用初始化
# ============================================================
from flask import Flask
from flask_cors import CORS


def create_app():
    app = Flask(__name__)

    # 允许所有来源跨域 (开发环境用)
    CORS(app, resources={r"/api/*": {"origins": "*"}})

    # 注册蓝图
    from .routes import api
    app.register_blueprint(api)

    return app
