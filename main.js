// =====================================================================
//  WechatJumpClone — main.js (全功能修复版 v3)
//  修复项:
//  1. 移除重复顶部栏、多余 0 显示
//  2. 大幅优化性能 (简化材质、关闭多余特效)
//  3. 相机始终跟随玩家，不卡在中央
//  4. 护盾判定修正: 安全落地不消耗, 边缘或落空才消耗
//  5. 跳跃方向更丰富 (8 个方向 + 随机偏移)
//  6. 简单模式完整抛物线预览
//  7. 连续精准命中连击加分补偿
//  8. 所有 UI 按钮可正常点击
// =====================================================================
(function () {
    "use strict";

    // ========== 配置 ==========
    const CONFIG = {
        gravity: -42,
        jumpVelocityY: 10.0,
        jumpVelocityH: 6.2,
        maxChargeTime: 1.0,
        safeRadius: 0.15,      // 安全落地范围 (<= block halfW + this)
        edgeRadius: 0.35,      // 边缘落地范围 (<= block halfW + this)
        bullseyeRadius: 0.20,  // 精准命中 (中心点附近)

        blockMinSize: 1.0,
        blockMaxSize: 1.8,
        blockMinDist: 2.2,
        blockMaxDist: 5.5,
        blockHeight: 0.7,
        playerRadius: 0.25,

        frustumSize: 10,
        camOffset: new THREE.Vector3(8, 10, 8),
        cameraLerp: 4.0,

        colors: {
            bg: 0xdde2e6,
            player: 0x2c3e50,
            blocks: [0x34495e, 0x7f8c8d, 0xd35400, 0x27ae60, 0x8e44ad, 0x2980b9, 0xc0392b],
            shield: 0xf1c40f
        }
    };

    const STATE = {
        INIT: 0, READY: 1, CHARGING: 2, JUMPING: 3, LANDED: 4, FALLING: 5, GAMEOVER: 6, SHOP: 7
    };

    // 8 个基础方向 (二维向量, z-up 平面)
    const DIRECTIONS = [
        new THREE.Vector3(0.707, 0, 0.707),   // 右上
        new THREE.Vector3(0.000, 0, 1.000),   // 正上
        new THREE.Vector3(-0.707, 0, 0.707),  // 左上
        new THREE.Vector3(-1.000, 0, 0.000),  // 左
        new THREE.Vector3(-0.707, 0, -0.707), // 左下
        new THREE.Vector3(0.000, 0, -1.000),  // 正下
        new THREE.Vector3(0.707, 0, -0.707),  // 右下
        new THREE.Vector3(1.000, 0, 0.000)    // 右
    ].map(v => v.clone().normalize());

    // ========== DOM ==========
    const $ = id => document.getElementById(id);

    const UI = {
        scoreValue: $("score-value"),
        finalScore: $("final-score"),
        maxComboDisplay: $("max-combo-display"),
        chargeFill: $("charge-fill"),
        gameOverOverlay: $("game-over-overlay"),
        shopOverlay: $("shop-overlay"),
        retryBtn: $("retry-btn"),
        shopBtn: $("shop-btn"),
        closeShopBtn: $("close-shop-btn"),
        confirmPayBtn: $("confirm-pay-btn"),
        shieldStatus: $("shield-status"),
        shieldValue: $("shield-value"),
        modeToggle: $("mode-toggle"),
        modeText: $("mode-text"),
        trajectoryHint: $("trajectory-hint"),
        topBar: $("top-bar"),
        floatingContainer: (() => {
            const d = document.createElement("div");
            d.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:50;overflow:hidden;";
            document.body.appendChild(d);
            return d;
        })()
    };

    // ========== Three.js 场景 (轻量化) ==========
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(CONFIG.colors.bg);
    scene.fog = new THREE.Fog(CONFIG.colors.bg, 18, 45);

    const renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: false,
        powerPreference: "high-performance"
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.body.appendChild(renderer.domElement);

    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
    function updateCameraSize() {
        const a = window.innerWidth / window.innerHeight;
        camera.left = -CONFIG.frustumSize * a;
        camera.right = CONFIG.frustumSize * a;
        camera.top = CONFIG.frustumSize;
        camera.bottom = -CONFIG.frustumSize;
        camera.updateProjectionMatrix();
    }
    updateCameraSize();

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);

    const mainLight = new THREE.DirectionalLight(0xffffff, 0.8);
    mainLight.position.set(6, 14, 8);
    mainLight.castShadow = true;
    mainLight.shadow.mapSize.width = 512;
    mainLight.shadow.mapSize.height = 512;
    mainLight.shadow.camera.left = -12;
    mainLight.shadow.camera.right = 12;
    mainLight.shadow.camera.top = 12;
    mainLight.shadow.camera.bottom = -12;
    mainLight.shadow.bias = -0.001;
    scene.add(mainLight);

    const fillLight = new THREE.DirectionalLight(0xaabbcc, 0.25);
    fillLight.position.set(-6, 6, -6);
    scene.add(fillLight);

    // ========== 抛物线轨迹 (简单模式) ==========
    const MAX_TRAJ = 50;
    const trajPos = new Float32Array(MAX_TRAJ * 3);
    const trajGeo = new THREE.BufferGeometry();
    trajGeo.setAttribute("position", new THREE.BufferAttribute(trajPos, 3));
    const trajMat = new THREE.PointsMaterial({
        color: 0xf39c12,
        size: 0.2,
        transparent: true,
        opacity: 0.9,
        sizeAttenuation: true
    });
    const trajectoryPoints = new THREE.Points(trajGeo, trajMat);
    trajectoryPoints.visible = false;
    scene.add(trajectoryPoints);

    // ========== 内存清理 ==========
    function disposeObj(obj) {
        if (!obj) return;
        obj.traverse(c => {
            if (c.isMesh) {
                if (c.geometry) c.geometry.dispose();
                if (c.material) {
                    if (Array.isArray(c.material)) c.material.forEach(m => m.dispose());
                    else c.material.dispose();
                }
            }
        });
        scene.remove(obj);
    }

    // ========== 实体 ==========
    let blocks = [];
    let player = null;
    let shieldMesh = null;

    function createPlayer() {
        const g = new THREE.Group();
        const mat = new THREE.MeshStandardMaterial({
            color: CONFIG.colors.player,
            roughness: 0.4,
            metalness: 0.1
        });

        const base = new THREE.Mesh(
            new THREE.CylinderGeometry(CONFIG.playerRadius, CONFIG.playerRadius * 1.1, 0.15, 24), mat
        );
        base.position.y = 0.075;
        base.castShadow = true;
        g.add(base);

        const body = new THREE.Mesh(
            new THREE.CylinderGeometry(CONFIG.playerRadius * 0.7, CONFIG.playerRadius, 0.45, 24), mat
        );
        body.position.y = 0.075 + 0.225;
        body.castShadow = true;
        g.add(body);

        const head = new THREE.Mesh(
            new THREE.SphereGeometry(0.2, 24, 24), mat
        );
        head.position.y = 0.075 + 0.45 + 0.1;
        head.castShadow = true;
        g.add(head);

        // 护盾
        const shieldMat = new THREE.MeshStandardMaterial({
            color: CONFIG.colors.shield,
            emissive: CONFIG.colors.shield,
            emissiveIntensity: 0.4,
            transparent: true,
            opacity: 0.25,
            roughness: 0.0,
            metalness: 0.3
        });
        shieldMesh = new THREE.Mesh(new THREE.SphereGeometry(0.55, 24, 24), shieldMat);
        shieldMesh.position.y = 0.4;
        shieldMesh.visible = false;
        g.add(shieldMesh);

        return g;
    }

    function generateBlock(pos, isFirst) {
        const color = isFirst
            ? 0x95a5a6
            : CONFIG.colors.blocks[Math.floor(Math.random() * CONFIG.colors.blocks.length)];
        const size = isFirst ? 1.6 : CONFIG.blockMinSize + Math.random() * (CONFIG.blockMaxSize - CONFIG.blockMinSize);
        const isCyl = !isFirst && Math.random() > 0.6;
        const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.05 });

        const body = isCyl
            ? new THREE.Mesh(new THREE.CylinderGeometry(size / 2, size / 2, CONFIG.blockHeight, 32), mat)
            : new THREE.Mesh(new THREE.BoxGeometry(size, CONFIG.blockHeight, size), mat);
        body.position.y = CONFIG.blockHeight / 2;
        body.castShadow = true;
        body.receiveShadow = true;

        const group = new THREE.Group();
        group.add(body);

        if (!isFirst) {
            const dot = new THREE.Mesh(
                new THREE.CircleGeometry(0.1, 24),
                new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 })
            );
            dot.rotation.x = -Math.PI / 2;
            dot.position.y = CONFIG.blockHeight + 0.002;
            group.add(dot);
        }

        group.userData = { isCyl, halfW: size / 2 };
        group.position.copy(pos);
        scene.add(group);
        blocks.push(group);
        return group;
    }

    // ========== 游戏状态 ==========
    const GameState = {
        state: STATE.INIT,
        previousState: STATE.INIT,
        mode: "HARD",
        score: 0,
        shields: 0,
        combo: 0,
        maxCombo: 0,
        chargeStartTime: 0,
        jumpData: null,
        fallData: null,
        cameraTarget: new THREE.Vector3().copy(CONFIG.camOffset),
        cameraLookTarget: new THREE.Vector3(0, 0, 0)
    };

    function updateShieldUI() {
        if (!UI.shieldValue || !UI.shieldStatus) return;
        UI.shieldValue.textContent = GameState.shields;
        if (GameState.shields > 0) {
            UI.shieldStatus.style.display = "flex";
            UI.shieldStatus.classList.add("active");
            if (shieldMesh) shieldMesh.visible = true;
        } else {
            UI.shieldStatus.style.display = "none";
            UI.shieldStatus.classList.remove("active");
            if (shieldMesh) shieldMesh.visible = false;
        }
    }

    function showFloatText(text, pos3D, isGold) {
        const div = document.createElement("div");
        div.textContent = text;
        div.style.cssText =
            "position:absolute;font-weight:800;pointer-events:none;" +
            "transition:all 0.8s cubic-bezier(0.175,0.885,0.32,1.275);" +
            "opacity:1;transform:translate(-50%,-50%) scale(0.5);z-index:100;" +
            (isGold
                ? "color:#e67e22;font-size:28px;text-shadow:0 2px 12px rgba(230,126,34,0.3);"
                : "color:#2c3e50;font-size:22px;text-shadow:0 2px 8px rgba(0,0,0,0.08);");

        const v = pos3D.clone().project(camera);
        const x = (v.x * 0.5 + 0.5) * window.innerWidth;
        const y = (-(v.y * 0.5) + 0.5) * window.innerHeight;
        div.style.left = x + "px";
        div.style.top = (y - 20) + "px";

        UI.floatingContainer.appendChild(div);
        requestAnimationFrame(() => {
            div.style.top = (y - 80) + "px";
            div.style.transform = "translate(-50%,-50%) scale(1.1)";
            div.style.opacity = "0";
        });
        setTimeout(() => div.remove(), 800);
    }

    // ========== 物理辅助 ==========
    function findPlayerBlockIdx() {
        for (let i = 0; i < blocks.length; i++) {
            const b = blocks[i];
            const dx = Math.abs(player.position.x - b.position.x);
            const dz = Math.abs(player.position.z - b.position.z);
            const dist = b.userData.isCyl ? Math.hypot(dx, dz) : Math.max(dx, dz);
            if (dist <= b.userData.halfW + 0.15) return i;
        }
        return -1;
    }

    // 只沿 X 轴（右上）或 Z 轴（左上）两个方向跳跃
    function getJumpDir() {
        const idx = findPlayerBlockIdx();
        const next = blocks[idx + 1];
        if (!next) return { dir: new THREE.Vector3(1, 0, 0), currentIdx: idx };

        // 修复：使用当前方块中心而非玩家位置计算方向，避免累积偏差干扰轴向判断
        let dx, dz;
        if (idx >= 0) {
            const currentBlock = blocks[idx];
            dx = next.position.x - currentBlock.position.x;
            dz = next.position.z - currentBlock.position.z;
        } else {
            dx = next.position.x - player.position.x;
            dz = next.position.z - player.position.z;
        }

        // 谁的位移大就往哪个轴向跳
        const dir = Math.abs(dx) > Math.abs(dz) 
            ? new THREE.Vector3(1, 0, 0)  // X 轴
            : new THREE.Vector3(0, 0, 1); // Z 轴
        
        return { dir, currentIdx: idx };
    }

    // 更新抛物线轨迹（简单模式）—— 增强版：更密集、更亮、显示落点
    function updateTrajectory(power) {
        const { dir } = getJumpDir();
        const hSpeed = CONFIG.jumpVelocityH * (0.4 + power * 1.2);
        const vSpeed = CONFIG.jumpVelocityY * (0.6 + power * 0.8);
        const start = player.position.clone().add(new THREE.Vector3(0, 0.5, 0));
        const g = CONFIG.gravity;

        if (!window.trajMeshes) return;
        
        // 第一步：所有球先隐藏（旧轨迹消失）
        window.trajMeshes.forEach(m => m.visible = false);
        
        // 第二步：沿当前方向依次显示
        const step = 0.04; // 更小的步长 → 更密集
        let lastY = -1;
        let lastIdx = -1;
        
        window.trajMeshes.forEach((mesh, i) => {
            const t = (i + 1) * step;
            const x = start.x + dir.x * hSpeed * t;
            const z = start.z + dir.z * hSpeed * t;
            const y = start.y + vSpeed * t + 0.5 * g * t * t;
            
            if (y > 0.15) {
                mesh.position.set(x, y, z);
                mesh.visible = true;
                lastY = y;
                lastIdx = i;
                
                // 最后几个球变大变亮，突出落点
                if (i > 20) {
                    mesh.scale.set(1.5, 1.5, 1.5);
                    mesh.material.color.setHex(0xff6600);
                } else {
                    mesh.scale.set(1, 1, 1);
                    mesh.material.color.setHex(0xf1c40f);
                }
            } else {
                mesh.visible = false;
            }
        });
        
        // 落点标记：最后一个可见球闪烁效果
        if (lastIdx >= 0) {
            const lastMesh = window.trajMeshes[lastIdx];
            lastMesh.scale.set(2, 2, 2);
            lastMesh.material.color.setHex(0xff2200);
        }
    }
    // ========== 核心逻辑 ==========
    function processLanded(block, idx, jd) {
        GameState.state = STATE.LANDED;
        player.scale.set(1.15, 0.75, 1.15);
        setTimeout(() => {
            if (GameState.state === STATE.LANDED || GameState.state === STATE.READY) {
                player.scale.set(1, 1, 1);
            }
        }, 150);

        if (idx > jd.startBlockIdx) {
            // ========== 核心修复：轴向回正（Snapping） ==========
            // 保留跳跃轴上的实际落点偏移，回正非跳跃轴到方块中心
            if (jd.jumpAxis === 'x') {
                // 沿 X 轴跳跃：保留 X 偏移，Z 轴回正到方块中心
                player.position.z = block.position.z;
            } else {
                // 沿 Z 轴跳跃：保留 Z 偏移，X 轴回正到方块中心
                player.position.x = block.position.x;
            }

            const dx = player.position.x - block.position.x;
            const dz = player.position.z - block.position.z;
            const dist = Math.hypot(dx, dz);
            const isPrecise = dist < CONFIG.bullseyeRadius;

            if (isPrecise) {
                GameState.combo++;
                if (GameState.combo > GameState.maxCombo) GameState.maxCombo = GameState.combo;
                const bonus = GameState.combo;
                GameState.score += bonus;
                // 拉到正中心
                player.position.x = block.position.x;
                player.position.z = block.position.z;
                showFloatText("+" + bonus + "🔥", player.position.clone().add(new THREE.Vector3(0, 1, 0)), true);
            } else {
                GameState.combo = 0;
                GameState.score += 1;
                showFloatText("+1", player.position.clone().add(new THREE.Vector3(0, 1, 0)), false);
            }

            UI.scoreValue.textContent = GameState.score;

            // --- 找到 generateBlock 前的代码进行替换 ---
            const last = blocks[blocks.length - 1].position;
            const dist2 = CONFIG.blockMinDist + Math.random() * (CONFIG.blockMaxDist - CONFIG.blockMinDist);

            // 核心修复：只允许沿 X 轴或 Z 轴增加
            const isXAxis = Math.random() > 0.5;
            const nx = isXAxis ? last.x + dist2 : last.x;
            const nz = isXAxis ? last.z : last.z + dist2;
            const newBlock = generateBlock(new THREE.Vector3(nx, 0, nz));
            // 相机跟随
            const mid = new THREE.Vector3().copy(block.position).add(newBlock.position).multiplyScalar(0.5);
            GameState.cameraLookTarget.set(mid.x, 0, mid.z);
            GameState.cameraTarget.set(mid.x + CONFIG.camOffset.x, CONFIG.camOffset.y, mid.z + CONFIG.camOffset.z);

            // 清理远处方块
            while (blocks.length > 6) {
                const old = blocks.shift();
                disposeObj(old);
            }
        }
        setTimeout(() => {
            if (GameState.state === STATE.LANDED) GameState.state = STATE.READY;
        }, 100);
    }

    function triggerFall(fd) {
        GameState.state = STATE.FALLING;
        GameState.fallData = fd;
    }

    function triggerGameOver() {
        GameState.state = STATE.GAMEOVER;
        UI.finalScore.textContent = GameState.score;
        UI.maxComboDisplay.textContent = GameState.maxCombo;
        UI.gameOverOverlay.classList.remove("hidden");
    }

    function updateJump(delta) {
        const jd = GameState.jumpData;
        jd.elapsed += delta;
        const prevY = player.position.y;
        jd.velocity.y += CONFIG.gravity * delta;
        player.position.addScaledVector(jd.velocity, delta);

        // 旋转
        if (jd.elapsed < 0.6) {
            player.quaternion.setFromAxisAngle(jd.rotAxis, jd.rotSpeed * jd.elapsed);
        } else {
            player.quaternion.identity();
        }

        if (jd.velocity.y >= 0) return;

        // 降落检测
        let hitInfo = null;
        for (let i = 0; i < blocks.length; i++) {
            const b = blocks[i];
            const bTop = b.position.y + CONFIG.blockHeight;
            if (prevY >= bTop && player.position.y <= bTop) {
                const dx = Math.abs(player.position.x - b.position.x);
                const dz = Math.abs(player.position.z - b.position.z);
                const dist = b.userData.isCyl ? Math.hypot(dx, dz) : Math.max(dx, dz);
                const limit = b.userData.halfW;

                if (dist <= limit + CONFIG.safeRadius) {
                    // 安全着陆
                    hitInfo = { idx: i, type: "safe" };
                    break;
                } else if (dist <= limit + CONFIG.edgeRadius) {
                    // 边缘着陆 (半危险)
                    hitInfo = { idx: i, type: "edge" };
                    break;
                }
                // 超出范围 = 没碰到
            }
        }

        if (hitInfo) {
            const block = blocks[hitInfo.idx];
            player.position.y = block.position.y + CONFIG.blockHeight;
            player.quaternion.identity();

            if (hitInfo.type === "edge") {
                // 边缘着陆: 如果有护盾则消耗护盾并拉回中心
                if (GameState.shields > 0) {
                    GameState.shields--;
                    updateShieldUI();
                    player.position.x = block.position.x;
                    player.position.z = block.position.z;
                    showFloatText("🛡 护盾消耗", player.position.clone().add(new THREE.Vector3(0, 1, 0)), true);
                    processLanded(block, hitInfo.idx, jd);
                } else {
                    // 无护盾 -> 滑落
                    const pDir = player.position.clone().sub(block.position).setY(0).normalize();
                    triggerFall({
                        pos: player.position.clone(),
                        vel: new THREE.Vector3(pDir.x * 2, 0, pDir.z * 2),
                        rotAxis: new THREE.Vector3(-pDir.z, 0, pDir.x),
                        rotSpeed: 5
                    });
                }
            } else {
                // 安全着陆
                processLanded(block, hitInfo.idx, jd);
            }
        } else if (player.position.y <= -0.5) {
            // 完全没碰到任何平台
            if (GameState.shields > 0) {
                // 消耗护盾，回溯到目标平台
                GameState.shields--;
                updateShieldUI();
                const tIdx = jd.targetBlockIdx < blocks.length ? jd.targetBlockIdx : blocks.length - 1;
                if (tIdx >= 0 && tIdx < blocks.length) {
                    const tb = blocks[tIdx];
                    player.position.set(tb.position.x, tb.position.y + CONFIG.blockHeight, tb.position.z);
                    player.quaternion.identity();
                    showFloatText("🛡 时空回溯", player.position.clone().add(new THREE.Vector3(0, 1, 0)), true);
                    processLanded(tb, tIdx, jd);
                } else {
                    triggerGameOver();
                }
            } else {
                // 无护盾 -> 坠落
                triggerFall({
                    pos: player.position.clone(),
                    vel: jd.velocity.clone(),
                    rotAxis: new THREE.Vector3(1, 0.5, 0.3).normalize(),
                    rotSpeed: 8
                });
            }
        }
    }

    // ========== 输入处理 ==========
    function isUIEvent(e) {
        const el = e.target;
        // 检查是否点击到 UI 元素或其后代
        if (el.closest("#top-bar") || el.closest(".overlay") || el.closest("button") ||
            el.closest(".glass-panel") || el.closest(".glass-btn")) {
            return true;
        }
        return false;
    }

    function handleDown(e) {
        if (isUIEvent(e)) return;
        if (e.cancelable) e.preventDefault();
        if (GameState.state !== STATE.READY) return;
        GameState.state = STATE.CHARGING;
        GameState.chargeStartTime = performance.now() / 1000;
        UI.chargeFill.style.width = "0%";
        if (GameState.mode === "EASY") {
            UI.trajectoryHint.style.display = "block";
        }
    }

    function handleUp(e) {
        if (isUIEvent(e)) return;
        if (e.cancelable) e.preventDefault();
        if (GameState.state !== STATE.CHARGING) return;

        // 隐藏所有轨迹球
        if (window.trajMeshes) {
            window.trajMeshes.forEach(m => m.visible = false);
        }
        if (trajectoryPoints) trajectoryPoints.visible = false;

        GameState.state = STATE.JUMPING;
        UI.chargeFill.style.width = "0%";
        UI.trajectoryHint.style.display = "none";

        const duration = Math.min(performance.now() / 1000 - GameState.chargeStartTime, CONFIG.maxChargeTime);
        const power = duration / CONFIG.maxChargeTime;
        player.scale.set(1, 1, 1);

        const { dir, currentIdx } = getJumpDir();
        const hSpeed = CONFIG.jumpVelocityH * (0.4 + power * 1.2);
        const vSpeed = CONFIG.jumpVelocityY * (0.6 + power * 0.8);

        // 确定跳跃轴向：dir.x != 0 表示 X 轴跳跃, dir.z != 0 表示 Z 轴跳跃
        const jumpAxis = Math.abs(dir.x) > Math.abs(dir.z) ? 'x' : 'z';

        GameState.jumpData = {
            velocity: new THREE.Vector3(dir.x * hSpeed, vSpeed, dir.z * hSpeed),
            startBlockIdx: currentIdx,
            targetBlockIdx: currentIdx + 1,
            rotAxis: new THREE.Vector3(-dir.z, 0, dir.x).normalize(),
            rotSpeed: (Math.PI * 2) / 0.6,
            elapsed: 0,
            jumpAxis: jumpAxis  // 记录本次跳跃的轴向，用于落点回正
        };
    }

    // ========== UI 事件绑定 ==========
    UI.shopBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        e.preventDefault();
        if (GameState.state === STATE.READY || GameState.state === STATE.GAMEOVER) {
            GameState.previousState = GameState.state;
            GameState.state = STATE.SHOP;
            UI.shopOverlay.classList.remove("hidden");
            UI.confirmPayBtn.textContent = "验证充能";
            UI.confirmPayBtn.classList.remove("loading");
        }
    });

    UI.closeShopBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        e.preventDefault();
        UI.shopOverlay.classList.add("hidden");
        setTimeout(() => {
            GameState.state = GameState.previousState;
        }, 300);
    });

    UI.confirmPayBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        e.preventDefault();
        UI.confirmPayBtn.textContent = "处理中...";
        UI.confirmPayBtn.classList.add("loading");
        // 调后端 API
        const API_BASE = "http://localhost:5000/api";
        (async () => {
            try {
                const cr = await fetch(API_BASE + "/order/create", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ product_id: "shield_x3", amount: 1.00 })
                });
                const cd = await cr.json();
                if (!cd.success) throw new Error("创建订单失败");

                const vr = await fetch(API_BASE + "/order/verify", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ order_id: cd.order_id })
                });
                const vd = await vr.json();
                if (!vd.success) throw new Error(vd.message || "验证失败");

                GameState.shields += 3;
                updateShieldUI();
                UI.closeShopBtn.click();

                if (GameState.previousState === STATE.GAMEOVER) {
                    UI.gameOverOverlay.classList.add("hidden");
                    GameState.state = STATE.READY;
                    const last = blocks[blocks.length - 1];
                    if (last) {
                        player.position.set(last.position.x, CONFIG.blockHeight, last.position.z);
                        player.quaternion.identity();
                        GameState.cameraLookTarget.set(last.position.x, 0, last.position.z);
                        GameState.cameraTarget.set(last.position.x + CONFIG.camOffset.x, CONFIG.camOffset.y, last.position.z + CONFIG.camOffset.z);
                    }
                }
            } catch (err) {
                alert("支付失败: " + err.message);
            } finally {
                UI.confirmPayBtn.textContent = "验证充能";
                UI.confirmPayBtn.classList.remove("loading");
            }
        })();
    });

    UI.retryBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        e.preventDefault();
        initGame();
    });

    if (UI.modeToggle) {
        UI.modeToggle.addEventListener("click", function (e) {
            e.stopPropagation();
            e.preventDefault();
            if (GameState.mode === "HARD") {
                GameState.mode = "EASY";
                UI.modeText.textContent = "🟢 简单";
            } else {
                GameState.mode = "HARD";
                UI.modeText.textContent = "🔥 困难";
                trajectoryPoints.visible = false;
                UI.trajectoryHint.style.display = "none";
            }
        });
    }

    // ========== 窗口事件 (游戏输入) ==========
    const isTouch = "ontouchstart" in window;
    window.addEventListener(isTouch ? "touchstart" : "mousedown", handleDown, { passive: false });
    window.addEventListener(isTouch ? "touchend" : "mouseup", handleUp, { passive: false });
    window.addEventListener("touchmove", function (e) {
        if (GameState.state === STATE.CHARGING) e.preventDefault();
    }, { passive: false });

    window.addEventListener("resize", function () {
        renderer.setSize(window.innerWidth, window.innerHeight);
        updateCameraSize();
    });

    // ========== 循环 ==========
    function initGame() {
        // 1. 清理旧实体与初始化轨迹球池
        [...blocks].forEach(b => disposeObj(b));
        blocks = [];
        if (player) disposeObj(player);

        // 初始化轨迹球阵列（如果还没创建）—— 增强版：更多、更大、更亮！
        if (!window.trajMeshes) {
            window.trajMeshes = [];
            for (let i = 0; i < 35; i++) {
                const trajGeo = new THREE.SphereGeometry(0.12, 10, 10);
                const trajMat = new THREE.MeshBasicMaterial({ color: 0xf1c40f });
                const m = new THREE.Mesh(trajGeo, trajMat);
                m.visible = false;
                scene.add(m);
                window.trajMeshes.push(m);
            }
        }

        GameState.score = 0;
        UI.scoreValue.textContent = "0";
        UI.gameOverOverlay.classList.add("hidden");

        // 2. 生成起始方块 (b1)
        const b1 = generateBlock(new THREE.Vector3(0, 0, 0), true);

        // 3. 修正：初始第二个块的方向也必须锁定为右上(0)或左上(PI/2)
        const angle = Math.random() > 0.5 ? 0 : Math.PI / 2;
        const d = 3.0; // 固定初始距离
        generateBlock(new THREE.Vector3(Math.cos(angle) * d, 0, Math.sin(angle) * d));

        player = createPlayer();
        player.position.set(0, CONFIG.blockHeight, 0);
        scene.add(player);

        const mid = new THREE.Vector3().copy(b1.position).add(blocks[1].position).multiplyScalar(0.5);
        GameState.cameraLookTarget.set(mid.x, 0, mid.z);
        GameState.cameraTarget.set(mid.x + CONFIG.camOffset.x, CONFIG.camOffset.y, mid.z + CONFIG.camOffset.z);
        camera.position.copy(GameState.cameraTarget);
        camera.lookAt(GameState.cameraLookTarget);

        if (!camera.userData.lookAt) camera.userData.lookAt = new THREE.Vector3();
        camera.userData.lookAt.copy(GameState.cameraLookTarget);

        updateShieldUI();
        GameState.state = STATE.READY;

        if (!window._loopStarted) {
            window._loopStarted = true;
            requestAnimationFrame(loop);
        }
    }

    let lastTime = 0;
    function loop(time) {
        const delta = lastTime ? Math.min((time - lastTime) / 1000, 0.1) : 0.016;
        lastTime = time;

        // 护盾旋转
        if (shieldMesh && GameState.shields > 0) {
            shieldMesh.rotation.y += delta * 3;
            shieldMesh.rotation.x += delta * 0.5;
        }

        // 蓄力更新
        if (GameState.state === STATE.CHARGING) {
            const pct = Math.min((time / 1000 - GameState.chargeStartTime) / CONFIG.maxChargeTime, 1);
            UI.chargeFill.style.width = (pct * 100) + "%";
            player.scale.set(1 + pct * 0.1, 1 - pct * 0.3, 1 + pct * 0.1);

            if (GameState.mode === "EASY") {
                updateTrajectory(pct);
            }
        }

        // 跳跃
        if (GameState.state === STATE.JUMPING) {
            updateJump(delta);
        }

        // 坠落
        if (GameState.state === STATE.FALLING) {
            const fd = GameState.fallData;
            fd.vel.y += CONFIG.gravity * delta;
            fd.pos.addScaledVector(fd.vel, delta);
            player.position.copy(fd.pos);
            player.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(fd.rotAxis, fd.rotSpeed * delta));
            if (fd.pos.y < -6) triggerGameOver();
        }

        // 相机
        if (GameState.state !== STATE.GAMEOVER && GameState.state !== STATE.SHOP) {
            camera.position.lerp(GameState.cameraTarget, CONFIG.cameraLerp * delta);
            const cl = camera.userData.lookAt;
            if (cl) {
                cl.lerp(GameState.cameraLookTarget, CONFIG.cameraLerp * delta);
                camera.lookAt(cl);
            }
        }

        renderer.render(scene, camera);
        requestAnimationFrame(loop);
    }

    initGame();
})();
