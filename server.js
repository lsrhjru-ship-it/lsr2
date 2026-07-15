const express = require('express');
const path = require('path');
const fs = require('fs');
const app = express();
const PORT = 3000;

app.use(express.json());

let trains = {};
let logs = []; // 📜 실시간 조작 로그 저장 배열
const DB_PATH = path.join(__dirname, 'accounts.json');

// 💾 [서버사이드 캐시] 로블록스 유저 정보 임시 저장소
const robloxCache = {};

// 실시간 조작 로그 기록 함수 (최대 30개 유지)
function addLog(message) {
    const timestamp = new Date().toLocaleTimeString('ko-KR', { hour12: false });
    logs.unshift({ time: timestamp, text: message }); // 최신 로그가 맨 위로 오도록 추가
    if (logs.length > 30) {
        logs.pop();
    }
}

// 초기 기본 로그 기록
addLog("통합 관제탑 시스템이 성공적으로 준비되었습니다. 🛰️");

// 시스템 초기화 시 계정 DB 안전하게 로드
let accounts = [];
try {
    if (fs.existsSync(DB_PATH)) {
        accounts = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
    } else {
        throw new Error("DB 파일 없음");
    }
} catch (e) {
    accounts = [
        { id: "lsrhjru", pw: "lsr37733*", rbxId: 4548323500, role: "최고 관리자" }
    ];
    fs.writeFileSync(DB_PATH, JSON.stringify(accounts, null, 2));
}

const saveAccounts = () => fs.writeFileSync(DB_PATH, JSON.stringify(accounts, null, 2));

// ⏱️ API 타임아웃 방지 장치
async function fetchWithTimeout(url, options = {}, timeout = 1500) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal
        });
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

// [API] 전체 계정 목록 조회
app.get('/api/accounts', (req, res) => {
    res.json(accounts);
});

// [API] 신규 관제원 계정 생성
app.post('/api/accounts', (req, res) => {
    const { id, pw, rbxId, role, adminId } = req.body;
    if (accounts.some(a => a.id === id)) {
        return res.status(400).json({ error: "이미 존재하는 ID입니다." });
    }
    accounts.push({ id, pw, rbxId: parseInt(rbxId) || 1, role: role || "일반 관제원" });
    saveAccounts();
    addLog(`[계정 생성] 관제원 ${adminId || '시스템'}이(가) 신규 계정 [${id}]을(를) 생성했습니다.`);
    res.json({ success: true });
});

// [API] 계정 정보 변경
app.put('/api/accounts/:id', (req, res) => {
    const { id } = req.params;
    const { pw, rbxId, role, adminId } = req.body;

    const accountIndex = accounts.findIndex(a => a.id === id);
    if (accountIndex === -1) {
        return res.status(404).json({ error: "존재하지 않는 계정입니다." });
    }

    if (pw) accounts[accountIndex].pw = pw;
    if (rbxId !== undefined) accounts[accountIndex].rbxId = parseInt(rbxId) || 1;
    if (role) accounts[accountIndex].role = role;

    saveAccounts();
    addLog(`[계정 수정] 관제원 ${adminId || '시스템'}이(가) [${id}] 계정 정보를 변경했습니다.`);
    res.json({ success: true });
});

// [API] 계정 삭제
app.delete('/api/accounts/:id', (req, res) => {
    const { id } = req.params;
    const { adminId } = req.body;
    if (id === "lsrhjru") {
        return res.status(400).json({ error: "최고 관리자 계정은 삭제할 수 없습니다." });
    }
    const accountIndex = accounts.findIndex(a => a.id === id);
    if (accountIndex === -1) {
        return res.status(404).json({ error: "존재하지 않는 계정입니다." });
    }
    accounts.splice(accountIndex, 1);
    saveAccounts();
    addLog(`[계정 삭제] 관제원 ${adminId || '시스템'}이(가) [${id}] 계정을 삭제했습니다.`);
    res.json({ success: true });
});

