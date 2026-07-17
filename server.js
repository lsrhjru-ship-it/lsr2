const express = require('express');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose'); // ➕ MongoDB 연결을 위한 Mongoose 추가
const app = express();
const PORT = 3000;

app.use(express.json());

// ============================
// 💾 [데이터베이스 설정] MongoDB 연결
// ============================
// 로컬 DB 기준 주소입니다. 클라우드(MongoDB Atlas)를 쓰신다면 해당 URL로 변경하세요.
const MONGO_URI = 'mongodb://localhost:27017/train_control_tower'; 

mongoose.connect(MONGO_URI)
    .then(() => {
        console.log('▶ [DB] MongoDB 연결 성공!');
        initAdminAccount(); // 연결 성공 후 관리자 계정 초기화 실행
    })
    .catch(err => console.error('◀ [DB] MongoDB 연결 실패:', err));

// 계정(Account) 스키마 및 모델 정의
const accountSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true },
    pw: { type: String, required: true },
    rbxId: { type: Number, default: 1 },
    role: { type: String, default: '일반 관제원' }
});
const Account = mongoose.model('Account', accountSchema);

// 최고 관리자 계정 자동 생성 함수
async function initAdminAccount() {
    try {
        const adminExists = await Account.findOne({ id: "lsrhjru" });
        if (!adminExists) {
            await Account.create({
                id: "lsrhjru",
                pw: "lsr37733*", // ⚠️ 주의: 실서비스 시에는 비밀번호를 해싱(암호화)해서 저장하는 것을 추천합니다!
                rbxId: 4548323500,
                role: "최고 관리자"
            });
            addLog("[시스템] 기본 최고 관리자 계정이 DB에 생성되었습니다.");
        }
    } catch (e) {
        console.error("최고 관리자 초기화 에러:", e);
    }
}

// ============================
// 🚂 실시간 열차 데이터 및 로그 변수
// ============================
let trains = {};
let logs = []; 
const robloxCache = {};

function addLog(message) {
    const timestamp = new Date().toLocaleTimeString('ko-KR', { hour12: false });
    logs.unshift({ time: timestamp, text: message });
    if (logs.length > 30) {
        logs.pop();
    }
}

addLog("통합 관제탑 시스템이 성공적으로 준비되었습니다. 🛰️");

// ============================
// 🗺️ 선로 레이아웃 저장소 (기존 유지)
// ============================
const TRACK_PATH = path.join(__dirname, 'track.json');
let trackLayout = { segments: [], bounds: null, updatedAt: null };
try {
    if (fs.existsSync(TRACK_PATH)) {
        trackLayout = JSON.parse(fs.readFileSync(TRACK_PATH, 'utf-8'));
    }
} catch (e) {
    trackLayout = { segments: [], bounds: null, updatedAt: null };
}

app.get('/api/track-layout', (req, res) => {
    res.json(trackLayout);
});

app.post('/api/track-layout', (req, res) => {
    const segments = req.body.segments;
    if (!Array.isArray(segments) || segments.length === 0) {
        return res.status(400).json({ error: "segments 배열이 비어있거나 올바르지 않습니다." });
    }

    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const seg of segments) {
        const points = [[seg.x1, seg.z1], [seg.x2, seg.z2]];
        for (const [x, z] of points) {
            if (typeof x !== 'number' || typeof z !== 'number') continue;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (z < minZ) minZ = z;
            if (z > maxZ) maxZ = z;
        }
    }

    if (minX === Infinity) {
        return res.status(400).json({ error: "유효한 좌표가 없습니다." });
    }

    const padX = Math.max((maxX - minX) * 0.05, 50);
    const padZ = Math.max((maxZ - minZ) * 0.05, 50);

    trackLayout = {
        segments,
        bounds: { minX: minX - padX, maxX: maxX + padX, minZ: minZ - padZ, maxZ: maxZ + padZ },
        updatedAt: Date.now()
    };

    fs.writeFileSync(TRACK_PATH, JSON.stringify(trackLayout, null, 2));
    addLog(`[선로 데이터] 선로 레이아웃이 갱신되었습니다. (구간 ${segments.length}개)`);
    res.json({ success: true, count: segments.length, bounds: trackLayout.bounds });
});

