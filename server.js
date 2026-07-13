const express = require('express');
const path = require('path');
const fs = require('fs');
const https = require('https'); // 로블록스 API 통신용
const app = express();
const PORT = 3000;

app.use(express.json());

let trains = {};
let systemLogs = []; // 전체 관리자가 공유할 시스템 로그 저장소
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

const saveAccounts = () => fs.writeFileSync(DB_PATH, JSON.stringify(accounts, null, 2));

// 중앙 로그 기록 헬퍼 함수
function addServerLog(user, message) {
    const now = new Date();
    const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
    systemLogs.push({ timeStr, user, message });
    if (systemLogs.length > 200) systemLogs.shift(); // 로그가 너무 길어지면 옛날 것부터 삭제
}

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// [API] 전체 계정 목록 조회
app.get('/api/accounts', (req, res) => {
    res.json(accounts);
});

// [API] 신규 관제원 계정 생성
app.post('/api/accounts', (req, res) => {
    const { id, pw, rbxId, role, adminId } = req.body;
    if (accounts.some(a => a.id === id)) {
        return res.status(400).json({ error: "이미 존재하는 ID입니다." });
    }
    accounts.push({ id, pw, rbxId, role: role || "일반 관제원" });
    saveAccounts();
    addServerLog(adminId || "System", `하위 관제원 계정 신규 발급 완료 (ID: ${id})`);
    res.json({ success: true });
});

// [API] 로블록스 아바타 프록시 (JSON 대신 실제 이미지로 변환)
app.get('/api/avatar/:id', (req, res) => {
    const rbxId = req.params.id || 1;
    const url = `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${rbxId}&size=150x150&format=Png&isCircular=true`;
    
    https.get(url, (apiRes) => {
        let data = '';
        apiRes.on('data', chunk => data += chunk);
        apiRes.on('end', () => {
            try {
                const json = JSON.parse(data);
                if (json.data && json.data.length > 0) {
                    res.redirect(json.data[0].imageUrl); // JSON 내부의 이미지 실제 URL로 리다이렉트
                } else {
                    res.status(404).send('Not found');
                }
            } catch(e) {
                res.status(500).send('Error');
            }
        });
    }).on('error', () => res.status(500).send('Error'));
});

// [API] 열차 상태 수신 (로블록스 -> 서버)
app.post('/api/train-status', (req, res) => {
    const { TrainId } = req.body;

    if (!TrainId) {
        return res.status(400).json({ error: "TrainId가 누락되었습니다." });
    }

    const previousEmergency = trains[TrainId] ? trains[TrainId].remoteEmergencyActive : false;
    // 기본 제한속도를 웹과 스크립트 모두 동일하게 30으로 맞춤
    const currentSpeedLimit = trains[TrainId] ? trains[TrainId].SpeedLimit : 30; 

    trains[TrainId] = {
        ...req.body,
        SpeedLimit: req.body.SpeedLimit || currentSpeedLimit, 
        remoteEmergencyActive: previousEmergency,
        lastSeen: Date.now()
    };

    res.json({
        RemoteEmergency: trains[TrainId].remoteEmergencyActive,
        SpeedLimit: trains[TrainId].SpeedLimit
    });
});

// [API] 대시보드 데이터 전송 (서버 -> 웹사이트)
app.get('/api/current-data', (req, res) => {
    const now = Date.now();
    for (const id in trains) {
        if (now - trains[id].lastSeen > 30000) { 
            delete trains[id];
        }
    }
    // 기차 데이터와 함께 전체 시스템 로그도 웹으로 보내줌
    res.json({ trains: trains, logs: systemLogs });
});

// [API] 제한 속도 변경 명령
app.post('/api/web-speedlimit', (req, res) => {
    const { trainId, speedLimit, adminId } = req.body;
    if (trains[trainId]) {
        trains[trainId].SpeedLimit = speedLimit;
        addServerLog(adminId || "System", `열차 [${trainId}] ATC 제한속도를 ${speedLimit}km/h로 수정 지시.`);
        res.json({ success: true });
    } else {
        res.status(404).json({ error: "열차를 찾을 수 없습니다." });
    }
});

// [API] 원격 비상 정지 명령
app.post('/api/web-emergency', (req, res) => {
    const { trainId, adminId } = req.body;
    if (trains[trainId]) {
        trains[trainId].remoteEmergencyActive = true;
        addServerLog(adminId || "System", `⚠️ 열차 [${trainId}] 원격 비상 정지(EMS) 강제 발령!`);
        res.json({ success: true });
    } else {
        res.status(404).json({ error: "열차를 찾을 수 없습니다." });
    }
});

// [API] 원격 비상 해제 명령
app.post('/api/web-reset', (req, res) => {
    const { trainId, adminId } = req.body;
    if (trains[trainId]) {
        trains[trainId].remoteEmergencyActive = false;
        addServerLog(adminId || "System", `✅ 열차 [${trainId}] 원격 비상 상태 해제 전송.`);
        res.json({ success: true });
    } else {
        res.status(404).json({ error: "열차를 찾을 수 없습니다." });
    }
});

app.listen(PORT, () => {
    console.log(`[통합 관제탑 서버 실행 완료] http://localhost:${PORT}`);
    addServerLog("System", "통합 철도 관제 운영 인프라 서버 접속 및 동기화 완료.");
});
