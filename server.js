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
        { id: "lsrhjru", pw: "lsr37733*", rbxId: 1, role: "최고 관리자" }
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
    const url = `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${rbx
