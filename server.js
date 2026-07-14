const express = require('express');
const path = require('path');
const fs = require('fs');
const app = express();
const PORT = 3000;

app.use(express.json());

let trains = {};
const DB_PATH = path.join(__dirname, 'accounts.json');

// 시스템 초기화 시 계정 DB 로드 (최고 관리자 기본 생성 및 권한 동기화)
let accounts = [];
if (fs.existsSync(DB_PATH)) {
    accounts = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
} else {
    accounts = [
        { id: "lsrhjru", pw: "lsr37733*", rbxId: 1, role: "최고 관리자" }
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
    accounts.push({ id, pw, rbxId, role: role || "일반 관제원" });
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

// [API] 열차 상태 수신 및 웹 설정값 동기화
app.post('/api/train-status', (req, res) => {
    const { TrainId, SpeedLimit, Action } = req.body;

    if (!TrainId) {
        return res.status(400).json({ error: "TrainId가 누락되었습니다." });
    }

    // 인게임 기차 파괴/삭제 명령 감지 시 메모리 즉시 정리
    if (Action === "DELETE") {
        delete trains[TrainId];
        return res.json({ success: true, message: "열차가 정상 제거되었습니다." });
    }

    const previousEmergency = trains[TrainId] ? trains[TrainId].remoteEmergencyActive : false;

    // ⭐ [핵심 버그 수정] 웹 대시보드에서 수정한 값을 최우선 유지합니다. (없을 때만 기차가 보낸 값 적용)
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
        if (now - trains[id].lastSeen > 30000) { // 30초 간 통신 두절 시 자동 제거
            delete trains[id];
        }
    }
    res.json({ trains: trains, logs: [] }); // 감사로그 틀 보존
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
