import promClient from 'prom-client'
import { logger } from './logger.js'

const register = new promClient.Registry()

const httpRequestDuration = new promClient.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.1, 0.5, 1, 2, 5]
})

const databaseQueryDuration = new promClient.Histogram({
  name: 'database_query_duration_seconds',
  help: 'Duration of database queries in seconds',
  labelNames: ['query_type', 'table'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 2]
})

const activeUsers = new promClient.Gauge({
  name: 'active_users_total',
  help: 'Total number of active users'
})

register.registerMetric(httpRequestDuration)
register.registerMetric(databaseQueryDuration)
register.registerMetric(activeUsers)

// Default Node.js metrics
promClient.collectDefaultMetrics({ register })

export const monitoringMiddleware = (req, res, next) => {
  const start = Date.now()
  
  res.on('finish', () => {
    const duration = (Date.now() - start) / 1000
    httpRequestDuration
      .labels(req.method, req.route?.path || req.path, res.statusCode)
      .observe(duration)
      
    logger.debug('HTTP Request completed', {
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
      duration: duration,
      userId: req.user?.id
    })
  })
  
  next()
}

export { register, databaseQueryDuration, activeUsers }