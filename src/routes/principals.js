import { Router } from 'express'
import { body, param, query as queryValidator, validationResult } from 'express-validator'
import { query } from '../utils/database.js'
import { requireRole } from '../middleware/auth.js'
import { logger } from '../utils/logger.js'

const router = Router()

// List principals
router.get('/', [
  queryValidator('type').optional().isIn(['family_member', 'beneficiary', 'trustee', 'advisor', 'service_provider']),
  queryValidator('active').optional().isBoolean(),
  queryValidator('limit').optional().isInt({ min: 1, max: 100 }),
  queryValidator('offset').optional().isInt({ min: 0 })
], async (req, res) => {
  try {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() })
    }

    const { type, active = true, limit = 20, offset = 0 } = req.query
    
    let whereClause = 'WHERE is_active = $1'
    let params = [active]
    
    if (type) {
      whereClause += ' AND type = $2'
      params.push(type)
    }

    const result = await query(`
      SELECT id, reference_number, type, first_name, last_name, 
             email, phone, address, metadata, created_at, updated_at
      FROM principals 
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `, [...params, limit, offset])

    res.json(result.rows)
  } catch (error) {
    logger.error('Error listing principals:', error)
    res.status(500).json({ error: 'Failed to list principals' })
  }
})

// Create principal
router.post('/', [
  requireRole(['admin', 'advisor']),
  body('reference_number').optional().isLength({ max: 50 }),
  body('type').isIn(['family_member', 'beneficiary', 'trustee', 'advisor', 'service_provider']),
  body('first_name').notEmpty().isLength({ max: 100 }),
  body('last_name').notEmpty().isLength({ max: 100 }),
  body('email').optional().isEmail(),
  body('date_of_birth').optional().isISO8601()
], async (req, res) => {
  try {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() })
    }

    const principalData = req.body
    
    // Generate reference number if not provided
    if (!principalData.reference_number) {
      const countResult = await query('SELECT COUNT(*) FROM principals')
      const count = parseInt(countResult.rows[0].count) + 1
      principalData.reference_number = `PRIN-${count.toString().padStart(3, '0')}`
    }

    const result = await query(`
      INSERT INTO principals (reference_number, type, first_name, last_name, email, 
                            phone, date_of_birth, address, metadata, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING id, reference_number, type, first_name, last_name, email, phone, 
                date_of_birth, address, metadata, created_at
    `, [
      principalData.reference_number,
      principalData.type,
      principalData.first_name,
      principalData.last_name,
      principalData.email || null,
      principalData.phone || null,
      principalData.date_of_birth || null,
      JSON.stringify(principalData.address || {}),
      JSON.stringify(principalData.metadata || {}),
      req.user.id
    ])

    logger.info('Principal created', { 
      principalId: result.rows[0].id,
      createdBy: req.user.id 
    })

    res.status(201).json(result.rows[0])
  } catch (error) {
    logger.error('Error creating principal:', error)
    if (error.code === '23505') {
      res.status(409).json({ error: 'Reference number already exists' })
    } else {
      res.status(500).json({ error: 'Failed to create principal' })
    }
  }
})

export default router