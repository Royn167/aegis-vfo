import pkg from 'pg'
import dotenv from 'dotenv'
import { logger } from './logger.js'

const { Pool } = pkg
dotenv.config()

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
})

pool.on('connect', () => {
  logger.debug('Connected to PostgreSQL database')
})

pool.on('error', (err) => {
  logger.error('Unexpected database error:', err)
  process.exit(-1)
})

export const query = async (text, params) => {
  const start = Date.now()
  try {
    const res = await pool.query(text, params)
    const duration = Date.now() - start
    
    logger.debug('Database query executed', {
      query: text.substring(0, 100) + '...',
      duration,
      rows: res.rows?.length || 0
    })
    
    return res
  } catch (error) {
    logger.error('Database query error:', {
      query: text.substring(0, 100) + '...',
      error: error.message,
      duration: Date.now() - start
    })
    throw error
  }
}

export const getClient = () => pool.connect()

export default pool