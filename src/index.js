require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const connectDB = require('./config/db');
const orderRoutes = require('./routes/order.routes');
const logger = require('./config/logger');

const app = express();

app.use(helmet());

const allowedOrigins = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  ...(process.env.FRONTEND_URL ? process.env.FRONTEND_URL.split(',') : []),
  ...(process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : []),
].filter(Boolean).map((o) => o.trim().replace(/\/$/, ''));
const ipOriginPattern = /^https?:\/\/(\d{1,3}\.){3}\d{1,3}(:\d+)?$/;

const corsOptions = {
  origin: (origin, callback) => {
    const normalizedOrigin = origin ? origin.replace(/\/$/, '') : origin;
    if (
      !normalizedOrigin ||
      allowedOrigins.includes(normalizedOrigin) ||
      ipOriginPattern.test(normalizedOrigin)
    ) return callback(null, true);
    callback(new Error(`CORS: Origin ${origin} not allowed`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  optionsSuccessStatus: 200,
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 150 });
app.use('/api/', limiter);
app.use(morgan('combined', { stream: { write: (msg) => logger.info(msg.trim()) } }));
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true }));

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy', service: 'order-service', timestamp: new Date().toISOString() });
});

app.use('/api/orders', orderRoutes);

app.use((req, res) => {
  res.status(301).redirect(process.env.FRONTEND_URL || 'http://localhost:3000');
});

app.use((err, req, res, next) => {
  logger.error(`Unhandled error: ${err.message}`);
  res.status(err.status || 500).json({ success: false, message: err.message || 'Internal Server Error' });
});

const PORT = process.env.PORT || 4003;
connectDB().then(() => {
  app.listen(PORT, () => logger.info(`Order Service running on port ${PORT}`));
}).catch((err) => { logger.error(`DB connection failed: ${err.message}`); process.exit(1); });
