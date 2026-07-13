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
    accounts.push({ id, pw, rbxId, role: role || "일반 관제원" });
    saveAccounts();
    res.json({ success: true });
});

// 🌟 [API] 관제원 정보 수정 기능 (추가됨)
app.post('/api/accounts/update', (req, res) => {
    const { id, pw, rbxId, role } = req.body;
    
    const account = accounts.find(a => a.id === id);
    if (!account) {
        return res.status(404).json({ error: "해당 계정을 찾을 수 없습니다." });
    }

    // 값 변경 (입력된 값이 있을 때만 변경)
    if (pw) account.pw = pw;
    if (rbxId !== undefined) account.rbxId = parseInt(rbxId) || 1;
    if (role) account.role = role;

    saveAccounts();
    res.json({ success: true });
});

// [API] 관제원 계정 삭제 기능
app.delete('/api/accounts/:id', (req, res) => {
    const targetId = req.params.id;
    
    if (targetId === "lsrhjru") {
        return res.status(400).json({ error: "최고 시스템 관리자 마스터 계정은 삭제할 수 없습니다." });
    }

    const index = accounts.findIndex(a => a.id === targetId);
    if (index === -1) {
        return res.status(404).json({ error: "해당 계정을 찾을 수 없습니다." });
    }

    accounts.splice(index, 1);
    saveAccounts();
    res.json({ success: true });
});

// [API] 로블록스 아바타 실시간 이미지 프록시
app.get('/api/avatar/:rbxId', async (req, res) => {
    const { rbxId } = req.params;
    try {
        const response = await fetch(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${rbxId}&size=150x150&format=Png&isCircular=false`);
        const data = await response.json();
        
        if (data && data.data && data.data[0] && data.data[0].imageUrl) {
            return res.redirect(data.data[0].imageUrl);
        }
    } catch (e) {
        console.error("로블록스 아바타 조회 실패:", e);
    }
    res.redirect('https://upload.wikimedia.org/wikipedia/commons/a/ac/Default_pfp.jpg');
});

// server.js 의 [API] 열차 상태 수신 부분을 아래로 교체하세요
app.post('/api/train-status', (req, res) => {
    const { TrainId, CurrentSpeed, PositionX, PositionZ, TrainName, CurrentNotch, CurrentReverser, DriverName, DriverId, IsEmergency } = req.body;

    if (!TrainId) return res.status(400).json({ error: "TrainId 없음" });

    // 1. 기존 데이터 확인
    const oldData = trains[TrainId];
    
    // 2. 서버에 이미 변경된 제한속도가 있다면 그 값을 유지, 없다면 로블록스에서 보낸 값을 사용
    const newSpeedLimit = (oldData && oldData.SpeedLimit) ? oldData.SpeedLimit : (req.body.SpeedLimit || 80);
    const newEmergency = (oldData && oldData.remoteEmergencyActive !== undefined) ? oldData.remoteEmergencyActive : false;

    // 3. 데이터 업데이트
    trains[TrainId] = {
        TrainId, CurrentSpeed, PositionX, PositionZ, TrainName, CurrentNotch, CurrentReverser, DriverName, DriverId, IsEmergency,
        SpeedLimit: newSpeedLimit,
        remoteEmergencyActive: newEmergency,
        lastSeen: Date.now()
    };

    // 4. 응답으로 유지된 값을 다시 보내줌 (로블록스 기차 스크립트가 이걸 읽어서 적용함)
    res.json({
        RemoteEmergency: trains[TrainId].remoteEmergencyActive,
        SpeedLimit: trains[TrainId].SpeedLimit
    });
});

// server.js의 [API] 대시보드 데이터 전송 부분을 아래와 같이 수정
app.get('/api/current-data', (req, res) => {
    const now = Date.now();
    let activeTrains = {}; // 응답용 임시 객체
    
    for (const id in trains) {
        // 30초 이상 신호 없으면 삭제하되, 바로 응답에서 빼지 말고 
        // 전체 상태를 유지하다가 정리함
        if (now - trains[id].lastSeen < 30000) {
            activeTrains[id] = trains[id];
        } else {
            delete trains[id];
        }
    }
    res.json(activeTrains); 
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
