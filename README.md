# Fraudscope AI — Intelligent Fund Flow Tracking System
## Hackathon Round 2 | PS3: Banking Fraud Detection

![Fraudscope AI](https://img.shields.io/badge/Fraudscope%20AI-AML%20Platform-00d4ff?style=for-the-badge)
![Status](https://img.shields.io/badge/Status-Live%20Demo-10b981?style=for-the-badge)
![Stack](https://img.shields.io/badge/Stack-React%20%7C%20Node.js%20%7C%20FastAPI-7c3aed?style=for-the-badge)

---

## 🌐 Live Demo

> **[👉 Open Fraudscope AI Demo](https://your-frontend.onrender.com)**  ← *(Update after deployment)*

| Credential | Value |
|-----------|-------|
| **Email** | `admin@fraudscope.ai` |
| **Password** | `Fraudscope@2024` |

> ⚠️ *Note: The backend runs on Render free tier. If the first load is slow (~30 sec), please wait — it's waking up from sleep.*

---

## 🚀 Quick Start

### ⚡ Easiest: One-Click Demo (No MongoDB needed)
```bash
# Just double-click START_DEMO.bat
# OR run manually:
cd backend && npm install && node mock-server.js
# In another terminal:
cd frontend && npm install && npm run dev
```
Open **http://localhost:5173** → Login with `admin@fraudscope.ai` / `Fraudscope@2024`

### Full Stack (with MongoDB)

#### Prerequisites
- Node.js 18+, Python 3.10+, MongoDB Atlas account

#### 1. Configure Backend
```bash
cd backend
cp .env.example .env
# Edit .env and add your MONGO_URI
npm install && npm start
```

#### 2. Start Frontend
```bash
cd frontend
npm install && npm run dev
```

#### 3. ML Service (Optional)
```bash
cd ml-service
pip install -r requirements.txt
python -m uvicorn app:app --reload --port 8000
```

---

## 🏗️ Architecture

```
Fraudscope AI
├── frontend/          # React + Vite + Tailwind CSS
│   ├── Dashboard      # Real-time KPI cards + charts
│   ├── Live Transactions  # Streaming transaction table
│   ├── Fund Flow Graph    # Interactive force-directed graph
│   ├── Alert Center       # Real-time fraud alerts
│   ├── Investigations     # Case management workspace
│   └── Accounts           # Account registry
│
├── backend/           # Node.js + Express + Socket.io
│   ├── fraud_engine/  # Rule-based detection (6 fraud types)
│   ├── simulator/     # Realistic transaction generator
│   ├── models/        # MongoDB schemas
│   └── routes/        # REST API endpoints
│
└── ml-service/        # Python + FastAPI
    ├── Isolation Forest anomaly detection
    ├── Graph analytics via NetworkX
    └── Batch scoring API
```

---

## 🎯 Fraud Detection Capabilities

| Fraud Type | Detection Method | Severity |
|------------|-----------------|---------|
| Structuring | Rule: multiple txs near ₹50k threshold | HIGH |
| Layering | BFS graph traversal ≥4 hops | CRITICAL |
| Round-Tripping | Cycle detection in graph | CRITICAL |
| Dormant Activation | Account inactive >90 days + large inflow | CRITICAL |
| Fan-Out | 5+ unique receivers in 30 min | HIGH |
| Mule Behaviour | Out/In ratio >90%, balance retention <5% | HIGH |
| High Velocity | 10+ transactions in 30 min | MEDIUM |
| Anomaly (ML) | Isolation Forest score | VARIABLE |

---

## 📊 Demo Story (For Judges)

1. **Login** → Dashboard shows live transaction stream
2. **Simulator triggers layering** → Funds flow through shell chain
3. **Alert fires** → "Layering chain detected — CRITICAL"
4. **Open Graph** → Animated red path shows laundering route
5. **Create Case** → Investigation workspace opens
6. **Add notes** → Document investigation findings
7. **Generate STR** → PDF report downloads instantly

---

## 🏆 Key Features

- ✅ **Real-time** transaction streaming via Socket.io
- ✅ **Interactive force-directed graph** with click-to-inspect
- ✅ **6 rule-based fraud detectors** + Isolation Forest ML
- ✅ **Case investigation workspace** with timeline notes
- ✅ **One-click STR/PDF export** via jsPDF
- ✅ **Role-based access** (Admin, Analyst, Investigator)
- ✅ **Fraud simulation** with scripted scenarios

---

## 💬 Judge Q&A

**"Why Isolation Forest?"**
Banking fraud is highly imbalanced. Isolation Forest works well for unsupervised anomaly detection where labelled fraud data is limited.

**"Why MongoDB over Neo4j?"**
MongoDB Atlas enabled faster hackathon prototyping with graph-like aggregation pipelines. Production roadmap includes Neo4j for heavy graph workloads.

**"Where is the AI?"**
The intelligence layer combines graph heuristics with anomaly scoring. The model evaluates transaction behaviour, velocity, account relationships, and suspicious graph structures continuously.

---

*Fraudscope AI — Built for RBI AML Compliance & FIU Reporting*