// ============================
// 🚦 자동 ATC 속도제한 및 거리 계산 (기존 유지)
// ============================
const SPACING_CONFIG = {
    MIN_LIMIT: 50,
    MAX_LIMIT: 80,
    NEAR_DISTANCE: 100,
    FAR_DISTANCE: 500
};

function getDistance(a, b) {
    if (a.PositionX === undefined || a.PositionZ === undefined) return Infinity;
    if (b.PositionX === undefined || b.PositionZ === undefined) return Infinity;
    const dx = a.PositionX - b.PositionX;
    const dz = a.PositionZ - b.PositionZ;
    return Math.sqrt(dx * dx + dz * dz);
}

// 소수점 보간 공식에 타사 라이브러리/수식 보호를 위해 원형 유지
function distanceToSpeedLimit(distance) {
    const { MIN_LIMIT, MAX_LIMIT, NEAR_DISTANCE, FAR_DISTANCE } = SPACING_CONFIG;
    if (distance <= NEAR_DISTANCE) return MIN_LIMIT;
    if (distance >= FAR_DISTANCE) return MAX_LIMIT;
    const ratio = (distance - NEAR_DISTANCE) / (FAR_DISTANCE - NEAR_DISTANCE);
    const raw = MIN_LIMIT + ratio * (MAX_LIMIT - MIN_LIMIT);
    return Math.round(raw * 10) / 10;
}

function applySpacingSpeedLimits() {
    const ids = Object.keys(trains);
    for (const id of ids) {
        const train = trains[id];
        if (train.ManualOverride) continue;

        let nearestDistance = Infinity;
        for (const otherId of ids) {
            if (otherId === id) continue;
            const dist = getDistance(train, trains[otherId]);
            if (dist < nearestDistance) nearestDistance = dist;
        }

        if (nearestDistance !== Infinity) {
            train.SpeedLimit = distanceToSpeedLimit(nearestDistance);
            train.NearestTrainDistance = Math.round(nearestDistance * 10) / 10;
        }
    }
}

async function fetchWithTimeout(url, options = {}, timeout = 1500) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        clearTimeout(id);
        return response;
    } catch (error) {
        clearTimeout(id);
        throw error;
    }
}

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ============================
// 🌐 [API 리팩토링] 계정 관리 API (DB 기반으로 전환)
// ============================

// [API] 전체 계정 목록 조회
app.get('/api/accounts', async (req, res) => {
    try {
        const allAccounts = await Account.find({});
        res.json(allAccounts);
    } catch (err) {
        res.status(500).json({ error: "계정을 불러오는 중 오류가 발생했습니다." });
    }
});

// [API] 신규 관제원 계정 생성
app.post('/api/accounts', async (req, res) => {
    const { id, pw, rbxId, role, adminId } = req.body;
    try {
        const existingAccount = await Account.findOne({ id });
        if (existingAccount) {
            return res.status(400).json({ error: "이미 존재하는 ID입니다." });
        }
        
        await Account.create({
            id,
            pw,
            rbxId: parseInt(rbxId) || 1,
            role: role || "일반 관제원"
        });

        addLog(`[계정 생성] 관제원 ${adminId || '시스템'}이(가) 신규 계정 [${id}]을(를) 생성했습니다.`);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: "계정 생성 중 오류가 발생했습니다." });
    }
});

// [API] 계정 정보 변경
app.put('/api/accounts/:id', async (req, res) => {
    const { id } = req.params;
    const { pw, rbxId, role, adminId } = req.body;

    try {
        const updateData = {};
        if (pw) updateData.pw = pw;
        if (rbxId !== undefined) updateData.rbxId = parseInt(rbxId) || 1;
        if (role) updateData.role = role;

        const updatedAccount = await Account.findOneAndUpdate({ id }, updateData, { new: true });
        if (!updatedAccount) {
            return res.status(404).json({ error: "존재하지 않는 계정입니다." });
        }

        addLog(`[계정 수정] 관제원 ${adminId || '시스템'}이(가) [${id}] 계정 정보를 변경했습니다.`);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: "계정 수정 중 오류가 발생했습니다." });
    }
});

