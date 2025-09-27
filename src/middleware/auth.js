import jwt from 'jsonwebtoken'
import { query } from '../utils/database.js'
import { logger } from '../utils/logger.js'

export const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization']
    const token = authHeader && authHeader.split(' ')[1]

    if (!token) {
      return res.status(401).json({ error: 'Access token required' })
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    
    // Fetch fresh user data
    const userResult = await query(
      'SELECT id, email, first_name, last_name, role, is_active FROM users WHERE id = $1',
      [decoded.userId]
    )

    if (userResult.rows.length === 0 || !userResult.rows[0].is_active) {
      return res.status(401).json({ error: 'Invalid token' })
    }

    req.user = userResult.rows[0]
    next()
  } catch (error) {
    logger.error('Authentication error:', error)
    res.status(403).json({ error: 'Invalid token' })
  }
}

export const requireRole = (roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' })
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' })
    }

    next()
  }
}

export const auditLog = async (req, res, next) => {
  const originalJson = res.json
  
  res.json = function(data) {
    if (req.user && ['POST', 'PUT', 'DELETE'].includes(req.method)) {
      setImmediate(async () => {
        try {
          await query(`
            INSERT INTO audit_log (table_name, record_id, action, new_data, changed_by, ip_address, user_agent)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
          `, [
            extractTableName(req.path),
            extractRecordId(req.path, data),
            req.method === 'POST' ? 'INSERT' : req.method === 'PUT' ? 'UPDATE' : 'DELETE',
            JSON.stringify(data),
            req.user.id,
            req.ip,
            req.get('User-Agent')
          ])
        } catch (error) {
          logger.error('Audit logging failed:', error)
        }
      })
    }
    
    return originalJson.call(this, data)
  }
  
  next()
}

function extractTableName(path) {
  const match = path.match(/\/api\/v1\/([^\/]+)/)
  return match ? match[1] : 'unknown'
}

function extractRecordId(path, data) {
  const match = path.match(/\/([0-9a-f-]{36})/)
  return match ? match[1] : data?.id || null
}