require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { createMlPipeline } = require('./services/mlPipeline');
const mountMlRoutes = require('./routes/ml');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
    credentials: true,
  },
});

app.set('io', io);

// ML layers: Isolation Forest + GNN + risk fusion (fail-open). `mirror` holds small in-memory copies used only for
// lookups / alert de-duplication; MongoDB stays the source of truth through the persistence hooks.
const mirror = { accounts: [], transactions: [], alerts: [] };
const mlPipeline = createMlPipeline({ db: mirror, io, hooks: {
  persistAlert: (a) => { const { _id, ...doc } = a; return require('./models/Alert').create(doc); },
  persistAlertUpdate: (a) => require('./models/Alert').updateOne({ alert_id: a.alert_id }, { $set: { risk_score: a.risk_score, final_risk_score: a.final_risk_score, metadata: a.metadata } }),
  persistAccount: (id, fields) => require('./models/Account').updateOne({ account_id: id }, { $set: fields }),
  persistTransaction: (tx) => require('./models/Transaction').updateOne({ tx_id: tx.tx_id }, { $set: { detectors: tx.detectors, final_risk_score: tx.final_risk_score, final_risk_level: tx.final_risk_level } }),
} });
mlPipeline.mirror = mirror;

// Middleware
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:5173', credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(morgan('dev'));

// Routes
mountMlRoutes(app, mlPipeline, mirror);
app.use('/api/auth', require('./routes/auth'));
app.use('/api/transactions', require('./routes/transactions'));
app.use('/api/alerts', require('./routes/alerts'));
app.use('/api/accounts', require('./routes/accounts'));
app.use('/api/investigations', require('./routes/investigations'));
app.use('/api/rules', require('./routes/rules'));
app.use('/api/simulator', require('./routes/simulator'));

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'operational',
    service: 'Fraudscope AI Backend',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
  });
});

// Dashboard stats
app.get('/api/dashboard/stats', async (req, res) => {
  try {
    const Transaction = require('./models/Transaction');
    const Alert = require('./models/Alert');
    const Account = require('./models/Account');
    const Investigation = require('./models/Investigation');

    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [txTotal, txFlagged, txToday, alertOpen, alertCritical, accountFlagged, casesOpen, recentTxs, recentAlerts, txByHour] = await Promise.all([
      Transaction.countDocuments(),
      Transaction.countDocuments({ anomaly_flag: true }),
      Transaction.countDocuments({ timestamp: { $gte: since24h } }),
      Alert.countDocuments({ status: 'OPEN' }),
      Alert.countDocuments({ severity: 'CRITICAL', status: 'OPEN' }),
      Account.countDocuments({ is_flagged: true }),
      Investigation.countDocuments({ status: { $in: ['OPEN', 'IN_PROGRESS'] } }),
      Transaction.find().sort({ timestamp: -1 }).limit(10).lean(),
      Alert.find({ status: 'OPEN' }).sort({ createdAt: -1 }).limit(5).lean(),
      Transaction.aggregate([
        { $match: { timestamp: { $gte: since24h } } },
        { $group: { _id: { $hour: '$timestamp' }, count: { $sum: 1 }, total_amount: { $sum: '$amount' } } },
        { $sort: { '_id': 1 } }
      ]),
    ]);

    res.json({
      tx: { total: txTotal, flagged: txFlagged, today: txToday },
      alerts: { open: alertOpen, critical: alertCritical },
      accounts: { flagged: accountFlagged },
      cases: { open: casesOpen },
      recent_transactions: recentTxs,
      recent_alerts: recentAlerts,
      tx_by_hour: txByHour,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Socket.io handler
io.on('connection', (socket) => {
  console.log(`🔌 Client connected: ${socket.id}`);
  socket.on('trigger_fraud_scenario', async (type) => {
    console.log(`⚡ Manual fraud trigger: ${type}`);
    socket.emit('scenario_triggered', { type, timestamp: new Date() });
  });
  socket.on('disconnect', () => console.log(`🔌 Client disconnected: ${socket.id}`));
});

// Seed default admin user
async function seedDefaultUser() {
  const User = require('./models/User');
  const exists = await User.findOne({ email: 'admin@fraudscope.ai' });
  if (!exists) {
    const user = new User({
      name: 'Admin Investigator',
      email: 'admin@fraudscope.ai',
      password: 'Fraudscope@2024',
      role: 'ADMIN',
      department: 'AML Compliance',
    });
    await user.save();
    console.log('👤 Default admin created: admin@fraudscope.ai / Fraudscope@2024');
  }
}

async function startServer() {
  const PORT = process.env.PORT || 5000;

  // Try to connect to MongoDB
  const mongoUri = process.env.MONGO_URI;
  const isRealMongo = mongoUri && !mongoUri.includes('cluster0.mongodb.net'); // detect placeholder

  let connected = false;

  if (isRealMongo) {
    try {
      await mongoose.connect(mongoUri);
      console.log('✅ MongoDB Atlas connected');
      connected = true;
    } catch (err) {
      console.warn('⚠️  MongoDB Atlas connection failed:', err.message);
    }
  }

  // Fallback: try local MongoDB
  if (!connected) {
    try {
      await mongoose.connect('mongodb://127.0.0.1:27017/fraudscope');
      console.log('✅ Local MongoDB connected');
      connected = true;
    } catch (err) {
      console.warn('⚠️  Local MongoDB not available:', err.message);
    }
  }

  if (!connected) {
    console.error('\n❌ No MongoDB connection available.');
    console.log('\n📋 To run Fraudscope AI, you need ONE of:');
    console.log('   1. MongoDB Atlas (free): https://cloud.mongodb.com');
    console.log('      → Create cluster → Get connection string');
    console.log('      → Paste in backend/.env as MONGO_URI=mongodb+srv://...');
    console.log('   2. Local MongoDB: Install from https://www.mongodb.com/try/download/community');
    console.log('\n🔑 After setting up MongoDB, run: npm start\n');
    process.exit(1);
  }

  await seedDefaultUser();
  const { startSimulator } = require('./simulator/txSimulator');
  startSimulator(io, mlPipeline);
  mlPipeline.start();

  server.listen(PORT, () => {
    console.log(`\n🚀 Fraudscope AI Server running on port ${PORT}`);
    console.log(`📊 Health check: http://localhost:${PORT}/health`);
    console.log(`🌐 Frontend: http://localhost:5173\n`);
  });
}

startServer().catch((err) => {
  console.error('Server startup error:', err);
  process.exit(1);
});

module.exports = { app, io };
