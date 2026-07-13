const express = require('express');
const path = require('path');
const fs = require('fs');
const app = express();
const PORT = 3000;

app.use(express.json());

let trains = {};
const DB_PATH = path.join(__dirname, 'accounts.json');

// 시스템 초기화 시 계정 DB 로드 (파일이 없으면 최고 관리자 기본 생성)
let accounts = [];
if (fs.existsSync(DB_PATH)) {
    accounts = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
} else {
    accounts = [
        { id: "lsrhjru", pw: "lsr37733*", rbxId: 1, role: "최고 관리자" } // UI와 일치하도록 '최고 관리자'로 수정
    ];
    fs.writeFileSync(DB_PATH, JSON.stringify(accounts, null, 2));
}

// 계정 저장 헬퍼 함수
const saveAccounts = () => fs.writeFileSync(DB_PATH, JSON.stringify(accounts, null, 2));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// 📌 [API 추가] 로블록스 아바타 이미지 프록시 중계기
app.get('/api/avatar/:rbxId', async (req, res) => {
    const rbxId = req.params.rbxId || 1;
    try {
        // 로블록스 공식 유저 헤드샷 썸네일 API 호출
        const response = await fetch(`https://thumbnails.roblox.com/v1/users/avatar-headshots?userIds=${rbxId}&size=150x150&format=Png&isCircular=true`);
        const data = await response.json();
        
        if (data && data.data && data.data[0] && data.data[0].imageUrl) {
            // 가져온 실제 이미지 URL 주소로 리다이렉트 처리
            return res.redirect(data.data[0].imageUrl);
        }
        res.redirect('https://upload.wikimedia.org/wikipedia/commons/a/ac/Default_pfp.jpg');
    } catch (e) {
        res.redirect('https://upload.wikimedia.org/wikipedia/commons/a/ac/Default_pfp.jpg');
    }
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

// 📌 [API 추가] 관제원 계정 원격 삭제 기능
app.delete('/api/accounts/:id', (req, res) => {
    const targetId = req.params.id;

    // 시스템 마스터 계정 폭파 방지 안전장치
    if (targetId === "lsrhjru") {
        return res.status(400).json({ error: "최고 관리자 본인 계정은 시스템에서 삭제할 수 없습니다." });
    }

    const index = accounts.findIndex(a => a.id === targetId);
    if (index !== -1) {
        accounts.splice(index, 1);
        saveAccounts();
        res.json({ success: true });
    } else {
        res.status(404).json({ error: "존재하지 않는 계정입니다." });
    }
});

// [API] 열차 상태 수신
app.post('/api/train-status', (req, res) => {
    const { TrainId } = req.body;

    if (!TrainId) {
        return res.status(400).json({ error: "TrainId가 누락되었습니다." });
    }

    const previousEmergency = trains[TrainId] ? trains[TrainId].remoteEmergencyActive : false;
    const currentSpeedLimit = trains[TrainId] ? trains[TrainId].SpeedLimit : 80;

    trains[TrainId] = {
        ...req.body,
        SpeedLimit: req.body.SpeedLimit || currentSpeedLimit, // ATC 제한속도 유지
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
        if (now - trains[id].lastSeen > 30000) { // 30초 이상 신호 없으면 디스폰 처리
            delete trains[id];
        }
    }
    res.json(trains);
});

// [API] 제한 속도 변경 명령
app.post('/api/web-speedlimit', (req, res) => {
    const { trainId, speedLimit } = req.body;
    if (trains[trainId]) {
        trains[trainId].SpeedLimit = speedLimit;
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
