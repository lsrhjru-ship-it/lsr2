const express = require('express');
const path = require('path');
const fs = require('fs');
const app = express();
const PORT = 3000;

app.use(express.json());

let trains = {};
const DB_PATH = path.join(__dirname, 'accounts.json');

let accounts = [];
if (fs.existsSync(DB_PATH)) {
    accounts = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
} else {
    accounts = [
        { id: "lsrhjru", pw: "lsr37733*", rbxId: 1, role: "admin" }
    ];
    fs.writeFileSync(DB_PATH, JSON.stringify(accounts, null, 2));
}

const saveAccounts = () => fs.writeFileSync(DB_PATH, JSON.stringify(accounts, null, 2));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/api/accounts', (req, res) => {
    res.json(accounts);
});

app.post('/api/accounts', (req, res) => {
    const { id, pw, rbxId, role } = req.body;
    if (accounts.some(a => a.id === id)) {
        return res.status(400).json({ error: "이미 존재하는 ID입니다." });
    }
    accounts.push({ id, pw, rbxId: Number(rbxId) || 1, role: role || "일반 관제원" });
    saveAccounts();
    res.json({ success: true });
});

app.put('/api/accounts/:id', (req, res) => {
    const { id } = req.params;
    const { pw, rbxId, role } = req.body;
    
    const account = accounts.find(a => a.id === id);
    if (!account) {
        return res.status(404).json({ error: "해당 계정을 찾을 수 없습니다." });
    }

    if (pw !== undefined && pw.trim() !== "") account.pw = pw;
    if (rbxId !== undefined) account.rbxId = Number(rbxId);
    if (role !== undefined) account.role = role;

    saveAccounts();
    res.json({ success: true });
});

app.delete('/api/accounts/:id', (req, res) => {
    const { id } = req.params;

    if (id === 'lsrhjru') {
        return res.status(400).json({ error: "최고 관리자 본인 계정은 삭제할 수 없습니다." });
    }

    const index = accounts.findIndex(a => a.id === id);
    if (index === -1) {
        return res.status(404).json({ error: "해당 계정을 찾을 수 없습니다." });
    }

    accounts.splice(index, 1);
    saveAccounts();
    res.json({ success: true });
});

// [상태 수신 API 비상 상태 데이터 정제 파싱 필터 추가]
app.post('/api/train-status', (req, res) => {
    const { TrainId, IsEmergency } = req.body;

    if (!TrainId) {
        return res.status(400).json({ error: "TrainId가 누락되었습니다." });
    }

    const previousEmergency = trains[TrainId] ? trains[TrainId].remoteEmergencyActive : false;
    const currentSpeedLimit = trains[TrainId] ? trains[TrainId].SpeedLimit : 80;

    // 로블록스가 String 형식으로 값을 주든 Boolean 형식으로 주든 완벽히 식별하도록 강제 변환
    const parsedIsEmergency = (IsEmergency === true || IsEmergency === "true");

    trains[TrainId] = {
        ...req.body,
        IsEmergency: parsedIsEmergency, 
        SpeedLimit: req.body.SpeedLimit || currentSpeedLimit, 
        remoteEmergencyActive: previousEmergency,
        lastSeen: Date.now()
    };

    res.json({
        RemoteEmergency: trains[TrainId].remoteEmergencyActive,
        SpeedLimit: trains[TrainId].SpeedLimit
    });
});

app.get('/api/current-data', (req, res) => {
    const now = Date.now();
    for (const id in trains) {
        if (now - trains[id].lastSeen > 30000) { 
            delete trains[id];
        }
    }
    res.json(trains);
});

app.post('/api/web-speedlimit', (req, res) => {
    const { trainId, speedLimit } = req.body;
    if (trains[trainId]) {
        trains[trainId].SpeedLimit = speedLimit;
        res.json({ success: true });
    } else {
        res.status(404).json({ error: "열차를 찾을 수 없습니다." });
    }
});

app.post('/api/web-emergency', (req, res) => {
    const { trainId } = req.body;
    if (trains[trainId]) {
        trains[trainId].remoteEmergencyActive = true;
        res.json({ success: true });
    } else {
        res.status(404).json({ error: "열차를 찾을 수 없습니다." });
    }
});

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
