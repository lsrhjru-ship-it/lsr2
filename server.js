const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000; // Render 배포 환경 맞춤 포트 설정

app.use(express.json());

let trains = {};

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// 로블록스 열차가 상태 정보를 쏘고 명령을 받아가는 곳
app.post('/api/train-status', (req, res) => {
    const { TrainId } = req.body;

    if (!TrainId) {
        return res.status(400).json({ error: "TrainId가 누락되었습니다." });
    }

    // 서버가 기존에 보관하던 고유 제어 변수(원격 정지 상태, 제한속도) 유지
    const previousEmergency = trains[TrainId] ? trains[TrainId].remoteEmergencyActive : false;
    const currentLimit = trains[TrainId] ? (trains[TrainId].SpeedLimit || 80) : 80;

    trains[TrainId] = {
        ...req.body,
        SpeedLimit: currentLimit,
        remoteEmergencyActive: previousEmergency,
        lastSeen: Date.now()
    };

    // 로블록스 스크립트로 전달할 응답 값 구성
    res.json({
        RemoteEmergency: trains[TrainId].remoteEmergencyActive,
        SpeedLimit: trains[TrainId].SpeedLimit
    });
});

// 웹 브라우저가 상시 화면 갱신을 위해 데이터 수신하는 곳
app.get('/api/current-data', (req, res) => {
    const now = Date.now();
    for (const id in trains) {
        if (now - trains[id].lastSeen > 8000) { // 8초간 통신 해제시 디스폰 처리
            delete trains[id];
        }
    }
    res.json(trains);
});

// 원격 제한속도 변경 처리 API
app.post('/api/web-speedlimit', (req, res) => {
    const { trainId, speedLimit } = req.body;
    if (trains[trainId]) {
        trains[trainId].SpeedLimit = Number(speedLimit);
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
    console.log(`[통합 관제탑 서버 실행 완료] Port: ${PORT}`);
});
