# ============================================================
#  routes.py — Flask 路由接口
# ============================================================
from flask import Blueprint, request, jsonify
from .dataService import create_order, verify_payment, get_order, get_user_purchases

api = Blueprint("api", __name__, url_prefix="/api")

# 假用户 ID (实际项目中应使用登录态)
DEFAULT_USER_ID = "wechat_user_001"


@api.route("/order/create", methods=["POST"])
def create_order_route():
    """创建订单接口"""
    data = request.get_json(force=True)
    product_id = data.get("product_id", "shield_x3")
    amount = data.get("amount", 1.00)

    order = create_order(DEFAULT_USER_ID, product_id, amount)
    return jsonify({
        "success": True,
        "order_id": order["order_id"],
        "amount": order["amount"],
        "status": order["status"]
    })


@api.route("/order/verify", methods=["POST"])
def verify_order_route():
    """验证支付结果接口"""
    data = request.get_json(force=True)
    order_id = data.get("order_id")
    if not order_id:
        return jsonify({"success": False, "message": "缺少 order_id"}), 400

    result = verify_payment(order_id)
    return jsonify(result)


@api.route("/order/status", methods=["GET"])
def get_order_status_route():
    """查询订单状态接口"""
    order_id = request.args.get("order_id")
    if not order_id:
        return jsonify({"success": False, "message": "缺少 order_id"}), 400

    order = get_order(order_id)
    if not order:
        return jsonify({"success": False, "message": "订单不存在"}), 404

    return jsonify({
        "success": True,
        "order_id": order["order_id"],
        "status": order["status"],
        "amount": order["amount"]
    })


@api.route("/purchases", methods=["GET"])
def get_user_purchases_route():
    """查询用户购买记录"""
    records = get_user_purchases(DEFAULT_USER_ID)
    return jsonify({
        "success": True,
        "purchases": records
    })


@api.route("/health", methods=["GET"])
def health_check():
    """健康检查"""
    return jsonify({"status": "ok", "message": "WechatJumpClone Backend is running"})
