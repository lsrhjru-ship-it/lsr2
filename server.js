const express = require('express');
const path = require('path');
const fs = require('fs');
const app = express();
const PORT = 3000;

app.use(express.json());

let trains = {};
const DB_PATH = path.join(__dirname, 'accounts.json');

// 시스템 초기화 시 계정 DB 안전하게 로드 (서버 크래시 방지용 예외 처리)
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

// 계정 저장 헬퍼 함수
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

// [API] 계정 정보 변경 (관리자 전용)
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

// [API] 계정 삭제 (관리자 전용)
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

// ⭐ [수정 완료] 로블록스 데이터 파싱 안전 지대 구성
app.get('/api/roblox/user/:rbxId', async (req, res) => {
    const { rbxId } = req.params;
    try {
        // 1. 유저 닉네임 및 기본정보 가져오기
        const userRes = await fetch(`https://users.roblox.com/v1/users/${rbxId}`);
        const userData = await userRes.json();

        // 2. 아바타 헤드샷 실제 이미지 URL 획득하기
        const thumbRes = await fetch(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${rbxId}&size=150x150&format=Png&isCircular=true`);
        const thumbData = await thumbRes.json();

        // 데이터 누락 시 안전하게 예외 필터 처리
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

// [API] 열차 상태 수신 및 웹 설정값 동기화
app.post('/api/train-status', (req, res) => {
    const { TrainId, SpeedLimit, Action } = req.body;

    if (!TrainId) {
        return res.status(400).json({ error: "TrainId가 누락되었습니다." });
    }

    if (Action === "DELETE") {
        delete trains[TrainId];
        return res.json({ success: true, message: "열차가 정상 제거되었습니다." });
    }

    const previousEmergency = trains[TrainId] ? trains[TrainId].remoteEmergencyActive : false;
    const targetSpeedLimit = trains[TrainId] ? trains[TrainId].SpeedLimit : (SpeedLimit || 30);

    trains[TrainId] = {
        ...req.body,
        SpeedLimit: targetSpeedLimit,
        remoteEmergencyActive: previousEmergency,
        lastSeen: Date.now()
    };

    res.json({
        RemoteEmergency: trains[TrainId].remoteEmergencyActive,
        SpeedLimit: trains[TrainId].SpeedLimit
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
    const { trainId, speedLimit } = req.body;
    if (trains[trainId]) {
        trains[trainId].SpeedLimit = parseInt(speedLimit) || 30;
        res.json({ success: true });
    } else {
        res.status(404).json({ error: "열차를 찾을 수 없습니다." });
    }
});

// [API] 원격 비상 정지 명령
app.post('/api/web-emergency', (req, res) => {
    const { trainId } = req.body;
    if (trains[trainId]) {
        trains[trainId].remoteEmergencyActive = true;
        res.json({ success: true });
    } else {
        res.status(404).json({ error: "열차를 찾을 수 없습니다." });
    }
});

// [API] 원격 비상 해제 명령
app.post('/api/web-reset', (req, res) => {
    const { trainId } = req.body;
    if (trains[trainId]) {
        trains[trainId].remoteEmergencyActive = false;
        res.json({ success: true });
    } else {
        res.status(404).json({ error: "열차를 찾을 수 없습니다." });
    }
});

app.listen(PORT, () => {
    console.log(`[통합 관제탑 서버 실행 완료] http://localhost:${PORT}`);
});