// [API] 로블록스 데이터 파싱 안전 지대
app.get('/api/roblox/user/:rbxId', async (req, res) => {
    const { rbxId } = req.params;

    if (robloxCache[rbxId]) {
        return res.json(robloxCache[rbxId]);
    }

    try {
        const userRes = await fetchWithTimeout(`https://users.roblox.com/v1/users/${rbxId}`, {}, 1500);
        const userData = await userRes.json();

        const thumbRes = await fetchWithTimeout(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${rbxId}&size=150x150&format=Png&isCircular=true`, {}, 1500);
        const thumbData = await thumbRes.json();

        const displayName = userData.displayName || userData.name || `User ${rbxId}`;
        const nameTag = userData.name ? ` (@${userData.name})` : '';
        const username = `${displayName}${nameTag}`;

        const avatarUrl = (thumbData.data && thumbData.data[0])
            ? thumbData.data[0].imageUrl
            : "https://upload.wikimedia.org/wikipedia/commons/a/ac/Default_pfp.jpg";

        const profileData = { username, avatarUrl };
        robloxCache[rbxId] = profileData;

        res.json(profileData);
    } catch (error) {
        res.json({
            username: `User ${rbxId}`,
            avatarUrl: "https://upload.wikimedia.org/wikipedia/commons/a/ac/Default_pfp.jpg"
        });
    }
});

// [API] 열차 상태 수신 및 원격 제어 옵션 전달 (로블록스 -> 웹서버)
app.post('/api/train-status', (req, res) => {
    const TrainId = req.body.TrainId || req.body.trainId;
    const SpeedLimit = req.body.SpeedLimit !== undefined ? req.body.SpeedLimit : req.body.speedLimit;
    const Action = req.body.Action || req.body.action;

    if (!TrainId) {
        return res.status(400).json({ error: "TrainId가 누락되었습니다." });
    }

    // 열차가 삭제(반납) 되었을 때
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
    const currentVigilanceState = (trains[TrainId] && trains[TrainId].VigilanceEnabled !== undefined)
        ? trains[TrainId].VigilanceEnabled
        : true;

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

    // 신규 연결 또는 운전자 변경 로그 생성
    if (isNew) {
        addLog(`[신규 연결] [${TrainId}] 열차가 관제망에 연결되었습니다. (운전자: ${newDriver || '대기 중'})`);
    } else if (newDriver && oldDriver !== newDriver) {
        addLog(`[운전자 교대] [${TrainId}] 운전자가 변경되었습니다. (${oldDriver || '없음'} -> ${newDriver})`);
    }

    res.json({
        RemoteEmergency: trains[TrainId].remoteEmergencyActive,
        SpeedLimit: trains[TrainId].SpeedLimit,
        VigilanceEnabled: trains[TrainId].VigilanceEnabled
    });
});

// [API] 대시보드 데이터 전송 (로그 포함 전달)
app.get('/api/current-data', (req, res) => {
    const now = Date.now();
    for (const id in trains) {
        // 30초 동안 무반응 시 제거 및 로그 기록
        if (now - trains[id].lastSeen > 30000) {
            addLog(`[연결 유실] [${id}] 열차가 신호 감쇠로 인해 연결 유실되었습니다.`);
            delete trains[id];
        }
    }
    res.json({ trains: trains, logs: logs }); // 📜 저장된 로그 정상 전달!
});

// [API] 제한 속도 변경 명령
app.post('/api/web-speedlimit', (req, res) => {
    const trainId = req.body.trainId || req.body.TrainId;
    const speedLimit = req.body.speedLimit !== undefined ? req.body.speedLimit : req.body.SpeedLimit;
    const adminId = req.body.adminId || "시스템";

    if (trains[trainId]) {
        trains[trainId].SpeedLimit = parseInt(speedLimit) || 30;
        addLog(`[속도 제한] [${trainId}] 속도제한을 ${speedLimit}km/h로 설정했습니다. (관제원: ${adminId})`);
        res.json({ success: true });
    } else {
        res.status(404).json({ error: "열차를 찾을 수 없습니다." });
    }
});

// [API] 원격 비상 정지 명령
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

// [API] 원격 비상 해제 명령
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

// [API] 원격 경계장치 토글 명령
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
