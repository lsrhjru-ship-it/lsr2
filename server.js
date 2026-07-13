const express = require('express');
const path = require('path');
const fs = require('fs');
const app = express();
const PORT = 3000;

app.use(express.json());

let trains = {};
let systemLogs = []; // 전역 로그 저장소 추가
const DB_PATH = path.join(__dirname, 'accounts.json');

// 계정 로드 로직 (기존 유지)
let accounts = [];
if (fs.existsSync(DB_PATH)) {
    accounts = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
} else {
    accounts = [{ id: "lsrhjru", pw: "lsr37733*", rbxId: 1, role: "최고 관리자" }];
    fs.writeFileSync(DB_PATH, JSON.stringify(accounts, null, 2));
}

// 로그 추가 함수
function addServerLog(user, message) {
    const now = new Date();
    const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
    const logEntry = { time: timeStr, user: user, msg: message };
    systemLogs.push(logEntry);
    if (systemLogs.length > 100) systemLogs.shift(); // 최신 100개만 유지
}

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// [API] 로그 조회
app.get('/api/logs', (req, res) => res.json(systemLogs));

// [API] 계정 목록
app.get('/api/accounts', (req, res) => res.json(accounts));

// [API] 열차 상태 수신 (로블록스 -> 서버)
app.post('/api/train-status', (req, res) => {
    const { TrainId } = req.body;
    if (!TrainId) return res.status(400).send("No ID");

    const previous = trains[TrainId] || { remoteEmergencyActive: false, SpeedLimit: 80 };
    
    trains[TrainId] = {
        ...req.body,
        remoteEmergencyActive: previous.remoteEmergencyActive,
        SpeedLimit: previous.SpeedLimit, // 서버에 저장된 제한속도 유지
        lastSeen: Date.now()
    };

    res.json({
        RemoteEmergency: trains[TrainId].remoteEmergencyActive,
        SpeedLimit: trains[TrainId].SpeedLimit
    });
});

// [API] 웹 대시보드용 데이터 (웹 -> 서버)
app.get('/api/current-data', (req, res) => {
    const now = Date.now();
    for (const id in trains) {
        if (now - trains[id].lastSeen > 15000) delete trains[id]; // 15초 미응답 시 제거
    }
    res.json(trains);
});

// [API] 제어 명령들 (로그 기록 추가)
app.post('/api/web-speedlimit', (req, res) => {
    const { trainId, speedLimit, user } = req.body;
    if (trains[trainId]) {
        trains[trainId].SpeedLimit = speedLimit;
        addServerLog(user || "Unknown", `열차 [${trainId}] 제한속도 ${speedLimit}km/h 변경`);
        res.json({ success: true });
    }
});

app.post('/api/web-emergency', (req, res) => {
    const { trainId, user } = req.body;
    if (trains[trainId]) {
        trains[trainId].remoteEmergencyActive = true;
        addServerLog(user || "Unknown", `⚠️ 열차 [${trainId}] 원격 비상제동 체결`);
        res.json({ success: true });
    }
});

app.post('/api/web-reset', (req, res) => {
    const { trainId, user } = req.body;
    if (trains[trainId]) {
        trains[trainId].remoteEmergencyActive = false;
        addServerLog(user || "Unknown", `✅ 열차 [${trainId}] 비상상태 해제`);
        res.json({ success: true });
    }
});

app.listen(PORT, () => console.log(`서버 실행 중: ${PORT}`));
