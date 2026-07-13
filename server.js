const express = require('express');
const path = require('path');
const fs = require('fs');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// 메모리 데이터 저장소
let trains = {};
let systemLogs = []; 
const DB_PATH = path.join(__dirname, 'accounts.json');

// 계정 DB 로드 및 초기화
let accounts = [];
if (fs.existsSync(DB_PATH)) {
    accounts = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
} else {
    accounts = [{ id: "lsrhjru", pw: "lsr37733*", rbxId: 1, role: "최고 관리자" }];
    fs.writeFileSync(DB_PATH, JSON.stringify(accounts, null, 2));
}

const saveAccounts = () => fs.writeFileSync(DB_PATH, JSON.stringify(accounts, null, 2));

// 시스템 로그 추가 함수 (모든 클라이언트 공유)
function addLog(user, msg) {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('ko-KR', { hour12: false });
    systemLogs.push({ time: timeStr, user, msg });
    if (systemLogs.length > 100) systemLogs.shift(); // 최신 100개 유지
}

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// [API] 계정 및 로그 조회
app.get('/api/accounts', (req, res) => res.json(accounts));
app.get('/api/logs', (req, res) => res.json(systemLogs));

app.post('/api/accounts', (req, res) => {
    const { id, pw, rbxId, role } = req.body;
    if (accounts.some(a => a.id === id)) return res.status(400).json({ error: "중복 ID" });
    accounts.push({ id, pw, rbxId, role: role || "일반 관제원" });
    saveAccounts();
    res.json({ success: true });
});

// [API] 로블록스 열차 데이터 수신
app.post('/api/train-status', (req, res) => {
    const { TrainId } = req.body;
    if (!TrainId) return res.status(400).send("No TrainId");

    // 기존 데이터가 있으면 설정값(제한속도 등) 유지, 없으면 기본값 생성
    const prev = trains[TrainId] || { remoteEmergencyActive: false, SpeedLimit: 80 };
    
    trains[TrainId] = {
        ...req.body,
        remoteEmergencyActive: prev.remoteEmergencyActive,
        SpeedLimit: prev.SpeedLimit,
        lastSeen: Date.now()
    };

    // 로블록스로 명령 하달
    res.json({
        RemoteEmergency: trains[TrainId].remoteEmergencyActive,
        SpeedLimit: trains[TrainId].SpeedLimit
    });
});

// [API] 웹 대시보드용 데이터 전송
app.get('/api/current-data', (req, res) => {
    const now = Date.now();
    for (const id in trains) {
        if (now - trains[id].lastSeen > 15000) delete trains[id]; // 15초 미응답 시 삭제
    }
    res.json(trains);
});

// [API] 관제 명령 (제한속도, 비상정지, 해제)
app.post('/api/web-speedlimit', (req, res) => {
    const { trainId, speedLimit, user } = req.body;
    if (trains[trainId]) {
        trains[trainId].SpeedLimit = speedLimit;
        addLog(user, `열차 [${trainId}] ATC 제한속도 ${speedLimit}km/h로 변경`);
        res.json({ success: true });
    }
});

app.post('/api/web-emergency', (req, res) => {
    const { trainId, user } = req.body;
    if (trains[trainId]) {
        trains[trainId].remoteEmergencyActive = true;
        addLog(user, `⚠️ 열차 [${trainId}] 원격 비상 정지 강제 체결`);
        res.json({ success: true });
    }
});

app.post('/api/web-reset', (req, res) => {
    const { trainId, user } = req.body;
    if (trains[trainId]) {
        trains[trainId].remoteEmergencyActive = false;
        addLog(user, `✅ 열차 [${trainId}] 비상 상태 원격 해제`);
        res.json({ success: true });
    }
});

app.listen(PORT, () => console.log(`통합 서버 가동 중: 포트 ${PORT}`));
