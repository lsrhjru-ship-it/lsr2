const express = require('express');
const path = require('path');
const fs = require('fs');
const app = express();
const PORT = 3000;

app.use(express.json());

let trains = {};
const DB_PATH = path.join(__dirname, 'accounts.json');

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

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// [API] 전체 계정 목록 조회
app.get('/api/accounts', (req, res) => {
    res.json(accounts);
});

// [API] 신규 관제원 계정 생성
app.post('/api/accounts', (req, res) => {
    const { id, pw, rbxId, role } = req.body;
    if (accounts.some(a => a.id === id)) {
        return res.status(400).json({ error: "이미 존재하는 ID입니다." });
    }
    accounts.push({ id, pw, rbxId: parseInt(rbxId) || 1, role: role || "일반 관제원" });
    saveAccounts();
    res.json({ success: true });
});

// [API] 계정 정보 변경
app.put('/api/accounts/:id', (req, res) => {
    const { id } = req.params;
    const { pw, rbxId, role } = req.body;

    const accountIndex = accounts.findIndex(a => a.id === id);
    if (accountIndex === -1) {
        return res.status(404).json({ error: "존재하지 않는 계정입니다." });
    }

    if (pw) accounts[accountIndex].pw = pw;
    if (rbxId !== undefined) accounts[accountIndex].rbxId = parseInt(rbxId) || 1;
    if (role) accounts[accountIndex].role = role;

    saveAccounts();
    res.json({ success: true });
});

// [API] 계정 삭제
app.delete('/api/accounts/:id', (req, res) => {
    const { id } = req.params;
    if (id === "lsrhjru") {
        return res.status(400).json({ error: "최고 관리자 계정은 삭제할 수 없습니다." });
    }
    const accountIndex = accounts.findIndex(a => a.id === id);
    if (accountIndex === -1) {
        return res.status(404).json({ error: "존재하지 않는 계정입니다." });
    }
    accounts.splice(accountIndex, 1);
    saveAccounts();
    res.json({ success: true });
});

