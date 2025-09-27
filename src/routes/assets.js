import { Router } from 'express'
import { body, param, query as queryValidator, validationResult } from 'express-validator'
import { query } from '../utils/database.js'
import { requireRole } from '../middleware/auth.js'
import { logger } from '../utils/logger.js'

const router = Router()

// List assets
router.get('/', [
  queryValidator('type').optional(),
  queryValidator('status').optional().isIn(['active', 'sold', 'transferred', 'inactive']),
  queryValidator('limit').optional().isInt({ min: 1, max: 100 }),
  queryValidator('offset').optional().isInt({ min: 0 })
], async (req, res) => {
  try {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() })
    }

    const { type, status = 'active', limit = 20, offset = 0 } = req.query
    
    let whereClause = 'WHERE status = $1'
    let params = [status]
    
    if (type) {
      whereClause += ' AND type = $2'
      params.push(type)
    }

    const result = await query(`
      SELECT id, reference_number, name, type, subtype, current_value, currency, 
             acquisition_date, location, description, status, created_at, updated_at
      FROM assets 
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT ${params.length + 1} OFFSET ${params.length + 2}
    `, [...params, limit, offset])

    res.json(result.rows)
  } catch (error) {
    logger.error('Error listing assets:', error)
    res.status(500).json({ error: 'Failed to list assets' })
  }
})

// Create asset
router.post('/', [
  requireRole(['admin', 'advisor']),
  body('name').notEmpty().isLength({ max: 255 }),
  body('type').notEmpty(),
  body('current_value').optional().isFloat({ min: 0 }),
  body('currency').optional().isLength({ min: 3, max: 3 })
], async (req, res) => {
  try {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() })
    }

    const assetData = req.body
    
    // Generate reference number if not provided
    if (!assetData.reference_number) {
      const countResult = await query('SELECT COUNT(*) FROM assets')
      const count = parseInt(countResult.rows[0].count) + 1
      assetData.reference_number = `ASSET-${count.toString().padStart(3, '0')}`
    }

    const result = await query(`
      INSERT INTO assets (reference_number, name, type, subtype, current_value, currency,
                         acquisition_date, acquisition_cost, location, description, metadata, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *
    `, [
      assetData.reference_number,
      assetData.name,
      assetData.type,
      assetData.subtype || null,
      assetData.current_value || null,
      assetData.currency || 'USD',
      assetData.acquisition_date || null,
      assetData.acquisition_cost || null,
      assetData.location || null,
      assetData.description || null,
      JSON.stringify(assetData.metadata || {}),
      req.user.id
    ])

    logger.info('Asset created', { 
      assetId: result.rows[0].id,
      createdBy: req.user.id 
    })

    res.status(201).json(result.rows[0])
  } catch (error) {
    logger.error('Error creating asset:', error)
    if (error.code === '23505') {
      res.status(409).json({ error: 'Reference number already exists' })
    } else {
      res.status(500).json({ error: 'Failed to create asset' })
    }
  }
})

export default router