// [API] 계정 삭제
app.delete('/api/accounts/:id', async (req, res) => {
    const { id } = req.params;
    const { adminId } = req.body;

    if (id === "lsrhjru") {
        return res.status(400).json({ error: "최고 관리자 계정은 삭제할 수 없습니다." });
    }

    try {
        const deletedAccount = await Account.findOneAndDelete({ id });
        if (!deletedAccount) {
            return res.status(404).json({ error: "존재하지 않는 계정입니다." });
        }

        addLog(`[계정 삭제] 관제원 ${adminId || '시스템'}이(가) [${id}] 계정을 삭제했습니다.`);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: "계정 삭제 중 오류가 발생했습니다." });
    }
});

// ============================
// 🤖 외부 API 및 열차 제어 라우터 (기존 유지)
// ============================
app.get('/api/roblox/user/:rbxId', async (req, res) => {
    const { rbxId } = req.params;
    if (robloxCache[rbxId]) return res.json(robloxCache[rbxId]);

    try {
        const userRes = await fetchWithTimeout(`https://users.roblox.com/v1/users/${rbxId}`, {}, 1500);
        const userData = await userRes.json();
        const thumbRes = await fetchWithTimeout(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${rbxId}&size=150x150&format=Png&isCircular=true`, {}, 1500);
        const thumbData = await thumbRes.json();

        const displayName = userData.displayName || userData.name || `User ${rbxId}`;
        const nameTag = userData.name ? ` (@${userData.name})` : '';
        const username = `${displayName}${nameTag}`;
        const avatarUrl = (thumbData.data && thumbData.data[0]) ? thumbData.data[0].imageUrl : "https://upload.wikimedia.org/wikipedia/commons/a/ac/Default_pfp.jpg";

        const profileData = { username, avatarUrl };
        robloxCache[rbxId] = profileData;
        res.json(profileData);
    } catch (error) {
        res.json({ username: `User ${rbxId}`, avatarUrl: "https://upload.wikimedia.org/wikipedia/commons/a/ac/Default_pfp.jpg" });
    }
});

app.post('/api/train-status', (req, res) => {
    const TrainId = req.body.TrainId || req.body.trainId;
    const SpeedLimit = req.body.SpeedLimit !== undefined ? req.body.SpeedLimit : req.body.speedLimit;
    const Action = req.body.Action || req.body.action;

    if (!TrainId) return res.status(400).json({ error: "TrainId가 누락되었습니다." });

    if (Action === "DELETE" || Action === "delete") {
        if (trains[TrainId]) {
            const driver = trains[TrainId].DriverName || "알 수 없음";
            addLog(`[운행 종료] [${TrainId}] 열차가 반납되었습니다. (운전자: ${driver})`);
        }
        delete trains[TrainId];
        return res.json({ success: true, message: "열차가 정상 제거되었습니다." });
    }

    const previousEmergency = trains[TrainId] ? trains[TrainId].remoteEmergencyActive : false;
    const targetSpeedLimit = trains[TrainId] ? trains[TrainId].SpeedLimit : (SpeedLimit || 30);
    const currentVigilanceState = (trains[TrainId] && trains[TrainId].VigilanceEnabled !== undefined) ? trains[TrainId].VigilanceEnabled : true;

    const isNew = !trains[TrainId];
    const oldDriver = trains[TrainId] ? trains[TrainId].DriverName : null;
    const newDriver = req.body.DriverName;

    trains[TrainId] = {
        ...req.body,
        TrainId: TrainId,
        SpeedLimit: targetSpeedLimit,
        remoteEmergencyActive: previousEmergency,
        VigilanceEnabled: currentVigilanceState,
        lastSeen: Date.now()
    };

    if (isNew) {
        addLog(`[신규 연결] [${TrainId}] 열차가 관제망에 연결되었습니다. (운전자: ${newDriver || '대기 중'})`);
    } else if (newDriver && oldDriver !== newDriver) {
        addLog(`[운전자 교대] [${TrainId}] 운전자가 변경되었습니다. (${oldDriver || '없음'} -> ${newDriver})`);
    }

    applySpacingSpeedLimits();

    res.json({
        RemoteEmergency: trains[TrainId].remoteEmergencyActive,
        SpeedLimit: trains[TrainId].SpeedLimit,
        VigilanceEnabled: trains[TrainId].VigilanceEnabled
    });
});

app.get('/api/current-data', (req, res) => {
    const now = Date.now();
    for (const id in trains) {
        if (now - trains[id].lastSeen > 30000) {
            addLog(`[연결 유실] [${id}] 열차가 신호 감쇠로 인해 연결 유실되었습니다.`);
            delete trains[id];
        }
    }
    res.json({ trains: trains, logs: logs });
});

app.post('/api/web-speedlimit', (req, res) => {
    const trainId = req.body.trainId || req.body.TrainId;
    const speedLimit = req.body.speedLimit !== undefined ? req.body.speedLimit : req.body.SpeedLimit;
    const adminId = req.body.adminId || "시스템";
    const auto = req.body.auto === true;

    if (!trains[trainId]) return res.status(404).json({ error: "열차를 찾을 수 없습니다." });

    if (auto) {
        trains[trainId].ManualOverride = false;
        addLog(`[속도 제한] [${trainId}] 자동 간격 조절 모드로 전환했습니다. (관제원: ${adminId})`);
    } else {
        trains[trainId].SpeedLimit = parseInt(speedLimit) || 30;
        trains[trainId].ManualOverride = true;
        addLog(`[속도 제한] [${trainId}] 속도제한을 ${speedLimit}km/h로 수동 설정했습니다. (관제원: ${adminId})`);
    }
    res.json({ success: true });
});

app.post('/api/web-emergency', (req, res) => {
    const trainId = req.body.trainId || req.body.TrainId;
    const adminId = req.body.adminId || "시스템";

    if (trains[trainId]) {
        trains[trainId].remoteEmergencyActive = true;
        addLog(`[비상 제동] [${trainId}] 원격 비상 제동을 체결했습니다. 🚨 (관제원: ${adminId})`);
        res.json({ success: true });
    } else {
        res.status(404).json({ error: "열차를 찾을 수 없습니다." });
    }
});

app.post('/api/web-reset', (req, res) => {
    const trainId = req.body.trainId || req.body.TrainId;
    const adminId = req.body.adminId || "시스템";

    if (trains[trainId]) {
        trains[trainId].remoteEmergencyActive = false;
        addLog(`[제동 해제] [${trainId}] 원격 비상 제동을 해제했습니다. 🟢 (관제원: ${adminId})`);
        res.json({ success: true });
    } else {
        res.status(404).json({ error: "열차를 찾을 수 없습니다." });
    }
});

app.post('/api/web-vigilance', (req, res) => {
    const trainId = req.body.trainId || req.body.TrainId;
    const vigilanceEnabled = req.body.vigilanceEnabled !== undefined ? req.body.vigilanceEnabled : req.body.VigilanceEnabled;
    const adminId = req.body.adminId || "시스템";

    if (trains[trainId]) {
        const isEnabled = (vigilanceEnabled === true || vigilanceEnabled === 'true' || vigilanceEnabled === 1);
        trains[trainId].VigilanceEnabled = isEnabled;
        addLog(`[경계장치] [${trainId}] 경계장치를 ${isEnabled ? '활성화' : '비활성화'} 처리했습니다. (관제원: ${adminId})`);
        res.json({ success: true });
    } else {
        res.status(404).json({ error: "열차를 찾을 수 없습니다." });
    }
});

app.listen(PORT, () => {
    console.log(`[통합 관제탑 서버 실행 완료] http://localhost:${PORT}`);
});
