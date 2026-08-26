import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { router as apiRouter } from './routes/api';
import { pool } from './config/db';

dotenv.config();

const app = express();
const PORT = parseInt(process.env.PORT || '4003', 10);

// Middlewares
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// Routes
app.use('/api', apiRouter);

// Root greeting
app.get('/', (req, res) => {
  res.json({
    service: 'Tikovia Delivery API Microservice',
    status: 'Running',
    version: '1.0.0',
    db: process.env.DB_NAME || 'tikovia_delivery'
  });
});

// Startup check
const startServer = async () => {
  try {
    const dbTest = await pool.query('SELECT NOW()');
    console.log('✅ Connected to PostgreSQL successfully at:', dbTest.rows[0].now);
  } catch (err) {
    console.warn('⚠️ Warning: PostgreSQL connection failed at startup. Will retry on queries.', err);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Tikovia Delivery API server running on port ${PORT}`);
  });
};

startServer();