// [API] 로블록스 데이터 파싱 안전 지대 구성
app.get('/api/roblox/user/:rbxId', async (req, res) => {
    const { rbxId } = req.params;
    try {
        const userRes = await fetch(`https://users.roblox.com/v1/users/${rbxId}`);
        const userData = await userRes.json();

        const thumbRes = await fetch(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${rbxId}&size=150x150&format=Png&isCircular=true`);
        const thumbData = await thumbRes.json();

        const displayName = userData.displayName || userData.name || `User ${rbxId}`;
        const nameTag = userData.name ? ` (@${userData.name})` : '';
        const username = `${displayName}${nameTag}`;

        const avatarUrl = (thumbData.data && thumbData.data[0])
            ? thumbData.data[0].imageUrl
            : "https://upload.wikimedia.org/wikipedia/commons/a/ac/Default_pfp.jpg";

        res.json({ username, avatarUrl });
    } catch (error) {
        console.error("로블록스 데이터 연동 실패:", error);
        res.json({
            username: `User ${rbxId}`,
            avatarUrl: "https://upload.wikimedia.org/wikipedia/commons/a/ac/Default_pfp.jpg"
        });
    }
});

// 🔄 [API] 열차 상태 수신 및 원격 제어 옵션 전달 (대소문자 불일치 완벽 해결 버전을 적용함)
app.post('/api/train-status', (req, res) => {
    const TrainId = req.body.TrainId || req.body.trainId;
    const SpeedLimit = req.body.SpeedLimit !== undefined ? req.body.SpeedLimit : req.body.speedLimit;
    const Action = req.body.Action || req.body.action;

    if (!TrainId) {
        return res.status(400).json({ error: "TrainId가 누락되었습니다." });
    }

    // 세션 파괴 호출 시 신속 삭제
    if (Action === "DELETE" || Action === "delete") {
        delete trains[TrainId];
        return res.json({ success: true, message: "열차가 정상 제거되었습니다." });
    }

    const previousEmergency = trains[TrainId] ? trains[TrainId].remoteEmergencyActive : false;
    const targetSpeedLimit = trains[TrainId] ? trains[TrainId].SpeedLimit : (SpeedLimit || 30);

    // 인게임 패킷 덮어쓰기 방지용 기존 상태 확보
    const currentVigilanceState = (trains[TrainId] && trains[TrainId].VigilanceEnabled !== undefined)
        ? trains[TrainId].VigilanceEnabled
        : true;

    // 들어온 데이터를 대소문자 무관하게 상호 파싱하여 결합
    const status = req.body.Status || req.body.status || "Normal";
    const isEmergency = req.body.IsEmergency !== undefined ? req.body.IsEmergency : (req.body.isEmergency || false);
    const emergencyReason = req.body.EmergencyReason || req.body.emergencyReason || "None";
    const currentSpeed = req.body.CurrentSpeed !== undefined ? req.body.CurrentSpeed : (req.body.currentSpeed || 0);
    const trainName = req.body.TrainName || req.body.trainName || "시운전 열차";
    const currentNotch = req.body.CurrentNotch !== undefined ? req.body.CurrentNotch : (req.body.currentNotch || 0);
    const currentReverser = req.body.CurrentReverser !== undefined ? req.body.CurrentReverser : (req.body.currentReverser || 0);
    const driverName = req.body.DriverName || req.body.driverName || "Unknown";
    const driverDisplayName = req.body.DriverDisplayName || req.body.driverDisplayName || "Unknown";
    const driverUserId = req.body.DriverUserId || req.body.driverUserId || req.body.DriverId || req.body.driverId || "0";
    const positionX = req.body.PositionX !== undefined ? req.body.PositionX : (req.body.positionX || 0);
    const positionZ = req.body.PositionZ !== undefined ? req.body.PositionZ : (req.body.positionZ || 0);

    // ⭐️ [핵심 패치] 어떤 형태의 key 명칭으로 가져다 쓰든 에러가 나지 않도록 양방향 매핑 처리
    trains[TrainId] = {
        ...req.body,
        
        // 1. 웹사이트(index.html) 프론트엔드가 사용하는 소문자/카멜케이스 필드 채워주기
        trainId: TrainId,
        trainName: trainName,
        currentSpeed: currentSpeed,
        currentNotch: currentNotch,
        currentReverser: currentReverser,
        isEmergency: isEmergency,
        status: status,
        emergencyReason: emergencyReason,
        driverName: driverName,
        driverDisplayName: driverDisplayName,
        driverUserId: driverUserId,
        positionX: positionX,
        positionZ: positionZ,
        speedLimit: targetSpeedLimit,
        vigilanceEnabled: currentVigilanceState,

        // 2. 백엔드 및 로블록스 제어용 데이터 구조 유지
        TrainId: TrainId,
        TrainName: trainName,
        CurrentSpeed: currentSpeed,
        CurrentNotch: currentNotch,
        CurrentReverser: currentReverser,
        IsEmergency: isEmergency,
        Status: status,
        EmergencyReason: emergencyReason,
        SpeedLimit: targetSpeedLimit,
        VigilanceEnabled: currentVigilanceState,
        remoteEmergencyActive: previousEmergency,
        lastSeen: Date.now()
    };

    res.json({
        RemoteEmergency: trains[TrainId].remoteEmergencyActive,
        SpeedLimit: trains[TrainId].SpeedLimit,
        VigilanceEnabled: trains[TrainId].VigilanceEnabled
    });
});

// [API] 대시보드 데이터 전송
app.get('/api/current-data', (req, res) => {
    const now = Date.now();
    for (const id in trains) {
        if (now - trains[id].lastSeen > 30000) {
            delete trains[id];
        }
    }
    res.json({ trains: trains, logs: [] });
});

// [API] 제한 속도 변경 명령
app.post('/api/web-speedlimit', (req, res) => {
    const trainId = req.body.trainId || req.body.TrainId;
    const speedLimit = req.body.speedLimit !== undefined ? req.body.speedLimit : req.body.SpeedLimit;

    if (trains[trainId]) {
        trains[trainId].SpeedLimit = parseInt(speedLimit) || 30;
        res.json({ success: true });
    } else {
        res.status(404).json({ error: "열차를 찾을 수 없습니다." });
    }
});

// [API] 원격 비상 정지 명령
app.post('/api/web-emergency', (req, res) => {
    const trainId = req.body.trainId || req.body.TrainId;
    if (trains[trainId]) {
        trains[trainId].remoteEmergencyActive = true;
        res.json({ success: true });
    } else {
        res.status(404).json({ error: "열차를 찾을 수 없습니다." });
    }
});

// [API] 원격 비상 해제 명령
app.post('/api/web-reset', (req, res) => {
    const trainId = req.body.trainId || req.body.TrainId;
    if (trains[trainId]) {
        trains[trainId].remoteEmergencyActive = false;
        res.json({ success: true });
    } else {
        res.status(404).json({ error: "열차를 찾을 수 없습니다." });
    }
});

// 🚨 [API] 웹 관제소 원격 운전자 경계장치 토글 명령 라우터
app.post('/api/web-vigilance', (req, res) => {
    const trainId = req.body.trainId || req.body.TrainId;
    const vigilanceEnabled = req.body.vigilanceEnabled !== undefined ? req.body.vigilanceEnabled : req.body.VigilanceEnabled;

    if (trains[trainId]) {
        trains[trainId].VigilanceEnabled = (vigilanceEnabled === true || vigilanceEnabled === 'true' || vigilanceEnabled === 1);
        res.json({ success: true });
    } else {
        res.status(404).json({ error: "열차를 찾을 수 없습니다." });
    }
});

app.listen(PORT, () => {
    console.log(`[통합 관제탑 서버 실행 완료] http://localhost:${PORT}`);
});
