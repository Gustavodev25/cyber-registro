// server.js (Corrigido para o deploy)
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');
// A linha 'const ngrok = require('ngrok');' foi REMOVIDA daqui.

const http = require('http');
const { Server } = require('socket.io');

dotenv.config();

const sequelize = require('./db/connection');
const User = require('./models/user');
const Transaction = require('./models/Transaction.js');
const Coupon = require('./models/Coupon');

// ===== INÍCIO DA CORREÇÃO: DEFINIÇÃO DAS ASSOCIAÇÕES =====
// É crucial definir como os modelos se relacionam antes de usá-los.
// Transaction.belongsTo(User) cria a chave estrangeira 'userId' na tabela de transações.
Transaction.belongsTo(User, { foreignKey: 'userId', as: 'user' });
User.hasMany(Transaction, { foreignKey: 'userId' });
// =================== FIM DA CORREÇÃO ===================

const authRoutes = require('./routes/auth');
const paymentRoutes = require('./routes/payment');
const userRoutes = require('./routes/user');
const couponRoutes = require('./routes/coupons');
const transactionRoutes = require('./routes/transactions'); // Rota que estava causando o erro

const app = express();
const httpServer = http.createServer(app);

const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:8080';
const NODE_ENV = process.env.NODE_ENV || 'development';

const io = new Server(httpServer, {
  cors: {
    origin: FRONTEND_ORIGIN,
    methods: ['GET', 'POST'],
  },
});

io.on('connection', (socket) => {
  console.log(`[SOCKET] ✅ Cliente conectado: ${socket.id}`);

  socket.on('watch_payment', (paymentId) => {
    if (paymentId) {
      socket.join(`pay:${paymentId}`);
      console.log(`[SOCKET] 👁️  Socket ${socket.id} está observando o pagamento ${paymentId}`);
    }
  });

  socket.on('disconnect', () => {
    console.log(`[SOCKET] ❌ Cliente desconectado: ${socket.id}`);
  });
});

app.use(helmet());
app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// ===== CORS aprimorado: permite localhost, domínio sem e com www, e extras via env =====
const DEFAULT_ALLOWED = [
  'http://localhost:8080',
  'http://127.0.0.1:8080',
  FRONTEND_ORIGIN,
  'https://cyberregistro.com.br',
  'https://www.cyberregistro.com.br',
].filter(Boolean);

const extra = (process.env.CORS_ALLOWED_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const ALLOWED_ORIGINS = Array.from(new Set([...DEFAULT_ALLOWED, ...extra]));

app.use(
  cors({
    origin(origin, cb) {
      // permite ferramentas/health sem header Origin
      if (!origin) return cb(null, true);
      if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
      return cb(new Error(`CORS bloqueado para origem: ${origin}`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    maxAge: 86400,
  })
);
// pré-flight global
app.options('*', cors());

// injeta io no req
app.use((req, res, next) => {
  req.io = io;
  next();
});

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.use('/api/auth', authRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/user', userRoutes);
app.use('/api/coupons', couponRoutes);
app.use('/api/transactions', transactionRoutes);

app.get('/api/me', async (req, res) => {
  try {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Não autenticado' });
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findByPk(payload.sub);
    if (!user) return res.status(404).json({ error: 'Usuário do token não encontrado.' });
    return res.json({ user });
  } catch {
    return res.status(401).json({ error: 'Token inválido' });
  }
});

const PORT = process.env.PORT || 3000;

async function start() {
  try {
    await sequelize.authenticate();
    console.log('[API] ✅ Database: Conexão estabelecida.');
    await sequelize.sync({ alter: NODE_ENV === 'development' });

    httpServer.listen(PORT, async () => {
      console.log(`[API] ✅ Backend: Iniciado com sucesso na porta ${PORT}`);

      if (NODE_ENV === 'development') {
        // --- MODIFICAÇÃO PRINCIPAL ---
        // O ngrok agora é carregado APENAS em ambiente de desenvolvimento.
        const ngrok = require('ngrok');
        try {
          const url = await ngrok.connect({
            addr: PORT,
            authtoken: process.env.NGROK_AUTHTOKEN || undefined,
          });

          process.env.APP_PUBLIC_URL = url;

          console.log('\n==============================================================================');
          console.log('NGROK INICIADO - BACKEND PÚBLICO');
          console.log(`URL Pública (Host): ${url}`);
          console.log(`Webhook Asaas: ${url}/api/payment/webhook`);
          console.log('==============================================================================\n');
        } catch (ngrokError) {
          console.error('[NGROK] ❌ Erro ao iniciar o ngrok:', ngrokError);
        }
      }
    });
  } catch (err) {
    console.error('[API] ❌ Falha ao iniciar a API:', err);
    process.exit(1);
  }
}

start();
