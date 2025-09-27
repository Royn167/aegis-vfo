import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import dotenv from 'dotenv'
import { authenticateToken, auditLog } from './middleware/auth.js'
import principalRoutes from './routes/principals.js'
import assetRoutes from './routes/assets.js'
import relationshipRoutes from './routes/relationships.js'
import authRoutes from './routes/auth.js'
import financialRoutes from './routes/financials.js'
import { monitoringMiddleware, register } from './utils/monitoring.js'
import { logger } from './utils/logger.js'

dotenv.config()

const app = express()
const PORT = process.env.PORT || 3000

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
}))

app.use(cors({
  origin: process.env.FRONTEND_URL || ['http://localhost:5173', 'https://localhost:3000'],
  credentials: true
}))

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  message: { error: 'Too many requests, please try again later.' }
})
app.use(limiter)

// Body parsing
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true }))

// Monitoring
app.use(monitoringMiddleware)

// Metrics endpoint for Prometheus
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType)
  res.end(await register.metrics())
})

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
    environment: process.env.NODE_ENV || 'development'
  })
})

// Authentication routes (public)
app.use('/api/v1/auth', authRoutes)

// Protected API routes
app.use('/api/v1', authenticateToken, auditLog)
app.use('/api/v1/principals', principalRoutes)
app.use('/api/v1/assets', assetRoutes)
app.use('/api/v1/relationships', relationshipRoutes)
app.use('/api/v1/financials', financialRoutes)

// Error handling
app.use((err, req, res, next) => {
  logger.error('Unhandled error:', err)
  res.status(500).json({ 
    error: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error' 
  })
})

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Route not found' })
})

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully')
  process.exit(0)
})

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully')
  process.exit(0)
})

app.listen(PORT, () => {
  logger.info(`🚀 Aegis VFO server running on port ${PORT}`)
  logger.info(`📊 Metrics available at: http://localhost:${PORT}/metrics`)
  logger.info(`🏥 Health check: http://localhost:${PORT}/health`)
})

export default app