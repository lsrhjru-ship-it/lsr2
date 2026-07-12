const express = require('express');
const path = require('path');
const app = express();
const PORT = 3000;

app.use(express.json());

let trains = {};

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.post('/api/train-status', (req, res) => {
    const { TrainId } = req.body;

    if (!TrainId) {
        return res.status(400).json({ error: "TrainId가 누락되었습니다." });
    }

    const previousEmergency = trains[TrainId] ? trains[TrainId].remoteEmergencyActive : false;

    // 수신된 모든 정보(위치 데이터 포함)와 마지막 확인 시간 업데이트
    trains[TrainId] = {
        ...req.body,
        remoteEmergencyActive: previousEmergency,
        lastSeen: Date.now()
    };

    res.json({
        RemoteEmergency: trains[TrainId].remoteEmergencyActive
    });
});

app.get('/api/current-data', (req, res) => {
    const now = Date.now();
    for (const id in trains) {
        if (now - trains[id].lastSeen > 30000) { // 30초 이상 신호 없으면 디스폰 처리
            delete trains[id];
        }
    }
    res.json(trains);
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