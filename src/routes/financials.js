import { Router } from 'express'
import { param, validationResult } from 'express-validator'
import { query } from '../utils/database.js'
import { logger } from '../utils/logger.js'

const router = Router()

// Get net worth for a principal
router.get('/net-worth/:principalId', [
  param('principalId').isUUID()
], async (req, res) => {
  try {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() })
    }

    const { principalId } = req.params

    // Calculate net worth by summing asset values owned by the principal
    const result = await query(`
      WITH principal_assets AS (
        SELECT 
          SUM(COALESCE(a.current_value, a.acquisition_cost, 0) * (COALESCE(r.percentage, 100) / 100.0)) as total_assets
        FROM relationships r
        JOIN assets a ON (r.to_entity_type = 'asset' AND r.to_entity_id = a.id)
        WHERE r.from_entity_type = 'principal' 
          AND r.from_entity_id = $1
          AND r.relationship_type IN ('owns', 'benefits_from')
          AND r.is_active = true
          AND a.status = 'active'
      )
      SELECT 
        p.id,
        p.reference_number,
        p.first_name || ' ' || p.last_name as name,
        COALESCE(pa.total_assets, 0) as asset_value,
        0 as liability_value, -- TODO: Add liabilities calculation
        COALESCE(pa.total_assets, 0) as net_worth,
        'USD' as currency,
        CURRENT_DATE as calculation_date
      FROM principals p
      LEFT JOIN principal_assets pa ON true
      WHERE p.id = $1 AND p.is_active = true
    `, [principalId])

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Principal not found' })
    }

    logger.info('Net worth calculated', { 
      principalId,
      netWorth: result.rows[0].net_worth 
    })

    res.json(result.rows[0])
  } catch (error) {
    logger.error('Error calculating net worth:', error)
    res.status(500).json({ error: 'Failed to calculate net worth' })
  }
})

export default router