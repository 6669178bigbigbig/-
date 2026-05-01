# ============================================================
#  dataService.py — 模拟数据库 (内存存储)
# ============================================================
import time
import uuid

# 内存中的"数据库"
orders = {}          # order_id -> order_data
purchases = []       # 历史购买记录

def create_order(user_id: str, product_id: str, amount: float) -> dict:
    """创建一个新订单"""
    order_id = str(uuid.uuid4())[:8]
    order = {
        "order_id": order_id,
        "user_id": user_id,
        "product_id": product_id,
        "amount": amount,
        "status": "pending",       # pending / paid / cancelled
        "created_at": time.time(),
        "paid_at": None
    }
    orders[order_id] = order
    return order


def verify_payment(order_id: str) -> dict:
    """模拟支付回调验证 —— 直接标记为已支付"""
    order = orders.get(order_id)
    if not order:
        return {"success": False, "message": "订单不存在"}
    if order["status"] == "paid":
        return {"success": False, "message": "订单已支付，请勿重复操作"}

    # 模拟支付网关验证延迟 (实际项目中这里会调微信/支付宝 API)
    # 我们直接置为已支付
    order["status"] = "paid"
    order["paid_at"] = time.time()

    # 记录到购买历史
    purchases.append({
        "order_id": order_id,
        "user_id": order["user_id"],
        "product_id": order["product_id"],
        "paid_at": order["paid_at"]
    })

    return {"success": True, "message": "支付成功", "order": order}


def get_order(order_id: str) -> dict:
    """查询订单状态"""
    return orders.get(order_id)


def get_user_purchases(user_id: str) -> list:
    """查询用户购买记录"""
    return [p for p in purchases if p["user_id"] == user_id]
